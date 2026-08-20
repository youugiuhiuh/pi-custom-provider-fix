// Model discovery — native API calls + models.dev catalog fallback
import type { DiscoveredModel, ProviderConfig, ModelCost, ThinkingLevelMap } from "./types";
import { usesAuthHeader } from "./types";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import type { Api, Model } from "@earendil-works/pi-ai";

const CATALOG_URL = "https://models.dev/api.json";
const TIMEOUT_MS = 15_000;

// ─── External API response types ─────────────────────────────────

interface OpenAIModelsResp {
  data?: Array<{ id: string }>;
}
interface OllamaTagsResp {
  models?: Array<{ name: string; model: string }>;
}

interface AnthropicModelResp {
  id: string;
  display_name: string;
  max_input_tokens: number;
  max_tokens: number;
  capabilities?: {
    image_input?: { supported: boolean };
    thinking?: { supported: boolean };
    effort?: {
      supported: boolean;
      low?: { supported: boolean };
      medium?: { supported: boolean };
      high?: { supported: boolean };
      max?: { supported: boolean };
      xhigh?: { supported: boolean };
    };
  };
}
interface AnthropicModelsResp {
  data?: AnthropicModelResp[];
}

interface GeminiModelResp {
  name: string;
  baseModelId: string;
  displayName: string;
  inputTokenLimit: number;
  outputTokenLimit: number;
  supportedGenerationMethods: string[];
  supportedActions?: string[];
  thinking?: boolean;
}
interface GeminiModelsResp {
  models?: GeminiModelResp[];
}

interface VertexModelResp {
  name: string;
  displayName: string;
  inputTokenLimit: number;
  outputTokenLimit: number;
  supportedGenerationMethods?: string[];
  thinking?: boolean;
}
interface VertexModelsResp {
  models?: VertexModelResp[];
}

interface CatalogProv {
  id?: string;
  name?: string;
  models: Record<string, CatalogMod>;
}
interface CatalogMod {
  id?: string;
  name?: string;
  reasoning?: boolean;
  modalities?: { input?: string[] };
  limit?: { context?: number; output?: number };
  cost?: {
    input?: number;
    output?: number;
    cache_read?: number;
    cache_write?: number;
    tiers?: Array<{
      input?: number;
      output?: number;
      cache_read?: number;
      cache_write?: number;
      tier?: { type: string; size: number };
    }>;
  };
}

interface HealthEndpoint {
  url: string;
  headers: Record<string, string>;
}

interface RecommendationModel extends DiscoveredModel {
  reasoning: boolean;
  input: string[];
  contextWindow: number;
  maxTokens: number;
  catalogApi?: string;
}

interface RecommendationProvider {
  id: string;
  name: string;
  baseUrl?: string;
  priority: number;
  models: RecommendationModel[];
}

interface IndexedRecommendation {
  provider: RecommendationProvider;
  model: RecommendationModel;
}

interface RecommendationIndex {
  providers: RecommendationProvider[];
  exact: Map<string, IndexedRecommendation[]>;
  leaf: Map<string, IndexedRecommendation[]>;
}

export interface ModelPresetModel extends DiscoveredModel {
  reasoning: boolean;
  input: string[];
  contextWindow: number;
  maxTokens: number;
}

export interface ModelPreset {
  key: string;
  label: string;
  providerId: string;
  modelId: string;
  model: ModelPresetModel;
  recommended: boolean;
}

// ─── Public API ──────────────────────────────────────────────────

export async function discoverModels(
  providerId: string,
  provider: ProviderConfig,
  apiKey?: string,
): Promise<DiscoveredModel[]> {
  const [nativeResult, catalog] = await Promise.all([
    discoverNative(providerId, provider, apiKey).then(
      (models) => ({ models }),
      (error: unknown) => ({ models: [] as DiscoveredModel[], error }),
    ),
    loadCatalog(),
  ]);
  const models = recommendModels(nativeResult.models, providerId, provider, catalog);
  if (models.length > 0) return models;
  const nativeError = "error" in nativeResult ? ` Native discovery failed: ${serr(nativeResult.error)}` : "";
  throw new Error(
    `No models discovered for "${providerId}". Check the URL, API key, and network connectivity.${nativeError}`,
  );
}

