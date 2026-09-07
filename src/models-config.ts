// Read/write ~/.pi/agent/models.json
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { ModelConfig, ModelsConfig, ProviderConfig } from "./types";

interface SelectableModel extends ModelConfig {
  name: string;
  selected: boolean;
  edited: boolean;
  suggestedBy?: "api" | "model-id" | "base-url";
}

function modelsConfigPath(): string {
  const agentDir = process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent");
  return path.join(agentDir, "models.json");
}

export function readConfig(): ModelsConfig {
  try {
    const configPath = modelsConfigPath();
    if (!fs.existsSync(configPath)) return { providers: {} };
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    return config?.providers ? sanitizeConfig(config as ModelsConfig) : { providers: {} };
  } catch {
    return { providers: {} };
  }
}

export function writeConfig(config: ModelsConfig): void {
  const configPath = modelsConfigPath();
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(sanitizeConfig(config), null, 2) + "\n", "utf-8");
}

export function repairConfig(): ModelsConfig {
  const configPath = modelsConfigPath();
  const config = readConfig();
  try {
    if (!fs.existsSync(configPath)) return config;
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    if (JSON.stringify(parsed) !== JSON.stringify(config)) writeConfig(config);
  } catch {}
  return config;
}

export function addProvider(config: ModelsConfig, id: string, provider: ProviderConfig): ModelsConfig {
  return { providers: { ...config.providers, [id]: provider } };
}

/** Replace or rename one provider without disturbing any other provider entries. */
export function replaceProvider(
  config: ModelsConfig,
  previousId: string,
  nextId: string,
  provider: ProviderConfig,
): ModelsConfig {
  const providers = { ...config.providers };
  if (previousId !== nextId) delete providers[previousId];
  providers[nextId] = provider;
  return { providers };
}

export function removeProvider(config: ModelsConfig, id: string): ModelsConfig {
  const providers = { ...config.providers };
  delete providers[id];
  return { providers };
}

/** Apply the current selection while preserving untouched and forward-compatible model fields. */
export function mergeSelectedModels(existing: ModelConfig[], candidates: SelectableModel[]): ModelConfig[] {
  const candidateMap = new Map(candidates.map((model) => [model.id, model]));
  const existingIds = new Set(existing.map((model) => model.id));
  const retained = existing.flatMap((model) => {
    const candidate = candidateMap.get(model.id);
    if (!candidate?.selected) return [];
    if (!candidate.edited) return [model];
    return [
      {
        ...model,
        id: model.id,
        name: candidate.name !== candidate.id ? candidate.name : model.name,
        baseUrl: candidate.baseUrl ?? model.baseUrl,
        reasoning: candidate.reasoning,
        input: candidate.input,
        contextWindow: candidate.contextWindow,
        maxTokens: candidate.maxTokens,
        cost: candidate.cost,
        headers: candidate.headers ?? model.headers,
        thinkingLevelMap: candidate.thinkingLevelMap,
        compat: candidate.compat,
      },
    ];
  });
  const addedIds = new Set<string>();
  const added: ModelConfig[] = [];
  for (const candidate of candidates) {
    if (!candidate.selected || existingIds.has(candidate.id) || addedIds.has(candidate.id)) continue;
    addedIds.add(candidate.id);
    const { selected: _selected, edited: _edited, suggestedBy: _suggestedBy, ...model } = candidate;
    added.push({
      ...model,
      name: model.name !== model.id ? model.name : undefined,
      reasoning: model.reasoning || undefined,
    });
  }
  return [...retained, ...added];
}

export function exportConfig(config: ModelsConfig): string {
  return JSON.stringify(config, null, 2);
}

export function importConfig(json: string): ModelsConfig {
  const parsed = JSON.parse(json);
  if (!parsed?.providers) throw new Error("Invalid format: missing 'providers'");
  return sanitizeConfig(parsed as ModelsConfig);
}

function sanitizeConfig(config: ModelsConfig): ModelsConfig {
  const providers: ModelsConfig["providers"] = {};
  for (const [id, provider] of Object.entries(config.providers || {})) {
    providers[id] = sanitizeProvider(provider);
  }
  return { providers };
}

function sanitizeProvider(provider: ProviderConfig): ProviderConfig {
  const next: ProviderConfig = { ...provider };
  if (!next.apiKey?.trim()) delete next.apiKey;
  if (next.oauthProvider) delete next.apiKey;
  if (!next.oauthProvider && !next.apiKey?.trim()) next.authHeader = false;
  if (!next.oauthJsonPath?.trim()) delete next.oauthJsonPath;
  if (!next.name?.trim()) delete next.name;
  next.models = (next.models || []).map(sanitizeModel);
  return next;
}

function sanitizeModel(model: ModelConfig): ModelConfig {
  const next: ModelConfig = { ...model };
  if (!next.name?.trim()) delete next.name;
  if (!next.api?.trim()) delete next.api;
  if (!next.baseUrl?.trim()) delete next.baseUrl;
  return next;
}
