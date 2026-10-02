import { db } from "./db";
import { decrypt, encrypt, randomId } from "./crypto";
import type { AccountSummary, Platform } from "./types";

export interface AccountRow {
  id: string;
  platform: Platform;
  mode: "live" | "demo";
  external_id: string;
  name: string;
  username: string | null;
  avatar_url: string | null;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: number | null;
  status: "ok" | "reconnect";
  status_message: string | null;
  meta: string;
  created_at: number;
}

export function toAccountSummary(r: AccountRow): AccountSummary {
  return {
    id: r.id,
    platform: r.platform,
    mode: r.mode,
    name: r.name,
    username: r.username,
    avatarUrl: r.avatar_url,
    status: r.status,
    statusMessage: r.status_message,
    tokenExpiresAt: r.token_expires_at,
    createdAt: r.created_at,
  };
}

export function listAccounts(): AccountSummary[] {
  const rows = db().prepare("SELECT * FROM accounts ORDER BY platform, name").all() as AccountRow[];
  return rows.map(toAccountSummary);
}

export function listAccountRows(): AccountRow[] {
  return db().prepare("SELECT * FROM accounts").all() as AccountRow[];
}

export function getAccountRow(id: string): AccountRow | undefined {
  return db().prepare("SELECT * FROM accounts WHERE id = ?").get(id) as AccountRow | undefined;
}

export interface UpsertAccount {
  platform: Platform;
  mode: "live" | "demo";
  externalId: string;
  name: string;
  username?: string | null;
  avatarUrl?: string | null;
  accessToken?: string | null;
  refreshToken?: string | null;
  tokenExpiresAt?: number | null;
  meta?: Record<string, unknown>;
}

export function upsertAccount(a: UpsertAccount): string {
  const existing = db()
    .prepare("SELECT id, refresh_token FROM accounts WHERE platform = ? AND mode = ? AND external_id = ?")
    .get(a.platform, a.mode, a.externalId) as { id: string; refresh_token: string | null } | undefined;
  const access = a.accessToken ? encrypt(a.accessToken) : null;
  // Google only returns a refresh token on first consent; keep the old one if none came back.
  const refresh = a.refreshToken ? encrypt(a.refreshToken) : existing?.refresh_token ?? null;
  const meta = JSON.stringify(a.meta ?? {});
  if (existing) {
    db()
      .prepare(
        `UPDATE accounts SET name = ?, username = ?, avatar_url = ?, access_token = ?, refresh_token = ?,
         token_expires_at = ?, meta = ?, status = 'ok', status_message = NULL WHERE id = ?`,
      )
      .run(a.name, a.username ?? null, a.avatarUrl ?? null, access, refresh, a.tokenExpiresAt ?? null, meta, existing.id);
    return existing.id;
  }
  const id = randomId(9);
  db()
    .prepare(
      `INSERT INTO accounts (id, platform, mode, external_id, name, username, avatar_url, access_token, refresh_token,
       token_expires_at, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, a.platform, a.mode, a.externalId, a.name, a.username ?? null, a.avatarUrl ?? null, access, refresh,
      a.tokenExpiresAt ?? null, meta, Date.now());
  return id;
}

export function saveTokens(id: string, t: { accessToken: string; refreshToken?: string; expiresAt: number | null; meta?: Record<string, unknown> }) {
  const row = getAccountRow(id);
  if (!row) return;
  const meta = t.meta ? JSON.stringify({ ...JSON.parse(row.meta), ...t.meta }) : row.meta;
  db()
    .prepare("UPDATE accounts SET access_token = ?, refresh_token = ?, token_expires_at = ?, meta = ?, status = 'ok', status_message = NULL WHERE id = ?")
    .run(encrypt(t.accessToken), t.refreshToken ? encrypt(t.refreshToken) : row.refresh_token, t.expiresAt, meta, id);
}

export function flagReconnect(id: string, message: string) {
  db().prepare("UPDATE accounts SET status = 'reconnect', status_message = ? WHERE id = ?").run(message, id);
}

export function deleteAccount(id: string): boolean {
  return db().prepare("DELETE FROM accounts WHERE id = ?").run(id).changes > 0;
}

export function accessTokenOf(r: AccountRow): string {
  if (!r.access_token) throw new Error("Account has no access token");
  return decrypt(r.access_token);
}

export function refreshTokenOf(r: AccountRow): string | null {
  return r.refresh_token ? decrypt(r.refresh_token) : null;
}

export function metaOf<T = Record<string, unknown>>(r: AccountRow): T {
  return JSON.parse(r.meta || "{}") as T;
}

export function pendingTargetCount(accountId: string): number {
  const r = db()
    .prepare("SELECT COUNT(*) AS n FROM post_targets WHERE account_id = ? AND status IN ('scheduled','publishing','draft')")
    .get(accountId) as { n: number };
  return r.n;
}
