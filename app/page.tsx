"use client";

import { useRef, useState } from "react";
import type { AgentEvent, AgentResult } from "@/lib/agent";
import { hostOf } from "@/lib/text";

type Step = Extract<AgentEvent, { type: "step" }>;

const EXAMPLES = [
  "What are the system requirements for Python 3.13 on Windows?",
  "What is the return policy on apple.com?",
  "Who won the most recent Formula 1 Grand Prix?",
  "What is the price of the Raspberry Pi 5 8GB?",
];

export default function Home() {
  const [question, setQuestion] = useState("");
  const [steps, setSteps] = useState<Step[]>([]);
  const [result, setResult] = useState<AgentResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [seconds, setSeconds] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function ask(q: string) {
    const text = q.trim();
    if (text.length < 3 || running) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const startedAt = performance.now();

    setQuestion(text);
    setSteps([]);
    setResult(null);
    setError(null);
    setSeconds(null);
    setRunning(true);

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Request failed (${res.status}).`);
      }

      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as AgentEvent;
          if (event.type === "step") setSteps((s) => [...s, event]);
          else if (event.type === "result") setResult(event.result);
          else setError(event.message);
        }
      }
      setSeconds((performance.now() - startedAt) / 1000);
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    } finally {
      if (abortRef.current === controller) setRunning(false);
    }
  }

  const idle = !running && steps.length === 0 && !result && !error;

  return (
    <div className="page">
      <div className="glow" aria-hidden="true" />

      <nav className="nav">
        <div className="brand">
          <span className="logo" aria-hidden="true">
            <Icon name="globe" />
          </span>
          Web Retrieval Agent
        </div>
        <span className="pill">Tavily · Groq · gpt-oss-120b</span>
      </nav>

      <main className="shell">
        <header className="hero">
          <h1>
            Ask the web.
            <br />
            <span className="grad">Get the exact answer.</span>
          </h1>
          <p>
            An AI agent that searches, reads real pages and returns only what you asked for, with the quote that proves it.
          </p>
        </header>

        <form
          className="ask"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(question);
          }}
        >
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void ask(question);
              }
            }}
            placeholder="Ask anything, e.g. What is the checkout deadline for the next AWS re:Invent?"
            maxLength={500}
            rows={2}
            aria-label="Your question"
          />
          <div className="ask-foot">
            <span className="hint">Enter to ask · Shift+Enter for a new line</span>
            <button type="submit" disabled={running || question.trim().length < 3}>
              {running ? (
                <>
                  <span className="spinner" aria-hidden="true" /> Working
                </>
              ) : (
                <>
                  Ask <Icon name="arrow" />
                </>
              )}
            </button>
          </div>
        </form>

        {idle && (
          <div className="examples">
            <span className="examples-label">Try one</span>
            {EXAMPLES.map((ex) => (
              <button key={ex} type="button" className="chip" onClick={() => void ask(ex)}>
                {ex}
              </button>
            ))}
          </div>
        )}

        {steps.length > 0 && <Timeline steps={steps} running={running} seconds={seconds} />}

        {running && !result && <Skeleton />}

        {error && (
          <div className="card error" role="alert">
            <strong>Something went wrong.</strong> {error}
          </div>
        )}

        {result && <Answer result={result} />}
      </main>

      <footer className="foot">Answers are generated from live web pages. Always check the linked sources for anything important.</footer>
    </div>
  );
}

function Timeline({ steps, running, seconds }: { steps: Step[]; running: boolean; seconds: number | null }) {
  return (
    <section className="timeline" aria-live="polite" aria-label="Agent progress">
      <h2 className="label">Agent activity</h2>
      <ol>
        {steps.map((s, i) => {
          const active = running && i === steps.length - 1;
          return (
            <li key={i} className={active ? "active" : "done"}>
              <span className="node" aria-hidden="true">
                {active ? <span className="spinner small" /> : <Icon name={s.stage} />}
              </span>
              <div className="step-body">
                <div className="msg">{s.message}</div>
                {s.detail && s.detail.length > 0 && (
                  <div className="detail">
                    {s.detail.map((d, j) => (
                      <span key={`${d}-${j}`}>{d}</span>
                    ))}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {!running && seconds !== null && <div className="took">Finished in {seconds.toFixed(1)}s</div>}
    </section>
  );
}

function Skeleton() {
  return (
    <div className="card skeleton" aria-hidden="true">
      <div className="bar w30" />
      <div className="bar w90" />
      <div className="bar w70" />
    </div>
  );
}

function Answer({ result }: { result: AgentResult }) {
  const [copied, setCopied] = useState(false);
  const byId = new Map(result.sources.map((s) => [s.id, s]));
  const level = result.confidence === "high" ? 3 : result.confidence === "medium" ? 2 : 1;

  async function copy() {
    try {
      await navigator.clipboard.writeText(result.answer);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable; ignore
    }
  }

  return (
    <section className={`card answer ${result.found ? "found" : "notfound"}`}>
      <div className="answer-head">
        <span className="label">{result.found ? "Answer" : "No direct answer found"}</span>
        <div className="meter" title={`${result.confidence} confidence`}>
          <span className="meter-bars" aria-hidden="true">
            {[1, 2, 3].map((n) => (
              <i key={n} className={n <= level ? `on ${result.confidence}` : ""} />
            ))}
          </span>
          <span className={`meter-text ${result.confidence}`}>{result.confidence} confidence</span>
        </div>
      </div>

      <p className="answer-text">{result.answer}</p>

      <button type="button" className="ghost" onClick={() => void copy()}>
        <Icon name="copy" /> {copied ? "Copied" : "Copy answer"}
      </button>

      {result.evidence.length > 0 && (
        <div className="block">
          <h3 className="label">{result.found ? "Proof from the page" : "Related information"}</h3>
          {result.evidence.map((e, i) => {
            const src = byId.get(e.source);
            return (
              <blockquote key={i}>
                <p>“{e.quote}”</p>
                {src && (
                  <a href={src.url} target="_blank" rel="noopener noreferrer" className="cite">
                    <span className="num">{src.id}</span>
                    <span className="cite-host">{hostOf(src.url) ?? src.url}</span>
                    <span className="cite-title">{src.title}</span>
                  </a>
                )}
              </blockquote>
            );
          })}
        </div>
      )}

      {result.notes.length > 0 && (
        <ul className="notes">
          {result.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}

      {result.sources.length > 0 && (
        <div className="block">
          <h3 className="label">Sources checked</h3>
          <ul className="sources">
            {result.sources.map((s) => (
              <li key={s.id}>
                <a href={s.url} target="_blank" rel="noopener noreferrer">
                  <span className="num">{s.id}</span>
                  <span className="src-text">
                    <span className="src-title">{s.title}</span>
                    <span className="src-host">{hostOf(s.url) ?? s.url}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

type IconName = Step["stage"] | "globe" | "arrow" | "copy";

function Icon({ name }: { name: IconName }) {
  const common = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (name) {
    case "plan":
      return (
        <svg {...common}>
          <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
        </svg>
      );
    case "search":
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.3-4.3" />
        </svg>
      );
    case "read":
      return (
        <svg {...common}>
          <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" />
          <path d="M14 3v5h5M9 13h6M9 17h6" />
        </svg>
      );
    case "answer":
      return (
        <svg {...common}>
          <path d="M21 15a2 2 0 01-2 2H8l-5 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
        </svg>
      );
    case "verify":
      return (
        <svg {...common}>
          <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      );
    case "retry":
      return (
        <svg {...common}>
          <path d="M3 12a9 9 0 0115.5-6.3L21 8M21 3v5h-5M21 12a9 9 0 01-15.5 6.3L3 16M3 21v-5h5" />
        </svg>
      );
    case "globe":
      return (
        <svg {...common} width={18} height={18}>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18" />
        </svg>
      );
    case "arrow":
      return (
        <svg {...common}>
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      );
    case "copy":
      return (
        <svg {...common} width={14} height={14}>
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <path d="M5 15V5a2 2 0 012-2h10" />
        </svg>
      );
  }
}
