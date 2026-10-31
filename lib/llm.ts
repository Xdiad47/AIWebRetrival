// Thin client for any OpenAI-compatible chat endpoint. Defaults to Groq, but
// LLM_BASE_URL can point at vLLM on an AMD GPU, Fireworks, etc. with no code change.

const DEFAULT_BASE_URL = "https://api.groq.com/openai/v1";
const DEFAULT_MODEL = "openai/gpt-oss-120b";
const REQUEST_TIMEOUT_MS = 45_000;
const MAX_ATTEMPTS = 3;
const MAX_WAIT_SEC = 15;

export type ChatMessage = { role: "system" | "user"; content: string };

// The model replied with something that wasn't JSON, usually a refusal.
export class ModelDeclinedError extends Error {
  constructor(public readonly reply: string) {
    super("The model declined or did not return JSON.");
  }
}

function llmConfig() {
  const apiKey = process.env.LLM_API_KEY || process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("Missing GROQ_API_KEY (or LLM_API_KEY). Add it to .env.local.");
  }
  const model = process.env.GROQ_MODEL || process.env.LLM_MODEL || DEFAULT_MODEL;
  return {
    apiKey,
    model,
    baseUrl: (process.env.LLM_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    // gpt-oss models are reasoning models; "low" keeps latency and token use down.
    reasoningEffort: process.env.LLM_REASONING_EFFORT || (model.includes("gpt-oss") ? "low" : ""),
  };
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

// Models sometimes wrap JSON in prose or code fences even in JSON mode.
function parseJsonLoose<T>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1)) as T;
      } catch {
        // fall through
      }
    }
    throw new ModelDeclinedError(text);
  }
}

function waitSeconds(res: Response, attempt: number): number {
  const header = Number(res.headers.get("retry-after"));
  const requested = Number.isFinite(header) && header > 0 ? header : 2 * (attempt + 1);
  // Token-per-minute limits can report a few milliseconds; wait at least a second.
  return Math.min(Math.max(requested, 1), MAX_WAIT_SEC);
}

export async function chatJSON<T>(
  messages: ChatMessage[],
  opts: { signal?: AbortSignal; maxTokens?: number; reasoningEffort?: "low" | "medium" | "high" } = {},
): Promise<T> {
  const config = llmConfig();
  const { apiKey, baseUrl, model } = config;
  // An explicit env setting wins; otherwise the caller's choice; otherwise the model default.
  const reasoningEffort = process.env.LLM_REASONING_EFFORT || (config.reasoningEffort ? opts.reasoningEffort || config.reasoningEffort : "");

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
    const last = attempt === MAX_ATTEMPTS - 1;

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0,
        max_tokens: opts.maxTokens ?? 1200,
        response_format: { type: "json_object" },
        ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
      }),
      signal,
    });

    if ((res.status === 429 || res.status >= 500) && !last) {
      await sleep(waitSeconds(res, attempt) * 1000, opts.signal);
      continue;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");

      // JSON mode failed because the model answered in prose (e.g. a refusal).
      if (res.status === 400 && body.includes("json_validate_failed")) {
        let reply = "";
        try {
          reply = (JSON.parse(body) as { error?: { failed_generation?: string } }).error?.failed_generation ?? "";
        } catch {
          // keep empty
        }
        throw new ModelDeclinedError(reply);
      }

      console.error(`LLM request failed (${res.status}):`, body.slice(0, 500));
      if (res.status === 429) {
        throw new Error("The AI model is rate-limited right now. Please try again in a few seconds.");
      }
      throw new Error(`The AI model request failed (${res.status}). Please try again.`);
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("The model returned an empty response.");
    return parseJsonLoose<T>(content);
  }

  throw new Error("The AI model request failed. Please try again.");
}
