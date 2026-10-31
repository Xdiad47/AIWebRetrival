# Web Retrieval Agent

Ask a question in plain English. The agent plans searches, reads the pages (Tavily), extracts the specific answer (Groq LLM) and shows the exact quote that proves it. Quotes are checked against the real page text, and the agent says "not found" when the sources don't contain the answer.

## Run locally

```bash
npm install
# put your keys in .env.local (see .env.example)
npm run dev        # http://localhost:3000
npm run models     # list the models your Groq key can use; set GROQ_MODEL accordingly
```

## How it works

`app/api/ask/route.ts` streams the agent's steps as NDJSON. `lib/agent.ts` runs: plan queries, search, read pages, answer with quotes, verify quotes, and retry once with refined queries (optionally focused on one domain) if the answer isn't confirmed.

The LLM client (`lib/llm.ts`) works with any OpenAI-compatible endpoint. Set `LLM_BASE_URL` (and `LLM_API_KEY`/`GROQ_MODEL`) to use vLLM on the AMD notebook instead of Groq.

## Deploy (Vercel)

Import the repo, add `TAVILY_API_KEY` and `GROQ_API_KEY` as environment variables, deploy. The agent route sets `maxDuration = 60`; check your plan's function time limit.
