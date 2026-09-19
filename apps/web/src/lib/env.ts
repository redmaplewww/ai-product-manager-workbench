import "server-only";
import { existsSync } from "node:fs";
import path from "node:path";
import { loadEnvConfig } from "@next/env";

export function findWorkspaceRoot(startDirectory = process.cwd()) {
  let directory = path.resolve(startDirectory);
  while (true) {
    if (existsSync(path.join(directory, "pnpm-workspace.yaml"))) return directory;
    const parent = path.dirname(directory);
    if (parent === directory) return path.resolve(startDirectory);
    directory = parent;
  }
}

export function loadProjectEnv(startDirectory = process.cwd(), dev = process.env.NODE_ENV !== "production", forceReload = false) {
  const root = findWorkspaceRoot(startDirectory);
  return loadEnvConfig(root, dev, undefined, forceReload);
}

export type ProviderName = "openai" | "deepseek";

const providerEnvironment = {
  openai: { apiKey: "OPENAI_API_KEY", baseUrl: "OPENAI_BASE_URL" },
  deepseek: { apiKey: "DEEPSEEK_API_KEY", baseUrl: "DEEPSEEK_BASE_URL" }
} as const;

export function providerBaseUrl(provider: ProviderName) {
  const { apiKey, baseUrl } = providerEnvironment[provider];
  const value = process.env[baseUrl]?.trim();
  if (process.env[apiKey]?.trim() && !value) {
    throw new Error(`${baseUrl} must be set when ${apiKey} is configured`);
  }
  return value;
}

export function isProviderConfigured(provider: ProviderName) {
  const { apiKey, baseUrl } = providerEnvironment[provider];
  return Boolean(process.env[apiKey]?.trim() && process.env[baseUrl]?.trim());
}

loadProjectEnv();
