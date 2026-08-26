import "server-only";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { studioStateSchema, type StudioState } from "@pm-studio/core";
import { createSeedState } from "./seed";

const dataDir = path.resolve(process.cwd(), "../../data");
const dataFile = path.join(dataDir, "studio.json");
let queue = Promise.resolve();

async function load(): Promise<StudioState> {
  try {
    return studioStateSchema.parse(JSON.parse(await readFile(dataFile, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.warn("Rebuilding invalid local state", error);
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
