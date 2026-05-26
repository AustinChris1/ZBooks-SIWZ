"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Role, TeamMember } from "@/lib/db";

export function MemberRow({
  m,
  isSelf,
  canManage,
}: {
  m: TeamMember;
  isSelf: boolean;
  canManage: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <li className="rounded-lg border border-black/10 dark:border-white/10 p-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <code className="font-mono text-sm break-all">{m.address}</code>
          {isSelf && <span className="text-[10px] uppercase opacity-60">you</span>}
        </div>
        <div className="text-[11px] opacity-50">
          Added {new Date(m.added_at).toLocaleDateString()} by {m.added_by}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {canManage && !isSelf ? (
          <>
            <select
              className="text-xs rounded-md border border-black/15 dark:border-white/15 bg-transparent px-2 py-1"
              value={m.role}
              disabled={isPending}
              onChange={(e) => {
                const role = e.target.value as Role;
                startTransition(async () => {
                  await fetch(`/api/team/${encodeURIComponent(m.address)}/role`, {
                    method: "PATCH",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ role }),
                  });
                  router.refresh();
                });
              }}
            >
              <option value="viewer">Viewer</option>
              <option value="treasurer">Treasurer</option>
              <option value="admin">Admin</option>
            </select>
            <button
              className="text-xs rounded-md border border-red-600/30 text-red-600 px-2 py-1"
              disabled={isPending}
              onClick={() => {
                if (!confirm(`Remove ${m.address.slice(0, 12)}… from the team?`)) return;
                startTransition(async () => {
                  await fetch(`/api/team/${encodeURIComponent(m.address)}`, { method: "DELETE" });
                  router.refresh();
                });
              }}
            >
              Remove
            </button>
          </>
        ) : (
          <span className="text-xs opacity-70 px-2 py-1">{m.role}</span>
        )}
      </div>
    </li>
  );
}
