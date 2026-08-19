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
    return config?.providers ? (config as ModelsConfig) : { providers: {} };
  } catch {
    return { providers: {} };
  }
}

export function writeConfig(config: ModelsConfig): void {
  const configPath = modelsConfigPath();
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

export function addProvider(config: ModelsConfig, id: string, provider: ProviderConfig): ModelsConfig {
  return { providers: { ...config.providers, [id]: provider } };
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
        reasoning: candidate.reasoning,
        input: candidate.input,
        contextWindow: candidate.contextWindow,
        maxTokens: candidate.maxTokens,
        cost: candidate.cost,
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
  return parsed as ModelsConfig;
}
