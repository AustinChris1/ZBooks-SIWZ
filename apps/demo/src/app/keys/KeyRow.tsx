"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Ufvk } from "@/lib/db";

export function KeyRow({ k, canEdit }: { k: Ufvk; canEdit: boolean }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <li className="rounded-lg border border-black/10 dark:border-white/10 p-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col gap-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold">{k.label}</span>
          {k.primary && (
            <span className="text-[10px] uppercase tracking-wide bg-zcash-yellow/30 text-zcash-dark dark:text-zcash-yellow px-1.5 py-0.5 rounded">
              Primary
            </span>
          )}
        </div>
        <code className="font-mono text-[11px] opacity-60 break-all">
          {short(k.ufvk)}
        </code>
        <div className="text-[11px] opacity-50">
          Added {new Date(k.created_at).toLocaleDateString()} by{" "}
          <span className="font-mono">{shortAddr(k.owner)}</span>
        </div>
      </div>
      {canEdit && (
        <div className="flex gap-2">
          {!k.primary && (
            <button
              className="text-xs rounded-md border border-black/15 dark:border-white/15 px-2 py-1"
              disabled={isPending}
              onClick={() => {
                startTransition(async () => {
                  await fetch(`/api/keys/${k.id}/primary`, { method: "POST" });
                  router.refresh();
                });
              }}
            >
              Make primary
            </button>
          )}
          <button
            className="text-xs rounded-md border border-red-600/30 text-red-600 px-2 py-1"
            disabled={isPending}
            onClick={() => {
              if (!confirm(`Remove "${k.label}"? Sample transactions will also be removed.`)) return;
              startTransition(async () => {
                await fetch(`/api/keys/${k.id}`, { method: "DELETE" });
                router.refresh();
              });
            }}
          >
            Remove
          </button>
        </div>
      )}
    </li>
  );
}

function short(s: string): string {
  if (s.length <= 40) return s;
  return `${s.slice(0, 24)}…${s.slice(-12)}`;
}

function shortAddr(a: string): string {
  if (a.length <= 14) return a;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
