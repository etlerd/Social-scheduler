import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config";

const MIGRATIONS: string[] = [
  `
  CREATE TABLE accounts (
    id TEXT PRIMARY KEY,
    platform TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'live',
    external_id TEXT NOT NULL,
    name TEXT NOT NULL,
    username TEXT,
    avatar_url TEXT,
    access_token TEXT,
    refresh_token TEXT,
    token_expires_at INTEGER,
    status TEXT NOT NULL DEFAULT 'ok',
    status_message TEXT,
    meta TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    UNIQUE (platform, mode, external_id)
  );
  CREATE TABLE media (
    id TEXT PRIMARY KEY,
    file_name TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    width INTEGER,
    height INTEGER,
    duration REAL,
    kind TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE posts (
    id TEXT PRIMARY KEY,
    caption TEXT NOT NULL DEFAULT '',
    scheduled_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE post_media (
    post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    media_id TEXT NOT NULL REFERENCES media(id),
    position INTEGER NOT NULL,
    PRIMARY KEY (post_id, position)
  );
  CREATE TABLE post_targets (
    id TEXT PRIMARY KEY,
    post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    content_type TEXT NOT NULL,
    options TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL,
    dispatch_at INTEGER,
    attempts INTEGER NOT NULL DEFAULT 0,
    container_id TEXT,
    external_id TEXT,
    external_url TEXT,
    error TEXT,
    published_at INTEGER,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX post_targets_due ON post_targets (status, dispatch_at);
  CREATE INDEX post_targets_post ON post_targets (post_id);
  CREATE INDEX posts_scheduled ON posts (scheduled_at);
  CREATE TABLE target_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target_id TEXT NOT NULL REFERENCES post_targets(id) ON DELETE CASCADE,
    at INTEGER NOT NULL,
    level TEXT NOT NULL,
    message TEXT NOT NULL
  );
  CREATE INDEX target_events_target ON target_events (target_id);
  `,
];

function migrate(d: Database.Database) {
  const current = d.pragma("user_version", { simple: true }) as number;
  for (let v = current; v < MIGRATIONS.length; v++) {
    d.transaction(() => {
      d.exec(MIGRATIONS[v]);
      d.pragma(`user_version = ${v + 1}`);
    })();
  }
}

const g = globalThis as unknown as { __ssdb?: Database.Database };

export function db(): Database.Database {
  if (!g.__ssdb) {
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.mkdirSync(config.mediaDir, { recursive: true });
    const d = new Database(path.join(config.dataDir, "app.db"));
    d.pragma("journal_mode = WAL");
    d.pragma("busy_timeout = 5000");
    d.pragma("foreign_keys = ON");
    migrate(d);
    g.__ssdb = d;
  }
  return g.__ssdb;
}

/** For tests: swap in a fresh database. */
export function resetDbForTests(d: Database.Database) {
  d.pragma("foreign_keys = ON");
  migrate(d);
  g.__ssdb = d;
}
