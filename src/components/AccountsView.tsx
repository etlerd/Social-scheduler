"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";
import type { AccountSummary, Platform } from "@/lib/types";
import { PageHeader } from "./AppShell";
import { IconLogout, PlatformIcon } from "./icons";
import { AccountAvatar, Banner, Spinner } from "./ui";

interface Setup {
  instagram: boolean;
  youtube: boolean;
  demo: boolean;
  publicUrl: string;
  redirectUris: Record<Platform, string>;
}

const INFO: Record<Platform, { name: string; needs: string }> = {
  instagram: {
    name: "Instagram",
    needs: "Business or Creator account. Personal accounts can't publish through the API.",
  },
  youtube: {
    name: "YouTube",
    needs: "Any channel. Pick the channel on Google's consent screen.",
  },
};

export function AccountsView() {
  const params = useSearchParams();
  const router = useRouter();
  const [accounts, setAccounts] = useState<AccountSummary[] | null>(null);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [error, setError] = useState(params.get("error") ?? "");
  const connected = params.get("connected");

  const load = useCallback(async () => {
    try {
      const r = await api<{ accounts: AccountSummary[]; setup: Setup }>("/api/accounts");
      setAccounts(r.accounts);
      setSetup(r.setup);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const remove = async (a: AccountSummary) => {
    const { pending } = await api<{ pending: number }>(`/api/accounts/${a.id}`);
    const msg = pending
      ? `Disconnect ${a.name}? ${pending} scheduled or draft item${pending > 1 ? "s" : ""} for this account will be removed from their posts.`
      : `Disconnect ${a.name}?`;
    if (!confirm(msg)) return;
    await api(`/api/accounts/${a.id}`, { method: "DELETE" }).catch((e) => setError(e.message));
    load();
  };

  const addDemo = async (platform: Platform) => {
    await api("/api/accounts/demo", { method: "POST", json: { platform } }).catch((e) => setError(e.message));
    load();
  };

  return (
    <div className="max-w-3xl">
      <PageHeader title="Accounts" />
      {connected && <div className="mb-4"><Banner tone="ok">{INFO[connected as Platform]?.name ?? connected} connected.</Banner></div>}
      {error && <div className="mb-4"><Banner tone="error">{error}</Banner></div>}

      {accounts === null || setup === null ? (
        <div className="flex justify-center py-10 text-muted"><Spinner size={20} /></div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 mb-8">
            {(["instagram", "youtube"] as const).map((p) => (
              <div key={p} className="card p-4 flex flex-col">
                <div className="flex items-center gap-2 font-semibold">
                  <PlatformIcon platform={p} size={22} /> {INFO[p].name}
                </div>
                <p className="text-xs text-muted mt-2 flex-1">{INFO[p].needs}</p>
                {setup[p] ? (
                  <a href={`/api/oauth/${p}/start`} className="btn-primary mt-4">Connect {INFO[p].name}</a>
                ) : (
                  <div className="mt-4 text-xs rounded-xl bg-surface-2 p-3">
                    <p className="font-medium mb-1">Not configured on the server</p>
                    <p className="text-muted">
                      Set {p === "instagram" ? "INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET" : "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET"} and register this redirect URI:
                    </p>
                    <code className="block mt-1 break-all">{setup.redirectUris[p]}</code>
                  </div>
                )}
                {setup.demo && (
                  <button className="btn-ghost btn-sm mt-2" onClick={() => addDemo(p)}>Add demo {INFO[p].name} account</button>
                )}
              </div>
            ))}
          </div>

          <h2 className="font-semibold mb-3">Connected</h2>
          {accounts.length === 0 ? (
            <p className="text-sm text-muted">None yet.</p>
          ) : (
            <ul className="card divide-y divide-line">
              {accounts.map((a) => (
                <li key={a.id} className="flex items-center gap-3 p-3">
                  <AccountAvatar account={a} size={40} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">
                      {a.name} {a.mode === "demo" && <span className="chip bg-surface-2 text-muted ml-1">demo</span>}
                    </p>
                    <p className="text-xs text-muted truncate">
                      {a.username ?? INFO[a.platform].name}
                      {a.platform === "instagram" && a.tokenExpiresAt && a.mode === "live" && ` · token renews automatically (expires ${new Date(a.tokenExpiresAt).toLocaleDateString()})`}
                    </p>
                    {a.status !== "ok" && <p className="text-xs text-bad mt-0.5">{a.statusMessage ?? "Needs reconnecting"}</p>}
                  </div>
                  {a.status !== "ok" && a.mode === "live" && setup[a.platform] && (
                    <a href={`/api/oauth/${a.platform}/start`} className="btn-primary btn-sm">Reconnect</a>
                  )}
                  <button className="btn-ghost btn-sm" onClick={() => remove(a)}>Remove</button>
                </li>
              ))}
            </ul>
          )}

          <button
            className="btn-ghost mt-8 md:hidden"
            onClick={async () => {
              await fetch("/api/auth/logout", { method: "POST" });
              router.replace("/login");
            }}
          >
            <IconLogout size={16} /> Sign out
          </button>
        </>
      )}
    </div>
  );
}
