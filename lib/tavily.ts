const BASE_URL = "https://api.tavily.com";
const REQUEST_TIMEOUT_MS = 40_000;

export type SearchHit = {
  title: string;
  url: string;
  content: string;
  score: number;
};

export type ExtractedPage = {
  url: string;
  content: string;
};

function apiKey() {
  const key = process.env.TAVILY_API_KEY;
  if (!key) throw new Error("Missing TAVILY_API_KEY. Add it to .env.local.");
  return key;
}

async function tavilyPost<T>(path: string, body: object, signal?: AbortSignal): Promise<T> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey()}`,
    },
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Tavily ${path} failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

export async function tavilySearch(
  query: string,
  opts: {
    maxResults?: number;
    topic?: "general" | "news";
    includeDomains?: string[];
    signal?: AbortSignal;
  } = {},
): Promise<SearchHit[]> {
  const data = await tavilyPost<{ results?: Partial<SearchHit>[] }>(
    "/search",
    {
      query,
      search_depth: "basic",
      max_results: opts.maxResults ?? 5,
      topic: opts.topic ?? "general",
      ...(opts.includeDomains?.length ? { include_domains: opts.includeDomains } : {}),
    },
    opts.signal,
  );
  return (data.results ?? [])
    .filter((r): r is Partial<SearchHit> & { url: string } => typeof r.url === "string")
    .map((r) => ({
      title: r.title ?? r.url,
      url: r.url,
      content: r.content ?? "",
      score: r.score ?? 0,
    }));
}

// Returns full page text for each URL that could be read. URLs that fail are
// simply absent from the result; callers fall back to the search snippet.
export async function tavilyExtract(urls: string[], signal?: AbortSignal): Promise<ExtractedPage[]> {
  if (urls.length === 0) return [];
  const data = await tavilyPost<{ results?: { url?: string; raw_content?: string }[] }>(
    "/extract",
    { urls, extract_depth: "basic" },
    signal,
  );
  return (data.results ?? [])
    .filter((r) => typeof r.url === "string" && typeof r.raw_content === "string" && r.raw_content.trim())
    .map((r) => ({ url: r.url as string, content: r.raw_content as string }));
}
