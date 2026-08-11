// Model discovery — native API calls + models.dev catalog fallback
import type { DiscoveredModel, ProviderConfig, ModelCost, ThinkingLevelMap } from "./types";
import { usesAuthHeader } from "./types";

const CATALOG_URL = "https://models.dev/api.json";
const TIMEOUT_MS = 15_000;

// ─── External API response types ─────────────────────────────────

interface OpenAIModelsResp  { data?: Array<{ id: string }> }
interface OllamaTagsResp    { models?: Array<{ name: string; model: string }> }

interface AnthropicModelResp { id: string; display_name: string; max_input_tokens: number; max_tokens: number;
  capabilities?: { image_input?: { supported: boolean }; thinking?: { supported: boolean };
    effort?: { supported: boolean; low?: { supported: boolean }; medium?: { supported: boolean };
               high?: { supported: boolean }; max?: { supported: boolean }; xhigh?: { supported: boolean } } } }
interface AnthropicModelsResp { data?: AnthropicModelResp[] }

interface GeminiModelResp { name: string; baseModelId: string; displayName: string; inputTokenLimit: number;
  outputTokenLimit: number; supportedGenerationMethods: string[]; supportedActions?: string[]; thinking?: boolean }
interface GeminiModelsResp { models?: GeminiModelResp[] }

interface VertexModelResp { name: string; displayName: string; inputTokenLimit: number; outputTokenLimit: number;
  supportedGenerationMethods?: string[]; thinking?: boolean }
interface VertexModelsResp { models?: VertexModelResp[] }

interface CatalogProv { id: string; name: string; api: string; models: Record<string, CatalogMod> }
interface CatalogMod  { id: string; name: string; reasoning: boolean; modalities: { input: string[] };
  limit: { context: number; output: number };
  cost?: { input?: number; output?: number; cache_read?: number; cache_write?: number;
           tiers?: Array<{ input?: number; output?: number; cache_read?: number; cache_write?: number; tier?: { type: string; size: number } }> } }

interface HealthEndpoint { url: string; headers: Record<string, string> }

// ─── Public API ──────────────────────────────────────────────────

export async function discoverModels(providerId: string, provider: ProviderConfig, apiKey?: string): Promise<DiscoveredModel[]> {
  const native = await discoverNative(providerId, provider, apiKey);
  const catalog = await discoverCatalog(providerId, provider);
  if (native.length > 0) return catalog.length > 0 ? enrich(native, catalog) : native;
  if (catalog.length > 0) return catalog;
  throw new Error(`No models discovered for "${providerId}". Check the URL, API key, and network connectivity.`);
}

// ─── Native discovery dispatch ───────────────────────────────────

async function discoverNative(providerId: string, { baseUrl, api }: ProviderConfig, apiKey?: string): Promise<DiscoveredModel[]> {
  const bp = baseUrl.replace(/\/$/, ""), key = apiKey || "";
  if (isOllama(providerId, baseUrl))             return discoverOllama(bp);
  if (usesAuthHeader(api))                       return discoverOpenAI(bp, key);
  if (api === "anthropic-messages")              return discoverAnthropic(bp, key);
  if (api === "google-generative-ai")            return discoverGemini(bp, key);
  if (api === "google-vertex")                   return discoverVertex(bp, key);
  return [];
}

// ─── OpenAI-compatible ───────────────────────────────────────────

async function discoverOpenAI(baseUrl: string, apiKey: string): Promise<DiscoveredModel[]> {
  const r = await get<OpenAIModelsResp>(`${baseUrl}/models`, bearer(apiKey));
  return (r?.data || []).filter(m => m.id?.trim()).map(m => ({ id: m.id.trim(), name: m.id.trim() }));
}

// ─── Anthropic ───────────────────────────────────────────────────

