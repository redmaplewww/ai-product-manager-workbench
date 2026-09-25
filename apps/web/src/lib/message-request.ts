import { apiUrl } from "./app-path";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function postProjectMessage(fetcher: Fetcher, projectId: string, content: string) {
  try {
    const response = await fetcher(apiUrl(`/api/projects/${projectId}/messages`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content })
    });
    if (response.ok) return { ok: true as const };
    const payload = await response.json().catch(() => ({}));
    return { ok: false as const, error: typeof payload.error === "string" ? payload.error : "对话运行失败" };
  } catch {
    return { ok: false as const, error: "网络请求失败，请检查服务连接后重试。" };
  }
}
