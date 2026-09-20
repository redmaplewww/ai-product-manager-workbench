import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { updateState } from "@/lib/store";
import { assertSafePublicUrl } from "@/lib/safe-url";
import { id, now } from "@/lib/ids";
import { assertSameOrigin } from "@/lib/security";
import { sourceUrlInputSchema } from "@/lib/source-request";
import { importText, readDocument } from "@/lib/document-reader";
import { sourceTextImportSchema } from "@pm-studio/core";

type NewSource = { kind: "file" | "web" | "document" | "conversation"; title: string; url?: string; mimeType?: string; excerpt: string; content?: string; charCount?: number; size: number };

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    await requireRole(["admin", "editor"]);
    const { id: projectId } = await context.params;
    const contentType = request.headers.get("content-type") || "";
    let source: NewSource;
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File) || file.size > 10 * 1024 * 1024) throw new Error("文件缺失或超过 10MB");
      const read = await readDocument(file);
      source = { kind: "file", title: file.name, mimeType: file.type || "application/octet-stream", excerpt: read.text.slice(0, 1200), content: read.text, charCount: read.text.length, size: file.size };
    } else {
      const body = await request.json();
      if (typeof body?.mode === "string" && ["document", "conversation"].includes(body.mode)) {
        const input = sourceTextImportSchema.parse(body);
        const read = importText(input.content);
        source = { kind: input.mode, title: input.title, excerpt: read.text.slice(0, 1200), content: read.text, charCount: read.text.length, size: Buffer.byteLength(read.text) };
      } else {
        const parsed = sourceUrlInputSchema.parse(body);
        const url = await assertSafePublicUrl(parsed.url);
        const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(8000), headers: { "User-Agent": "PMStudioKnowledgeBot/1.0" } });
        if (!response.ok) throw new Error(`网页获取失败: ${response.status}`);
        const length = Number(response.headers.get("content-length") || 0);
        if (length > 1024 * 1024) throw new Error("网页内容超过 1MB");
        const html = (await response.text()).slice(0, 1024 * 1024);
        const text = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        const read = importText(text);
        source = { kind: "web", title: parsed.title || url.hostname, url: url.toString(), excerpt: read.text.slice(0, 1200), content: read.text, charCount: read.text.length, size: Buffer.byteLength(html) };
      }
    }
    const saved = await updateState((state) => {
      if (!state.projects.some((item) => item.id === projectId)) throw new Error("PROJECT_NOT_FOUND");
      const saved = { id: id("src"), projectId, ...source, status: "ready" as const, createdAt: now() };
      state.sources.unshift(saved);
      state.auditEvents.unshift({ id: id("audit"), actorId: "system", action: "source.imported", target: saved.id, detail: `${source.kind}:${source.title}`.slice(0, 200), createdAt: now() });
      return saved;
    });
    return NextResponse.json({ source: saved }, { status: 201 });
  } catch (error) { return apiError(error); }
}
