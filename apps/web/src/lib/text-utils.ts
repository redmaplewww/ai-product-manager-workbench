// proposal 去重专用：判两段产品条目是否原文相同（去大小写/空白/标点即判等）。
// 记忆层的 normalizeMemoryText（去前缀/判同义/判冲突）语义不同，不复用此函数。
export function comparableText(value: string) {
  return value.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}
