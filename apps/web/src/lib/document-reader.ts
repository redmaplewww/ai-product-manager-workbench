import "server-only";

export const READABLE_CONTENT_LIMIT = 400_000;

const textLikeExtensions = [".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".log", ".yml", ".yaml", ".html", ".htm", ".xml", ".srt", ".vtt"];

function extensionOf(name: string) {
  const index = name.lastIndexOf(".");
  return index < 0 ? "" : name.slice(index).toLowerCase();
}

function normalizeText(text: string) {
  return text.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim();
}

function capText(normalized: string) {
  if (normalized.length <= READABLE_CONTENT_LIMIT) return { text: normalized, truncated: false };
  return { text: `${normalized.slice(0, READABLE_CONTENT_LIMIT)}\n…[材料超过 ${READABLE_CONTENT_LIMIT} 字，已截断，请拆分导入]`, truncated: true };
}

export async function readDocument(file: File): Promise<{ text: string; truncated: boolean }> {
  const extension = extensionOf(file.name);
  const type = file.type || "";
  let raw = "";
  if (type.startsWith("text/") || type === "application/json" || textLikeExtensions.includes(extension)) {
    raw = await file.text();
  } else if (extension === ".pdf" || type === "application/pdf") {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
    const extracted = await extractText(pdf, { mergePages: true });
    raw = Array.isArray(extracted.text) ? extracted.text.join("\n") : extracted.text;
  } else if (extension === ".docx" || type.includes("wordprocessingml")) {
    const mammoth = await import("mammoth");
    const library = mammoth.default ?? mammoth;
    const result = await library.extractRawText({ buffer: Buffer.from(await file.arrayBuffer()) });
    raw = result.value;
  } else {
    throw new Error("暂不支持解析该格式；请上传 PDF、DOCX 或纯文本类文件（TXT/MD/CSV/JSON/HTML 等）");
  }
  const normalized = normalizeText(raw);
  if (!normalized) throw new Error("未能从文件中提取到文本内容（可能是扫描件或空文档）");
  return capText(normalized);
}

export function importText(content: string) {
  return capText(normalizeText(content));
}
