import { redirect } from "next/navigation";
import { listTransactions, listKeys, counterpartyLabelMap } from "@/lib/db";
import { canTag, currentUser } from "@/lib/session";
import { SyncBar } from "./SyncBar";
import { TransactionsTable } from "./TransactionsTable";

export const dynamic = "force-dynamic";

export default async function TransactionsPage() {
  const user = await currentUser();
  if (!user) redirect("/");

  const txs = listTransactions();
  const keys = listKeys();
  const keyLabels = Object.fromEntries(keys.map((k) => [k.id, k.label]));
  const counterpartyLabels = Object.fromEntries(counterpartyLabelMap().entries());
  const editable = canTag(user.role);
  const untaggedCount = txs.filter((t) => !t.tag).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Transactions</h1>
        <div className="text-xs text-neutral-500">role: {user.role}</div>
      </div>

      {keys.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 dark:border-neutral-700 p-8 text-center text-sm text-neutral-500">
          <div>No transactions yet. Add a viewing key to start importing.</div>
          <a href="/keys" className="underline text-sm mt-2 inline-block">Go to Keys →</a>
        </div>
      ) : (
        <>
          <SyncBar keys={keys} canEdit={editable} />

          {untaggedCount > 0 && (
            <div className="text-xs text-neutral-500">
              <strong className="text-zcash-dark dark:text-zcash-yellow">{untaggedCount}</strong> untagged transactions.
            </div>
          )}

          <TransactionsTable
            txs={txs}
            keyLabels={keyLabels}
            counterpartyLabels={counterpartyLabels}
            editable={editable}
          />
        </>
      )}
    </div>
  );
}
