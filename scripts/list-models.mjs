// Usage: npm run models   (reads keys from .env.local)
const base = (process.env.LLM_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/+$/, "");
const key = process.env.LLM_API_KEY || process.env.GROQ_API_KEY;

if (!key) {
  console.error("Set GROQ_API_KEY in .env.local first.");
  process.exit(1);
}

const res = await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${key}` } });
if (!res.ok) {
  console.error(`Request failed (${res.status}): ${await res.text()}`);
  process.exit(1);
}

const { data } = await res.json();
for (const m of data.map((m) => m.id).sort()) console.log(m);