/** Look up metadata for a manually entered model id without contacting the provider's model endpoint. */
export async function recommendModel(
  modelId: string,
  providerId: string,
  provider: ProviderConfig,
): Promise<DiscoveredModel | undefined> {
  const localMatch = findRecommendation(buildRecommendationIndex({}), modelId, providerId, provider);
  if (localMatch) return recommendationCandidate(localMatch, provider.api, "model-id", modelId);
  const catalog = await loadCatalog();
  const match = findRecommendation(buildRecommendationIndex(catalog), modelId, providerId, provider);
  return match ? recommendationCandidate(match, provider.api, "model-id", modelId) : undefined;
}

// ─── Native discovery dispatch ───────────────────────────────────

async function discoverNative(
  providerId: string,
  { baseUrl, api }: ProviderConfig,
  apiKey?: string,
): Promise<DiscoveredModel[]> {
  const bp = baseUrl.replace(/\/$/, ""),
    key = apiKey || "";
  if (isOllama(providerId, baseUrl)) return discoverOllama(bp);
  if (usesAuthHeader(api)) return discoverOpenAI(bp, key);
  if (api === "anthropic-messages") return discoverAnthropic(bp, key);
  if (api === "google-generative-ai") return discoverGemini(bp, key);
  if (api === "google-vertex") return discoverVertex(bp, key);
  return [];
}

// ─── OpenAI-compatible ───────────────────────────────────────────

async function discoverOpenAI(baseUrl: string, apiKey: string): Promise<DiscoveredModel[]> {
  const r = await get<OpenAIModelsResp>(`${baseUrl}/models`, bearer(apiKey));
  return (r?.data || []).filter((m) => m.id?.trim()).map((m) => ({ id: m.id.trim(), name: m.id.trim() }));
}

// ─── Anthropic ───────────────────────────────────────────────────

async function discoverAnthropic(baseUrl: string, apiKey: string): Promise<DiscoveredModel[]> {
  const ep = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
  const r = await get<AnthropicModelsResp>(`${ep}/models?limit=1000`, {
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
  });
  return (r?.data || [])
    .filter((m) => m.id?.trim())
    .map((m) => {
      const input = ["text"];
      if (m.capabilities?.image_input?.supported) input.push("image");
      const tlm = buildAnthropicThinking(m.capabilities?.effort);
      return {
        id: m.id.trim(),
        name: m.display_name || m.id.trim(),
        reasoning: !!(m.capabilities?.thinking?.supported || m.capabilities?.effort?.supported),
        thinkingLevelMap: Object.keys(tlm).length ? tlm : undefined,
        input,
        contextWindow: m.max_input_tokens || 200000,
        maxTokens: m.max_tokens || 64000,
      };
    });
}

function buildAnthropicThinking(effort?: {
  supported: boolean;
  low?: { supported: boolean };
  medium?: { supported: boolean };
  high?: { supported: boolean };
  max?: { supported: boolean };
  xhigh?: { supported: boolean };
}): ThinkingLevelMap {
  const m: ThinkingLevelMap = {};
  if (!effort?.supported) return m;
  for (const level of ["low", "medium", "high", "xhigh", "max"] as const) {
    m[level] = effort[level]?.supported ? level : null;
  }
  return m;
}

// ─── Google AI Studio ────────────────────────────────────────────

