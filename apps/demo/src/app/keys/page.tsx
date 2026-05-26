import { redirect } from "next/navigation";
import { listKeys } from "@/lib/db";
import { canManageKeys, currentUser } from "@/lib/session";
import { AddKeyForm } from "./AddKeyForm";
import { KeyRow } from "./KeyRow";

export const dynamic = "force-dynamic";

export default async function KeysPage() {
  const user = await currentUser();
  if (!user) redirect("/");

  const keys = listKeys();
  const canEdit = canManageKeys(user.role);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Viewing keys</h1>
        <div className="text-xs opacity-60">role: {user.role}</div>
      </div>

      <p className="text-sm opacity-80 max-w-2xl">
        Paste a Unified Full Viewing Key (UFVK) to give ZBooks read-only
        access to its transactions. Spending keys are never required —
        ZBooks cannot move funds.
      </p>

      {canEdit ? (
        <AddKeyForm />
      ) : (
        <div className="text-sm opacity-60">
          You can view keys but only treasurers and admins can add or remove them.
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="text-sm opacity-60">
          {keys.length} {keys.length === 1 ? "key" : "keys"}
        </div>
        {keys.length === 0 ? (
          <div className="rounded-lg border border-dashed border-black/15 dark:border-white/15 p-6 text-center opacity-60 text-sm">
            No keys yet. Add one above to start importing transactions.
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {keys.map((k) => (
              <KeyRow key={k.id} k={k} canEdit={canEdit} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
