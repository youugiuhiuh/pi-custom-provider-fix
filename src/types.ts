// Types for pi-custom-provider — imports from pi, only extension-specific types here
import type { KnownApi, ThinkingLevelMap, ModelCost } from "@earendil-works/pi-ai";

export type { ThinkingLevelMap, ModelCost };
export type ModelAPI = Exclude<KnownApi, "pi-messages">;

// ─── API-type predicates ─────────────────────────────────────────

/** APIs using Authorization: Bearer header (= OpenAI-compatible subset) */
export function usesAuthHeader(api: ModelAPI): boolean {
  return api.startsWith("openai") || api === "mistral-conversations";
}

export interface ProviderCompatKeys {
  developerRole?: "supportsDeveloperRole";
  reasoningEffort?: "supportsReasoningEffort";
  strict?: "supportsStrictMode" | "supportsStrictTools";
}

export interface ProviderCompatState {
  developerRole: number;
  reasoningEffort: number;
  strict: number;
}

const MANAGED_PROVIDER_COMPAT = [
  "supportsDeveloperRole",
  "supportsReasoningEffort",
  "supportsStrictMode",
  "supportsStrictTools",
] as const;

/** Provider-level compat fields accepted by each pi-ai API implementation. */
export function providerCompatKeys(api: ModelAPI): ProviderCompatKeys {
  if (api === "openai-completions") {
    return {
      developerRole: "supportsDeveloperRole",
      reasoningEffort: "supportsReasoningEffort",
      strict: "supportsStrictMode",
    };
  }
  if (api === "openai-responses" || api === "azure-openai-responses" || api === "openai-codex-responses") {
    return { developerRole: "supportsDeveloperRole", strict: "supportsStrictMode" };
  }
  if (api === "anthropic-messages") return { strict: "supportsStrictTools" };
  if (api === "bedrock-converse-stream") return { strict: "supportsStrictMode" };
  return {};
}

/** Merge UI overrides without discarding compat fields managed by pi-ai or newer plugin versions. */
export function mergeProviderCompat(
  existing: Record<string, unknown> | undefined,
  api: ModelAPI,
  state: ProviderCompatState,
): Record<string, unknown> | undefined {
  const compat: Record<string, unknown> = { ...(existing || {}) };
  for (const key of MANAGED_PROVIDER_COMPAT) delete compat[key];
  const keys = providerCompatKeys(api);
  setTriState(compat, keys.developerRole, state.developerRole);
  setTriState(compat, keys.reasoningEffort, state.reasoningEffort);
  setTriState(compat, keys.strict, state.strict);
  return Object.keys(compat).length ? compat : undefined;
}

function setTriState(target: Record<string, unknown>, key: string | undefined, value: number): void {
  if (!key || value === 0) return;
  target[key] = value === 1;
}

// ─── models.json config types ────────────────────────────────────

export interface ModelConfig {
  id: string;
  name?: string;
  api?: ModelAPI;
  reasoning?: boolean;
  thinkingLevelMap?: ThinkingLevelMap;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
  cost?: ModelCost;
  compat?: Record<string, unknown>;
}

export interface ProviderConfig {
  baseUrl: string;
  api: ModelAPI;
  apiKey?: string;
  headers?: Record<string, string>;
  authHeader?: boolean;
  compat?: Record<string, unknown>;
  models: ModelConfig[];
}

export interface ModelsConfig {
  providers: Record<string, ProviderConfig>;
}

// ─── Extension-specific ──────────────────────────────────────────

/** A discovered model: same as ModelConfig but with name guaranteed */
export interface DiscoveredModel extends ModelConfig {
  name: string;
  /** How this candidate was found. Discovery-only; never written to models.json. */
  suggestedBy?: "api" | "model-id" | "base-url";
}
