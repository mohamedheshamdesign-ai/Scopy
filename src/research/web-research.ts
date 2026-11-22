export interface WebSearchResult {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
}
export interface WebSearchResponse {
  readonly query: string;
  readonly provider: "DuckDuckGo HTML";
  readonly results: readonly WebSearchResult[];
  readonly retrievedAt: string;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_match, number: string) => String.fromCodePoint(Number(number)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, number: string) => String.fromCodePoint(parseInt(number, 16)));
}

function plainText(value: string): string {
  return decodeEntities(value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}

function unwrapResultUrl(raw: string): string | null {
  try {
    const candidate = new URL(decodeEntities(raw), "https://html.duckduckgo.com");
    const redirect = candidate.searchParams.get("uddg");
    const url = new URL(redirect ?? candidate.href);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export async function searchWeb(query: string, limit = 8): Promise<WebSearchResponse> {
  const normalized = query.trim();
  if (normalized.length < 2 || normalized.length > 400) throw new Error("Search query must contain between 2 and 400 characters.");
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new Error("Search result limit must be between 1 and 10.");
  const endpoint = new URL("https://html.duckduckgo.com/html/");
  endpoint.searchParams.set("q", normalized);
  const response = await fetch(endpoint, {
    headers: {
      "user-agent": "ScopyLocalResearch/1.0 (+local user-initiated research)",
      accept: "text/html,application/xhtml+xml",
    },
    signal: AbortSignal.timeout(20_000),
    redirect: "error",
  });
  if (!response.ok) throw new Error("Search provider returned HTTP " + response.status + ".");
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("text/html")) throw new Error("Search provider returned an unexpected content type.");
  const html = await response.text();
  if (Buffer.byteLength(html, "utf8") > 2_000_000) throw new Error("Search response exceeded the 2 MiB limit.");
  const results: WebSearchResult[] = [];
  const blocks = html.match(/<div[^>]*class="[^"]*result[^"]*"[^>]*>[\s\S]*?(?=<div[^>]*class="[^"]*result[^"]*"|$)/gi) ?? [];
  for (const block of blocks) {
    if (results.length >= limit) break;
    const anchor = block.match(/<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!anchor) continue;
    const url = unwrapResultUrl(anchor[1]!);
    const title = plainText(anchor[2]!);
    const snippetMatch = block.match(/<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>|<td[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
    const snippet = plainText(snippetMatch?.[1] ?? snippetMatch?.[2] ?? "");
    if (!url || !title) continue;
    results.push({ title: title.slice(0, 300), url, snippet: snippet.slice(0, 900) });
  }
  return { query: normalized, provider: "DuckDuckGo HTML", results, retrievedAt: new Date().toISOString() };
}
