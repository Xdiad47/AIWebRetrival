const STOPWORDS = new Set(
  "the a an and or of to in on for with is are was were be been what which who whom whose when where why how does do did can could should would will this that these those from by at as it its about into than then there their them they you your i me my we our us please tell find give show latest current".split(
    " ",
  ),
);

export function keywords(text: string): string[] {
  const words = text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}.'-]*/gu) ?? [];
  // Keep short tokens such as "pi" or "5": they often identify the product or version.
  return [...new Set(words.filter((w) => !STOPWORDS.has(w) && (w.length > 1 || /\d/.test(w))))];
}

// Lowercase and collapse everything that isn't a letter or digit, so a quote
// still matches after markdown, punctuation or whitespace differences.
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function quoteAppearsIn(quote: string, content: string): boolean {
  const q = normalize(quote);
  if (q.length < 8) return false;
  return normalize(content).includes(q);
}

// Pages are fetched as markdown; strip emphasis markers so quotes read cleanly.
export function cleanQuote(quote: string): string {
  return quote
    .replace(/\*\*|__|`/g, "")
    .replace(/(^|\s)[_*]([^_*\n]+)[_*](?=[\s.,;:!?)]|$)/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

function numberTokens(text: string): string[] {
  return (text.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/,/g, ""));
}

// Numbers stated in the answer that appear neither in the evidence quotes nor in
// the question. A figure the quotes don't contain is a sign of an unsupported claim.
export function unsupportedNumbers(answer: string, quotes: string[], question: string): string[] {
  const supported = new Set(numberTokens(`${quotes.join(" ")} ${question}`));
  return [...new Set(numberTokens(answer))].filter((n) => !supported.has(n));
}

export function relevanceScore(content: string, terms: string[]): number {
  const lower = content.toLowerCase();
  let hits = 0;
  for (const t of terms) if (lower.includes(t)) hits++;
  return hits;
}

// Keeps the paragraphs that best match the question (in original order) within
// a character budget, so long pages don't blow the model's context window.
export function relevantExcerpt(content: string, terms: string[], budget: number): string {
  const text = content.replace(/\r/g, "").trim();
  if (text.length <= budget) return text;

  const paragraphs = text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);

  const scored = paragraphs.map((p, index) => ({
    index,
    p,
    score: relevanceScore(p, terms) / Math.sqrt(p.length + 50),
  }));

  const chosen = new Set<number>([0]); // always keep the opening line for context
  let used = Math.min(paragraphs[0].length, budget);
  for (const item of [...scored].sort((a, b) => b.score - a.score)) {
    if (item.score === 0) break;
    if (chosen.has(item.index)) continue;
    const len = Math.min(item.p.length, budget);
    if (used + len > budget) continue;
    chosen.add(item.index);
    used += len;
  }

  return [...chosen]
    .sort((a, b) => a - b)
    .map((i) => paragraphs[i].slice(0, budget))
    .join("\n");
}

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function extractUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s)>\]"']+/g) ?? [];
  return [...new Set(matches.map((u) => u.replace(/[.,;:!?]+$/, "")))];
}
