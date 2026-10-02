"use client";

export class ClientError extends Error {
  constructor(message: string, public status: number, public details?: any) {
    super(message);
  }
}

export async function api<T = any>(url: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(url, {
    ...rest,
    headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...rest.headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401 && !url.includes("/api/auth/")) {
    window.location.href = "/login";
  }
  if (!res.ok) throw new ClientError(body.error || res.statusText, res.status, body.details);
  return body as T;
}