async function discoverAnthropic(baseUrl: string, apiKey: string): Promise<DiscoveredModel[]> {
  const ep = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
  const r = await get<AnthropicModelsResp>(`${ep}/models?limit=1000`, { "x-api-key": apiKey, "anthropic-version": "2023-06-01" });
  return (r?.data || []).filter(m => m.id?.trim()).map(m => {
    const input = ["text"]; if (m.capabilities?.image_input?.supported) input.push("image");
    const tlm = buildAnthropicThinking(m.capabilities?.effort);
    return { id: m.id.trim(), name: m.display_name || m.id.trim(),
      reasoning: !!(m.capabilities?.thinking?.supported || m.capabilities?.effort?.supported),
      thinkingLevelMap: Object.keys(tlm).length ? tlm : undefined,
      input, contextWindow: m.max_input_tokens || 200000, maxTokens: m.max_tokens || 64000 };
  });
}

function buildAnthropicThinking(effort?: { supported: boolean; low?: { supported: boolean }; medium?: { supported: boolean }; high?: { supported: boolean }; max?: { supported: boolean }; xhigh?: { supported: boolean } }): ThinkingLevelMap {
  const m: ThinkingLevelMap = {};
  if (!effort?.supported) return m;
  for (const [k, v] of [["low","low"],["medium","medium"],["high","high"],["xhigh","xhigh"],["max","max"]] as const)
    m[k as keyof ThinkingLevelMap] = effort[k as keyof typeof effort]?.supported ? v : null;
  return m;
}

// ─── Google AI Studio ────────────────────────────────────────────

