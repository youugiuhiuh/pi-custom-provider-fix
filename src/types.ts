// Types for pi-custom-provider — imports from pi, only extension-specific types here
import type { KnownApi, ThinkingLevelMap, ModelCost } from "@earendil-works/pi-coding-agent";

export type { ThinkingLevelMap, ModelCost };
export type ModelAPI = Exclude<KnownApi, "pi-messages">;

// ─── API-type predicates ─────────────────────────────────────────

/** APIs using Authorization: Bearer header (= OpenAI-compatible subset) */
export function usesAuthHeader(api: ModelAPI): boolean {
  return api.startsWith("openai") || api === "mistral-conversations";
}

// ─── models.json config types ────────────────────────────────────

export interface ModelConfig {
  id: string; name?: string; api?: ModelAPI; reasoning?: boolean;
  thinkingLevelMap?: ThinkingLevelMap; input?: string[];
  contextWindow?: number; maxTokens?: number; cost?: ModelCost;
}

export interface ProviderConfig {
  baseUrl: string; api: ModelAPI; apiKey?: string;
  headers?: Record<string, string>; authHeader?: boolean;
  models: ModelConfig[];
}

export interface ModelsConfig { providers: Record<string, ProviderConfig>; }

// ─── Extension-specific ──────────────────────────────────────────

/** A discovered model: same as ModelConfig but with name guaranteed */
export interface DiscoveredModel extends ModelConfig {
  name: string;
}
