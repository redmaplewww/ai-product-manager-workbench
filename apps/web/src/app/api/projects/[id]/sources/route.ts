import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { updateState } from "@/lib/store";
import { assertSafePublicUrl } from "@/lib/safe-url";
import { id, now } from "@/lib/ids";
import { assertSameOrigin } from "@/lib/security";
import { sourceUrlInputSchema } from "@/lib/source-request";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    await requireRole(["admin", "editor"]);
    const { id: projectId } = await context.params;
    const contentType = request.headers.get("content-type") || "";
    let source: { kind: "file" | "web"; title: string; url?: string; mimeType?: string; excerpt: string; size: number };
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File) || file.size > 10 * 1024 * 1024) throw new Error("文件缺失或超过 10MB");
      const textTypes = ["text/", "application/json", "text/csv"];
      const excerpt = textTypes.some((type) => file.type.startsWith(type)) ? (await file.text()).slice(0, 1200) : "文件已登记；二进制正文将在生产文档处理器中提取。";
      source = { kind: "file", title: file.name, mimeType: file.type || "application/octet-stream", excerpt, size: file.size };
    } else {
      const body = sourceUrlInputSchema.parse(await request.json());
      const url = await assertSafePublicUrl(body.url);
      const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(8000), headers: { "User-Agent": "PMStudioKnowledgeBot/1.0" } });
      if (!response.ok) throw new Error(`网页获取失败: ${response.status}`);
      const length = Number(response.headers.get("content-length") || 0);
      if (length > 1024 * 1024) throw new Error("网页内容超过 1MB");
      const html = (await response.text()).slice(0, 1024 * 1024);
      const text = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      source = { kind: "web", title: body.title || url.hostname, url: url.toString(), excerpt: text.slice(0, 1200), size: Buffer.byteLength(html) };
    }
    const saved = await updateState((state) => {
      if (!state.projects.some((item) => item.id === projectId)) throw new Error("PROJECT_NOT_FOUND");
      const saved = { id: id("src"), projectId, ...source, status: "ready" as const, createdAt: now() };
      state.sources.unshift(saved); return saved;
    });
    return NextResponse.json({ source: saved }, { status: 201 });
  } catch (error) { return apiError(error); }
}
