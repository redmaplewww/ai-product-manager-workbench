import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { readState } from "@/lib/store";

export async function GET() {
  try { await requireRole(["admin"]); return NextResponse.json({ proposals: (await readState()).evolutionProposals }); }
  catch (error) { return apiError(error); }
}