async function discoverGemini(baseUrl: string, apiKey: string): Promise<DiscoveredModel[]> {
  const ep = baseUrl.endsWith("/v1beta") ? baseUrl : `${baseUrl}/v1beta`;
  const r = await get<GeminiModelsResp>(`${ep}/models?pageSize=1000`, { "x-goog-api-key": apiKey });
  return (r?.models || [])
    .filter((m) => (m.supportedGenerationMethods || m.supportedActions || []).includes("generateContent"))
    .map((m) => ({
      id: (m.baseModelId || m.name).replace(/^models\//, ""),
      name: m.displayName || m.baseModelId || m.name,
      reasoning: !!m.thinking,
      input: ["text", "image"],
      contextWindow: m.inputTokenLimit || 128000,
      maxTokens: m.outputTokenLimit || 8192,
    }))
    .filter((m) => m.id);
}

// ─── Ollama ──────────────────────────────────────────────────────

async function discoverOllama(baseUrl: string): Promise<DiscoveredModel[]> {
  const r = await get<OllamaTagsResp>(`${baseUrl.replace(/\/v1\/?$/, "")}/api/tags`);
  return (r?.models || [])
    .filter((m) => (m.model || m.name)?.trim())
    .map((m) => ({ id: (m.model || m.name).trim(), name: (m.model || m.name).trim() }));
}

// ─── Google Vertex ───────────────────────────────────────────────

async function discoverVertex(baseUrl: string, apiKey: string): Promise<DiscoveredModel[]> {
  if (!apiKey) return [];
  try {
    const ep = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
    const r = await get<VertexModelsResp>(`${ep}/publishers/google/models?pageSize=1000`, {
      Authorization: `Bearer ${apiKey}`,
    });
    return (r?.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
      .map((m) => ({
        id: m.name.replace(/^publishers\/google\/models\//, ""),
        name: m.displayName || m.name,
        reasoning: !!m.thinking,
        input: ["text", "image"],
        contextWindow: m.inputTokenLimit || 128000,
        maxTokens: m.outputTokenLimit || 8192,
      }))
      .filter((m) => m.id);
  } catch {
    return [];
  }
}

// ─── Recommendations: model id first, then base URL ─────────────

async function loadCatalog(): Promise<Record<string, CatalogProv>> {
  try {
    return (await get<Record<string, CatalogProv>>(CATALOG_URL)) || {};
  } catch {
    return {};
  }
}

let piRecommendations: RecommendationProvider[] | undefined;

function getPiRecommendations(): RecommendationProvider[] {
  return (piRecommendations ||= builtinProviders().map((provider) => ({
    id: provider.id,
    name: provider.name,
    baseUrl: provider.baseUrl,
    priority: 2,
    models: provider.getModels().map(fromPiModel),
  })));
}

/** List complete pi-ai model configurations for explicit manual selection. */
export function listModelPresets(api: ProviderConfig["api"], modelId: string, filter = ""): ModelPreset[] {
  const query = filter.trim().toLowerCase();
  return getPiRecommendations()
    .flatMap((provider) =>
      provider.models
        .filter((model) => model.catalogApi === api)
        .map((model) => {
          const score = modelPresetScore(modelId, model.id);
          const { catalogApi: _catalogApi, ...presetModel } = model;
          return {
            key: `${provider.id}/${model.id}`,
            label: `${provider.id} / ${model.id}`,
            providerId: provider.id,
            modelId: model.id,
            model: {
              ...presetModel,
              input: [...presetModel.input],
              cost: cloneModelCost(presetModel.cost),
              thinkingLevelMap: presetModel.thinkingLevelMap ? { ...presetModel.thinkingLevelMap } : undefined,
              compat: presetModel.compat ? { ...presetModel.compat } : undefined,
            },
            recommended: score >= 700,
            score,
          };
        }),
    )
    .filter((preset) => !query || preset.label.toLowerCase().includes(query))
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
    .map(({ score: _score, ...preset }) => preset);
}

function modelPresetScore(actual: string, preset: string): number {
  const left = normalizedModelId(actual),
    right = normalizedModelId(preset);
  if (left === right) return 1000;
  if (modelLeaf(left) === modelLeaf(right)) return 900;
  const compactLeft = norm(left),
    compactRight = norm(right);
  if (compactRight.length >= 6 && compactLeft.endsWith(compactRight)) return 800;
  if (compactRight.length >= 6 && compactLeft.includes(compactRight)) return 700;
  return 0;
}

function cloneModelCost(cost: ModelCost | undefined): ModelCost | undefined {
  return cost
    ? {
        ...cost,
        tiers: cost.tiers?.map((entry) => ({ ...entry })),
      }
    : undefined;
}

/** Build selectable candidates. Native ids are enriched first; URL matches only add suggestions. */
export function recommendModels(
  native: DiscoveredModel[],
  providerId: string,
  provider: ProviderConfig,
  catalog: Record<string, CatalogProv> = {},
): DiscoveredModel[] {
  const index = buildRecommendationIndex(catalog);
  const result = native.map((model) => {
    const match = findRecommendation(index, model.id, providerId, provider);
    if (match) return mergeNative(model, recommendationCandidate(match, provider.api, "model-id", model.id));
    return { ...model, suggestedBy: "api" as const };
  });

  // Base URL is a secondary recommendation source. These models are not
  // enabled automatically; the wizard presents them in the same pick list.
  const seen = new Set(result.map((model) => normalizedModelId(model.id)));
  const urlMatches = index.providers
    .map((entry) => ({ entry, score: recommendationProviderScore(provider.baseUrl, entry) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.entry.priority - a.entry.priority)
    .map((x) => x.entry);
  for (const entry of urlMatches) {
    for (const model of entry.models) {
      if (model.catalogApi && model.catalogApi !== provider.api) continue;
      appendCandidate(result, recommendationCandidate({ provider: entry, model }, provider.api, "base-url"), seen);
    }
  }
  return result;
}

function buildRecommendationIndex(catalog: Record<string, CatalogProv>): RecommendationIndex {
  const providers = [...getPiRecommendations(), ...fromRemoteCatalog(catalog)];
  const exact = new Map<string, IndexedRecommendation[]>(),
    leaf = new Map<string, IndexedRecommendation[]>();
  for (const provider of providers) {
    for (const model of provider.models) {
      addToIndex(exact, normalizedModelId(model.id), { provider, model });
      addToIndex(leaf, modelLeaf(model.id), { provider, model });
    }
  }
  return { providers, exact, leaf };
}

function addToIndex(index: Map<string, IndexedRecommendation[]>, key: string, value: IndexedRecommendation): void {
  const values = index.get(key);
  if (values) values.push(value);
  else index.set(key, [value]);
}

function fromRemoteCatalog(catalog: Record<string, CatalogProv>): RecommendationProvider[] {
  return Object.entries(catalog).map(([key, provider]) => ({
    id: provider.id || key,
    name: provider.name || provider.id || key,
    priority: 1,
    models: Object.entries(provider.models || {}).map(([modelKey, model]) => fromCatalogModel(modelKey, model)),
  }));
}

function findRecommendation(
  index: RecommendationIndex,
  modelId: string,
  providerId: string,
  provider: ProviderConfig,
): IndexedRecommendation | undefined {
  const exact = index.exact.get(normalizedModelId(modelId)) || [];
  const leafFallback = exact.length === 0;
  let pool = exact.length ? exact : index.leaf.get(modelLeaf(modelId)) || [];
  const compatible = pool.filter(({ model }) => !model.catalogApi || model.catalogApi === provider.api);
  if (compatible.length) pool = compatible;
  if (!pool.length) return;

  const ranked = [...pool].sort(
    (a, b) =>
      recommendationProviderScore(provider.baseUrl, b.provider) -
        recommendationProviderScore(provider.baseUrl, a.provider) ||
      providerIdentityScore(providerId, b.provider) - providerIdentityScore(providerId, a.provider) ||
      b.provider.priority - a.provider.priority,
  );
  if (leafFallback) {
    const distinctIds = new Set(pool.map(({ model }) => normalizedModelId(model.id)));
    const best = ranked[0];
    if (
      distinctIds.size > 1 &&
      recommendationProviderScore(provider.baseUrl, best.provider) === 0 &&
      providerIdentityScore(providerId, best.provider) === 0
    )
      return;
  }
  return ranked[0];
}

function providerIdentityScore(providerId: string, provider: RecommendationProvider): number {
  const wanted = norm(providerId);
  return [provider.id, provider.name].some((value) => norm(value) === wanted) ? 1 : 0;
}

function recommendationProviderScore(baseUrl: string, provider: RecommendationProvider): number {
  const declaredUrlScore = provider.baseUrl ? baseUrlScore(baseUrl, provider.baseUrl) : 0;
  if (declaredUrlScore) return 1000 + declaredUrlScore;
  return Math.max(baseUrlIdentityScore(baseUrl, provider.id), baseUrlIdentityScore(baseUrl, provider.name));
}

function fromPiModel(model: Model<Api>): RecommendationModel {
  return {
    id: model.id,
    name: model.name || model.id,
    reasoning: model.reasoning,
    input: [...model.input],
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    cost: model.cost as ModelCost,
    thinkingLevelMap: model.thinkingLevelMap,
    compat: model.compat as Record<string, unknown> | undefined,
    catalogApi: model.api,
  };
}

function fromCatalogModel(key: string, model: CatalogMod): RecommendationModel {
  const id = (model.id || key).trim();
  return {
    id,
    name: model.name || id,
    reasoning: !!model.reasoning,
    input: inputFilter(model.modalities?.input),
    contextWindow: model.limit?.context || 128000,
    maxTokens: model.limit?.output || 16384,
    cost: toModelCost(model.cost),
  };
}

function recommendationCandidate(
  recommendation: IndexedRecommendation,
  api: ProviderConfig["api"],
  suggestedBy: DiscoveredModel["suggestedBy"],
  id = recommendation.model.id,
): DiscoveredModel {
  const { catalogApi, ...model } = recommendation.model;
  return {
    ...model,
    id,
    compat: !catalogApi || catalogApi === api ? model.compat : undefined,
    suggestedBy,
  };
}

function mergeNative(native: DiscoveredModel, suggested: DiscoveredModel): DiscoveredModel {
  return {
    ...suggested,
    id: native.id,
    name: native.name !== native.id ? native.name : suggested.name,
    reasoning: native.reasoning ?? suggested.reasoning,
    input: native.input ?? suggested.input,
    contextWindow: native.contextWindow ?? suggested.contextWindow,
    maxTokens: native.maxTokens ?? suggested.maxTokens,
    cost: native.cost ?? suggested.cost,
    thinkingLevelMap: native.thinkingLevelMap ?? suggested.thinkingLevelMap,
    compat: native.compat ?? suggested.compat,
    suggestedBy: "model-id",
  };
}

function appendCandidate(models: DiscoveredModel[], candidate: DiscoveredModel, seen: Set<string>): void {
  const id = normalizedModelId(candidate.id);
  if (!seen.has(id)) {
    seen.add(id);
    models.push(candidate);
  }
}

// ─── Health check ────────────────────────────────────────────────

export async function checkProviderHealth(
  providerId: string,
  provider: ProviderConfig,
  apiKey?: string,
): Promise<{ reachable: boolean; latencyMs: number; error?: string }> {
  const start = Date.now(),
    key = apiKey || "";
  try {
    const { url, headers } = healthEndpoint(providerId, provider, key);
    const r = await fetchTimeout(url, { headers }, 10_000);
    const ms = Date.now() - start;
    return { reachable: r.ok, latencyMs: ms, error: r.ok ? undefined : `HTTP ${r.status}` };
  } catch (err) {
    return { reachable: false, latencyMs: Date.now() - start, error: serr(err) };
  }
}

// Lookup map replaces if-else chain
function healthEndpoint(providerId: string, { baseUrl, api }: ProviderConfig, key: string): HealthEndpoint {
  const bp = baseUrl.replace(/\/$/, "");
  const v1 = (b: string) => (b.endsWith("/v1") ? b : `${b}/v1`);
  const vb = (b: string) => (b.endsWith("/v1beta") ? b : `${b}/v1beta`);

  if (isOllama(providerId, baseUrl)) return { url: `${bp.replace(/\/v1\/?$/, "")}/api/tags`, headers: {} };

  const routes: Record<string, () => HealthEndpoint> = {
    "anthropic-messages": () => ({
      url: `${v1(bp)}/models?limit=1`,
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
    }),
    "google-generative-ai": () => ({ url: `${vb(bp)}/models?pageSize=1`, headers: { "x-goog-api-key": key } }),
    "google-vertex": () => ({
      url: `${v1(bp)}/publishers/google/models?pageSize=1`,
      headers: bearer(key),
    }),
    "azure-openai-responses": () => ({ url: `${bp}/models?api-version=2024-10-21`, headers: { "api-key": key } }),
  };

  if (routes[api]) return routes[api]();
  return { url: `${bp}/models`, headers: bearer(key) };
}

// ─── Chat test ───────────────────────────────────────────────────

export async function testChatCompletion(
  provider: ProviderConfig,
  modelId: string,
  apiKey: string,
): Promise<{ success: boolean; response?: string; latencyMs: number; error?: string }> {
  const bp = provider.baseUrl.replace(/\/$/, ""),
    start = Date.now();
  try {
    if (provider.api === "anthropic-messages") return chatAnthropic(bp, modelId, apiKey, start);
    if (provider.api === "google-generative-ai") return chatGoogle(bp, modelId, apiKey, start);
    return chatOpenAI(bp, modelId, apiKey, start);
  } catch (err) {
    return { success: false, latencyMs: Date.now() - start, error: serr(err) };
  }
}

async function chatOpenAI(baseUrl: string, modelId: string, apiKey: string, start: number) {
  const r = await post(
    `${baseUrl}/chat/completions`,
    { model: modelId, max_tokens: 256, messages: [{ role: "user", content: "Say hello in one sentence." }] },
    bearer(apiKey),
  );
  return chatResult(r, start, (d: any) => d.choices?.[0]?.message?.content);
}
async function chatAnthropic(baseUrl: string, modelId: string, apiKey: string, start: number) {
  const ep = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
  const r = await post(
    `${ep}/messages`,
    { model: modelId, max_tokens: 256, messages: [{ role: "user", content: "Say hello in one sentence." }] },
    { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
  );
  return chatResult(r, start, (d: any) => d.content?.map((c: any) => c.text || "").join(""));
}
async function chatGoogle(baseUrl: string, modelId: string, apiKey: string, start: number) {
  const ep = baseUrl.endsWith("/v1beta") ? baseUrl : `${baseUrl}/v1beta`;
  const qs = apiKey ? `?key=${encodeURIComponent(apiKey)}` : "";
  const r = await post(`${ep}/models/${modelId}:generateContent${qs}`, {
    contents: [{ parts: [{ text: "Say hello in one sentence." }] }],
  });
  return chatResult(r, start, (d: any) => d.candidates?.[0]?.content?.parts?.map((p: any) => p.text || "").join(""));
}
async function chatResult<T>(resp: Response, start: number, extract: (d: T) => string | undefined) {
  const ms = Date.now() - start;
  if (!resp.ok) {
    const e = await resp.text().catch(() => "");
    return { success: false, latencyMs: ms, error: `HTTP ${resp.status}: ${e.slice(0, 200)}` };
  }
  return { success: true, response: extract((await resp.json()) as T) || "(empty)", latencyMs: ms };
}

// ─── Helpers ─────────────────────────────────────────────────────

function bearer(key: string): Record<string, string> {
  return key ? { Authorization: `Bearer ${key}` } : {};
}
function serr(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isOllama(name: string, baseUrl: string): boolean {
  return (
    norm(name) === "ollama" ||
    (() => {
      try {
        return new URL(baseUrl).port === "11434";
      } catch {
        return false;
      }
    })()
  );
}

function norm(v: string): string {
  return v
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .trim();
}
function normalizedModelId(v: string): string {
  return v
    .trim()
    .toLowerCase()
    .replace(/^models\//, "");
}
function modelLeaf(v: string): string {
  return normalizedModelId(v).split("/").at(-1) || "";
}
function normalizedUrl(v: string): string {
  try {
    const u = new URL(v);
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, "")}`.toLowerCase();
  } catch {
    return v.trim().replace(/\/+$/, "").toLowerCase();
  }
}
function baseUrlScore(actual: string, suggested: string): number {
  if (!actual || !suggested) return 0;
  const a = normalizedUrl(actual),
    b = normalizedUrl(suggested);
  if (a === b) return 100;
  if (a.startsWith(`${b}/`) || b.startsWith(`${a}/`)) return 90;
  try {
    return new URL(a).host === new URL(b).host ? 80 : 0;
  } catch {
    return 0;
  }
}
function baseUrlIdentityScore(baseUrl: string, identity: string): number {
  const candidate = norm(identity);
  return candidate.length >= 3 && norm(baseUrl).includes(candidate) ? candidate.length : 0;
}
function inputFilter(input?: string[]): string[] {
  const r = (input || []).filter((v) => v === "text" || v === "image");
  return r.length ? [...new Set(r)] : ["text"];
}

export function toModelCost(c?: CatalogMod["cost"]): ModelCost | undefined {
  if (!c) return;
  const value = (n: number | undefined) => (typeof n === "number" && Number.isFinite(n) ? n : 0);
  const cost: ModelCost = {
    input: value(c.input),
    output: value(c.output),
    cacheRead: value(c.cache_read),
    cacheWrite: value(c.cache_write),
  };
  const tiers = c.tiers
    ?.filter((t) => t.tier?.type === "context" && Number.isFinite(t.tier.size))
    .map((t) => ({
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
  return r.ok ? (r.json() as T) : undefined;
}

async function post(url: string, body: unknown, extraHeaders?: Record<string, string>): Promise<Response> {
  return fetchTimeout(url, {
    method: "POST",
    headers: { ...extraHeaders, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function fetchTimeout(url: string, init?: RequestInit, ms = TIMEOUT_MS): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw new Error(`Timeout after ${ms}ms: ${url}`);
    throw err;
  } finally {
    clearTimeout(t);
  }
}