async function discoverGemini(baseUrl: string, apiKey: string): Promise<DiscoveredModel[]> {
  const ep = baseUrl.endsWith("/v1beta") ? baseUrl : `${baseUrl}/v1beta`;
  const r = await get<GeminiModelsResp>(`${ep}/models?pageSize=1000`, { "x-goog-api-key": apiKey });
  return (r?.models || []).filter(m => (m.supportedGenerationMethods || m.supportedActions || []).includes("generateContent"))
    .map(m => ({ id: (m.baseModelId || m.name).replace(/^models\//, ""), name: m.displayName || m.baseModelId || m.name,
      reasoning: !!m.thinking, input: ["text","image"], contextWindow: m.inputTokenLimit || 128000, maxTokens: m.outputTokenLimit || 8192 }))
    .filter(m => m.id);
}

// ─── Ollama ──────────────────────────────────────────────────────

async function discoverOllama(baseUrl: string): Promise<DiscoveredModel[]> {
  const r = await get<OllamaTagsResp>(`${baseUrl.replace(/\/v1\/?$/, "")}/api/tags`);
  return (r?.models || []).filter(m => (m.model || m.name)?.trim())
    .map(m => ({ id: (m.model||m.name).trim(), name: (m.model||m.name).trim() }));
}

// ─── Google Vertex ───────────────────────────────────────────────

async function discoverVertex(baseUrl: string, apiKey: string): Promise<DiscoveredModel[]> {
  if (!apiKey) return [];
  try {
    const ep = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
    const r = await get<VertexModelsResp>(`${ep}/publishers/google/models?pageSize=1000`, { Authorization: `Bearer ${apiKey}` });
    return (r?.models || []).filter(m => (m.supportedGenerationMethods || []).includes("generateContent"))
      .map(m => ({ id: m.name.replace(/^publishers\/google\/models\//, ""), name: m.displayName || m.name,
        reasoning: !!m.thinking, input: ["text","image"], contextWindow: m.inputTokenLimit || 128000, maxTokens: m.outputTokenLimit || 8192 }))
      .filter(m => m.id);
  } catch { return []; }
}

// ─── Catalog fallback ────────────────────────────────────────────

async function discoverCatalog(providerId: string, provider: ProviderConfig): Promise<DiscoveredModel[]> {
  try {
    const catalog = await get<Record<string, CatalogProv>>(CATALOG_URL);
    if (!catalog) return [];
    const entry = findEntry(catalog, providerId, provider.baseUrl);
    if (!entry) return [];
    return Object.entries(entry.models).map(([id, m]) => ({
      id: (m.id || id).trim(), name: m.name || (m.id || id).trim(), reasoning: !!m.reasoning,
      input: inputFilter(m.modalities?.input), contextWindow: m.limit?.context || 128000, maxTokens: m.limit?.output || 16384,
      cost: toModelCost(m.cost),
    }));
  } catch { return []; }
}

function findEntry(catalog: Record<string, CatalogProv>, name: string, baseUrl: string): CatalogProv | undefined {
  for (const hint of hints(name, baseUrl)) {
    if (catalog[hint]) return catalog[hint];
    for (const [k, v] of Object.entries(catalog))
      if (norm(k) === hint || norm(v.id) === hint || norm(v.name) === hint) return v;
  }
}

function enrich(native: DiscoveredModel[], catalog: DiscoveredModel[]): DiscoveredModel[] {
  const map = new Map(catalog.map(m => [m.id, m]));
  return native.map(m => { const e = map.get(m.id); return e ? { ...e, thinkingLevelMap: m.thinkingLevelMap || e.thinkingLevelMap } : m; });
}

// ─── Health check ────────────────────────────────────────────────

export async function checkProviderHealth(providerId: string, provider: ProviderConfig, apiKey?: string): Promise<{ reachable: boolean; latencyMs: number; error?: string }> {
  const start = Date.now(), key = apiKey || "";
  try {
    const { url, headers } = healthEndpoint(providerId, provider, key);
    const r = await fetchTimeout(url, { headers }, 10_000);
    const ms = Date.now() - start;
    return { reachable: r.ok, latencyMs: ms, error: r.ok ? undefined : `HTTP ${r.status}` };
  } catch (err) { return { reachable: false, latencyMs: Date.now() - start, error: serr(err) }; }
}

// Lookup map replaces if-else chain
function healthEndpoint(providerId: string, { baseUrl, api }: ProviderConfig, key: string): HealthEndpoint {
  const bp = baseUrl.replace(/\/$/, "");
  const v1  = (b: string) => b.endsWith("/v1") ? b : `${b}/v1`;
  const vb  = (b: string) => b.endsWith("/v1beta") ? b : `${b}/v1beta`;

  if (isOllama(providerId, baseUrl)) return { url: `${bp.replace(/\/v1\/?$/, "")}/api/tags`, headers: {} };

  const routes: Record<string, () => HealthEndpoint> = {
    "anthropic-messages":      () => ({ url: `${v1(bp)}/models?limit=1`, headers: { "x-api-key": key, "anthropic-version": "2023-06-01" } }),
    "google-generative-ai":    () => ({ url: `${vb(bp)}/models?pageSize=1`, headers: { "x-goog-api-key": key } }),
    "google-vertex":           () => ({ url: `${v1(bp)}/publishers/google/models?pageSize=1`, headers: key ? { Authorization: `Bearer ${key}` } : {} }),
    "azure-openai-responses":  () => ({ url: `${bp}/models?api-version=2024-10-21`, headers: { "api-key": key } }),
  };

  if (routes[api]) return routes[api]();
  return { url: `${bp}/models`, headers: bearer(key) };
}

// ─── Chat test ───────────────────────────────────────────────────

export async function testChatCompletion(provider: ProviderConfig, modelId: string, apiKey: string): Promise<{ success: boolean; response?: string; latencyMs: number; error?: string }> {
  const bp = provider.baseUrl.replace(/\/$/, ""), start = Date.now();
  try {
    if (provider.api === "anthropic-messages")   return chatAnthropic(bp, modelId, apiKey, start);
    if (provider.api === "google-generative-ai") return chatGoogle(bp, modelId, apiKey, start);
    return chatOpenAI(bp, modelId, apiKey, start);
  } catch (err) { return { success: false, latencyMs: Date.now() - start, error: serr(err) }; }
}

async function chatOpenAI(baseUrl: string, modelId: string, apiKey: string, start: number) {
  const r = await post(`${baseUrl}/chat/completions`, { model: modelId, max_tokens: 256, messages: [{ role: "user", content: "Say hello in one sentence." }] }, bearer(apiKey));
  return chatResult(r, start, (d: any) => d.choices?.[0]?.message?.content);
}
async function chatAnthropic(baseUrl: string, modelId: string, apiKey: string, start: number) {
  const ep = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
  const r = await post(`${ep}/messages`, { model: modelId, max_tokens: 256, messages: [{ role: "user", content: "Say hello in one sentence." }] }, { "x-api-key": apiKey, "anthropic-version": "2023-06-01" });
  return chatResult(r, start, (d: any) => d.content?.map((c: any) => c.text || "").join(""));
}
async function chatGoogle(baseUrl: string, modelId: string, apiKey: string, start: number) {
  const ep = baseUrl.endsWith("/v1beta") ? baseUrl : `${baseUrl}/v1beta`;
  const qs = apiKey ? `?key=${encodeURIComponent(apiKey)}` : "";
  const r = await post(`${ep}/models/${modelId}:generateContent${qs}`, { contents: [{ parts: [{ text: "Say hello in one sentence." }] }] });
  return chatResult(r, start, (d: any) => d.candidates?.[0]?.content?.parts?.map((p: any) => p.text || "").join(""));
}
async function chatResult<T>(resp: Response, start: number, extract: (d: T) => string | undefined) {
  const ms = Date.now() - start;
  if (!resp.ok) { const e = await resp.text().catch(() => ""); return { success: false, latencyMs: ms, error: `HTTP ${resp.status}: ${e.slice(0, 200)}` }; }
  return { success: true, response: extract(await resp.json() as T) || "(empty)", latencyMs: ms };
}

// ─── Helpers ─────────────────────────────────────────────────────

function bearer(key: string): Record<string, string> { return key ? { Authorization: `Bearer ${key}` } : {}; }
function serr(err: unknown): string { return err instanceof Error ? err.message : String(err); }

function isOllama(name: string, baseUrl: string): boolean {
  return norm(name) === "ollama" || (() => { try { return new URL(baseUrl).port === "11434" } catch { return false } })();
}

function hints(name: string, baseUrl: string): string[] {
  const seen = new Set<string>(), out: string[] = [];
  const add = (v: string) => { const k = norm(v); if (k && !seen.has(k)) { seen.add(k); out.push(k); } };
  add(name); for (const w of name.split(/[^a-zA-Z0-9]+/)) add(w);
  try { for (const l of new URL(baseUrl).hostname.split(".")) { if (!["","api","llm","www","com","net","org","ai","cn"].includes(l.toLowerCase())) add(l); } } catch {}
  return out;
}

function norm(v: string): string { return v.toLowerCase().replace(/[^a-z0-9]/g, "").trim(); }
function inputFilter(input?: string[]): string[] { const r = (input || []).filter(v => v === "text" || v === "image"); return r.length ? [...new Set(r)] : ["text"]; }

export function toModelCost(c?: CatalogMod["cost"]): ModelCost | undefined {
  if (!c) return;
  const value = (n: number | undefined) => typeof n === "number" && Number.isFinite(n) ? n : 0;
  const cost: ModelCost = {
    input: value(c.input),
    output: value(c.output),
    cacheRead: value(c.cache_read),
    cacheWrite: value(c.cache_write),
  };
  const tiers = c.tiers
    ?.filter(t => t.tier?.type === "context" && Number.isFinite(t.tier.size))
    .map(t => ({
      inputTokensAbove: t.tier!.size,
      input: value(t.input),
      output: value(t.output),
      cacheRead: value(t.cache_read),
      cacheWrite: value(t.cache_write),
    }));
  if (tiers?.length) cost.tiers = tiers;
  return cost;
}

// ─── Fetch ───────────────────────────────────────────────────────

async function get<T>(url: string, headers?: Record<string, string>): Promise<T | undefined> {
  const r = await fetchTimeout(url, headers ? { headers } : undefined);
  return r.ok ? r.json() as T : undefined;
}

async function post(url: string, body: unknown, extraHeaders?: Record<string, string>): Promise<Response> {
  return fetchTimeout(url, { method: "POST", headers: { ...extraHeaders, "content-type": "application/json" }, body: JSON.stringify(body) });
}

async function fetchTimeout(url: string, init?: RequestInit, ms = TIMEOUT_MS): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...init, signal: ctrl.signal }); }
  catch (err) { if (err instanceof Error && err.name === "AbortError") throw new Error(`Timeout after ${ms}ms: ${url}`); throw err; }
  finally { clearTimeout(t); }
}
