import { runAgent, type AgentEvent } from "@/lib/agent";
import { checkRateLimit } from "@/lib/rate-limit";

// Agent runs (plan + search + read + answer) can take a while.
export const maxDuration = 60;

const MAX_QUESTION_CHARS = 500;

function json(body: object, status: number, headers?: Record<string, string>) {
  return Response.json(body, { status, headers });
}

export async function POST(request: Request) {
  let question = "";
  try {
    const body = (await request.json()) as { question?: unknown };
    if (typeof body.question === "string") question = body.question.trim();
  } catch {
    return json({ error: "Send a JSON body like {\"question\": \"...\"}." }, 400);
  }

  if (question.length < 3) return json({ error: "Please enter a question." }, 400);
  if (question.length > MAX_QUESTION_CHARS) {
    return json({ error: `Questions are limited to ${MAX_QUESTION_CHARS} characters.` }, 400);
  }

  if (!process.env.TAVILY_API_KEY || !(process.env.GROQ_API_KEY || process.env.LLM_API_KEY)) {
    return json({ error: "The server is missing its API keys (TAVILY_API_KEY, GROQ_API_KEY)." }, 500);
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limit = checkRateLimit(ip);
  if (!limit.ok) {
    return json({ error: "Too many requests. Please wait a bit and try again." }, 429, {
      "Retry-After": String(limit.retryAfterSec),
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: AgentEvent) => controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      try {
        for await (const event of runAgent(question, request.signal)) send(event);
      } catch (err) {
        if (!request.signal.aborted) {
          console.error("agent error", err);
          send({ type: "error", message: err instanceof Error ? err.message : "Something went wrong." });
        }
      } finally {
        try {
          controller.close();
        } catch {
          // client already disconnected
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
    },
  });
}
