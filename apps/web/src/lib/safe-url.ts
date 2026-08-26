import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

function isPrivate(address: string) {
  if (address === "::1" || address === "0.0.0.0") return true;
  if (address.startsWith("10.") || address.startsWith("127.") || address.startsWith("192.168.") || address.startsWith("169.254.")) return true;
  const parts = address.split(".").map(Number);
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  return address.startsWith("fc") || address.startsWith("fd") || address.startsWith("fe80");
}

export async function assertSafePublicUrl(input: string) {
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error("仅支持 HTTP/HTTPS 地址");
  if (url.username || url.password) throw new Error("URL 不得包含认证信息");
  const records = isIP(url.hostname) ? [{ address: url.hostname }] : await lookup(url.hostname, { all: true });
  if (!records.length || records.some((record) => isPrivate(record.address))) throw new Error("禁止访问本机或私有网络地址");
  return url;
}
