import { NextResponse } from "next/server";
import { readState } from "@/lib/store";

export async function GET() {
  const state = await readState();
  return NextResponse.json({ status: "ok", persistence: process.env.DATABASE_URL ? "postgres" : "local-json", projects: state.projects.length, modelProviders: { openai: Boolean(process.env.OPENAI_API_KEY), deepseek: Boolean(process.env.DEEPSEEK_API_KEY) }, timestamp: new Date().toISOString() });
}
