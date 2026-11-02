export class HttpError extends Error {
  constructor(public status: number, message = "") {
    super(message);
  }
}

function csrfToken(): string | undefined {
  return document.cookie.split("; ").find((c) => c.startsWith("XSRF-TOKEN="))?.split("=")[1];
}

/**
 * Same-origin JSON client. Auth is a HttpOnly session cookie (no tokens in storage);
 * state-changing calls send the CSRF token from the cookie.
 */
export async function http<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  if (method !== "GET") {
    const t = csrfToken();
    if (t) headers.set("X-XSRF-TOKEN", t);
  }
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { ...init, headers, credentials: "same-origin" });
  } catch {
    throw new HttpError(0);
  }
  if (res.status === 401) {
    const next = encodeURIComponent(location.pathname + location.search);
    if (!location.pathname.startsWith("/sign-in")) location.assign(`/sign-in?next=${next}`);
  }
  if (!res.ok) throw new HttpError(res.status);
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export const qs = (params: Record<string, string | number | undefined | null>) => {
  const u = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => v !== undefined && v !== null && v !== "" && u.set(k, String(v)));
  const s = u.toString();
  return s ? `?${s}` : "";
};
