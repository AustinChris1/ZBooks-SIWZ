import { redirect } from "next/navigation";
import { listTransactions, listKeys, CATEGORY_LABEL } from "@/lib/db";
import { canTag, currentUser } from "@/lib/session";
import { TxRow } from "./TxRow";

export const dynamic = "force-dynamic";

export default async function TransactionsPage() {
  const user = await currentUser();
  if (!user) redirect("/");

  const txs = listTransactions();
  const keys = listKeys();
  const keyLabels = new Map(keys.map((k) => [k.id, k.label]));
  const editable = canTag(user.role);

  const untaggedCount = txs.filter((t) => !t.tag).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Transactions</h1>
        <div className="text-xs opacity-60">role: {user.role}</div>
      </div>

      {keys.length === 0 ? (
        <div className="rounded-lg border border-dashed border-black/15 dark:border-white/15 p-6 text-center opacity-70 text-sm">
          <div>No transactions yet — add a viewing key first.</div>
          <a href="/keys" className="underline text-sm mt-2 inline-block">Go to Keys →</a>
        </div>
      ) : (
        <>
          <div className="text-sm opacity-70">
            {txs.length} transactions across {keys.length} key{keys.length === 1 ? "" : "s"}.{" "}
            {untaggedCount > 0 && (
              <>
                <strong className="text-zcash-dark dark:text-zcash-yellow">{untaggedCount}</strong> untagged.
              </>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left opacity-60 text-xs uppercase tracking-wide">
                <tr>
                  <th className="py-2 pr-3">Date</th>
                  <th className="py-2 pr-3">Direction</th>
                  <th className="py-2 pr-3 text-right">Amount (ZEC)</th>
                  <th className="py-2 pr-3">Memo / counterparty</th>
                  <th className="py-2 pr-3">Key</th>
                  <th className="py-2 pr-3">Category</th>
                  <th className="py-2 pr-3">Notes</th>
                </tr>
              </thead>
              <tbody>
                {txs.map((t) => (
                  <TxRow
                    key={t.id}
                    t={t}
                    keyLabel={keyLabels.get(t.ufvk_id) ?? "(unknown)"}
                    editable={editable}
                    categories={Object.entries(CATEGORY_LABEL).map(([value, label]) => ({ value, label }))}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
