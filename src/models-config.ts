// Read/write ~/.pi/agent/models.json
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { ModelsConfig, ProviderConfig } from "./types";

const MODELS_CONFIG_PATH = path.join(os.homedir(), ".pi", "agent", "models.json");

export function readConfig(): ModelsConfig {
  try {
    if (!fs.existsSync(MODELS_CONFIG_PATH)) return { providers: {} };
    const config = JSON.parse(fs.readFileSync(MODELS_CONFIG_PATH, "utf-8"));
    return config?.providers ? (config as ModelsConfig) : { providers: {} };
  } catch {
    return { providers: {} };
  }
}

export function writeConfig(config: ModelsConfig): void {
  const dir = path.dirname(MODELS_CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(MODELS_CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

export function addProvider(config: ModelsConfig, id: string, provider: ProviderConfig): ModelsConfig {
  return { providers: { ...config.providers, [id]: provider } };
}

export function exportConfig(config: ModelsConfig): string {
  return JSON.stringify(config, null, 2);
}

export function importConfig(json: string): ModelsConfig {
  const parsed = JSON.parse(json);
  if (!parsed?.providers) throw new Error("Invalid format: missing 'providers'");
  return parsed as ModelsConfig;
}
