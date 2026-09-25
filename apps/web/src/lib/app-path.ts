export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

export function apiUrl(path: string) {
  return `${BASE_PATH}${path}`;
}
