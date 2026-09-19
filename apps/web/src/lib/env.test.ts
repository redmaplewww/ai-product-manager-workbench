import { describe, expect, it, vi } from "vitest";
import path from "node:path";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

// Vitest needs a virtual mock because server-only is resolved by Next's build aliases.
// @ts-expect-error Vitest 4 types omit the virtual-module options supported at runtime.
vi.mock("server-only", () => ({}), { virtual: true });

import { findWorkspaceRoot, isProviderConfigured, loadProjectEnv, providerBaseUrl } from "./env";

describe("project environment loading", () => {
  it("resolves the monorepo root from the web app directory", () => {
    const projectRoot = process.cwd().endsWith(path.join("apps", "web"))
      ? path.resolve(process.cwd(), "../..")
      : path.resolve(process.cwd());
    expect(findWorkspaceRoot(path.join(projectRoot, "apps/web"))).toBe(projectRoot);
  });

  it("loads the env file from the resolved workspace root", () => {
    const fixtureRoot = mkdtempSync(path.join(tmpdir(), "pm-studio-env-"));
    const fixtureApp = path.join(fixtureRoot, "apps", "web");
    mkdirSync(fixtureApp, { recursive: true });
    writeFileSync(path.join(fixtureRoot, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n");
    writeFileSync(path.join(fixtureRoot, ".env.test.local"), "PM_STUDIO_ENV_TEST=loaded\n");

    try {
      const result = loadProjectEnv(fixtureApp, true, true);
      expect(result.loadedEnvFiles).toContainEqual({
        path: ".env.test.local",
        contents: "PM_STUDIO_ENV_TEST=loaded\n",
        env: { PM_STUDIO_ENV_TEST: "loaded" }
      });
    } finally {
      delete process.env.PM_STUDIO_ENV_TEST;
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("reads provider base URLs from environment variables", () => {
    const previousOpenAiKey = process.env.OPENAI_API_KEY;
    const previousOpenAiUrl = process.env.OPENAI_BASE_URL;
    const previousDeepSeekKey = process.env.DEEPSEEK_API_KEY;
    const previousDeepSeekUrl = process.env.DEEPSEEK_BASE_URL;
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_BASE_URL = "https://openai.example/v1";
    process.env.DEEPSEEK_API_KEY = "test-key";
    process.env.DEEPSEEK_BASE_URL = "https://deepseek.example";

    try {
      expect(providerBaseUrl("openai")).toBe("https://openai.example/v1");
      expect(providerBaseUrl("deepseek")).toBe("https://deepseek.example");
      expect(isProviderConfigured("openai")).toBe(true);
      expect(isProviderConfigured("deepseek")).toBe(true);
    } finally {
      if (previousOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousOpenAiKey;
      if (previousOpenAiUrl === undefined) delete process.env.OPENAI_BASE_URL;
      else process.env.OPENAI_BASE_URL = previousOpenAiUrl;
      if (previousDeepSeekKey === undefined) delete process.env.DEEPSEEK_API_KEY;
      else process.env.DEEPSEEK_API_KEY = previousDeepSeekKey;
      if (previousDeepSeekUrl === undefined) delete process.env.DEEPSEEK_BASE_URL;
      else process.env.DEEPSEEK_BASE_URL = previousDeepSeekUrl;
    }
  });

  it("does not report a provider as configured when its URL is missing", () => {
    const previousKey = process.env.OPENAI_API_KEY;
    const previousUrl = process.env.OPENAI_BASE_URL;
    process.env.OPENAI_API_KEY = "test-key";
    delete process.env.OPENAI_BASE_URL;

    try {
      expect(isProviderConfigured("openai")).toBe(false);
      expect(() => providerBaseUrl("openai")).toThrow("OPENAI_BASE_URL");
    } finally {
      if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousKey;
      if (previousUrl === undefined) delete process.env.OPENAI_BASE_URL;
      else process.env.OPENAI_BASE_URL = previousUrl;
    }
  });
});
