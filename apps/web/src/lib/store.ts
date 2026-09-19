import "server-only";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { studioStateSchema, type StudioState } from "@pm-studio/core";
import { createSeedState } from "./seed";
import { isProviderConfigured } from "./env";

const dataDir = path.resolve(process.cwd(), "../../data");
const dataFile = path.join(dataDir, "studio.json");
let queue = Promise.resolve();

export function shouldBootstrapState(error: unknown) {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

function applyRuntimeModelConfiguration(state: StudioState) {
  state.models = state.models.map((model) => {
    if (model.provider === "openai" || model.provider === "deepseek") {
      return { ...model, configured: isProviderConfigured(model.provider) };
    }
    return model;
  });
  return state;
}

async function load(): Promise<StudioState> {
  try {
    return applyRuntimeModelConfiguration(studioStateSchema.parse(JSON.parse(await readFile(dataFile, "utf8"))));
  } catch (error) {
    if (!shouldBootstrapState(error)) {
      console.error("Invalid local state; refusing to overwrite it", error);
      throw error;
    }
    const state = await createSeedState();
    await persist(state);
    return state;
  }
}

async function persist(state: StudioState) {
  await mkdir(dataDir, { recursive: true });
  const temp = `${dataFile}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(state, null, 2), "utf8");
  await rename(temp, dataFile);
}

export async function readState() {
  await queue.catch(() => undefined);
  return load();
}

export async function updateState<T>(mutator: (state: StudioState) => T | Promise<T>): Promise<T> {
  let result!: T;
  queue = queue.catch(() => undefined).then(async () => {
    const state = await load();
    result = await mutator(state);
    studioStateSchema.parse(state);
    await persist(state);
  });
  await queue;
  return result;
}
