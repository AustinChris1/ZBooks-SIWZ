import { redirect } from "next/navigation";
import { listTransactions, CATEGORY_LABEL, type Category } from "@/lib/db";
import { monthlyPL } from "@/lib/reports";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const user = await currentUser();
  if (!user) redirect("/");

  const txs = listTransactions();
  const months = monthlyPL(txs);

  // Top contractors view (anyone tagged contractor, summed)
  const contractorTotals = new Map<string, number>();
  for (const t of txs) {
    if (t.tag !== "contractor" || !t.counterparty) continue;
    contractorTotals.set(
      t.counterparty,
      (contractorTotals.get(t.counterparty) ?? 0) + Math.abs(t.amount_zec),
    );
  }
  const contractors = [...contractorTotals.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <h1 className="text-2xl font-bold tracking-tight">Reports</h1>
        <div className="flex gap-2">
          <a
            href="/api/reports/export"
            className="rounded-md bg-zcash-yellow text-zcash-dark font-semibold px-3 py-1.5 text-sm"
          >
            Download CSV
          </a>
        </div>
      </div>

      {txs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-black/15 dark:border-white/15 p-6 text-center opacity-70 text-sm">
          No transactions to report yet. Add a viewing key to begin.
        </div>
      ) : (
        <>
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">Monthly P&amp;L</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left opacity-60 text-xs uppercase tracking-wide">
                  <tr>
                    <th className="py-2 pr-3">Month</th>
                    <th className="py-2 pr-3 text-right">Inflow</th>
                    <th className="py-2 pr-3 text-right">Outflow</th>
                    <th className="py-2 pr-3 text-right">Net</th>
                    <th className="py-2 pr-3 text-right">#</th>
                    <th className="py-2 pr-3">Top categories</th>
                  </tr>
                </thead>
                <tbody>
                  {months.map((m) => {
                    const cats = (Object.entries(m.byCategory) as [Category, { inflow: number; outflow: number }][])
                      .sort((a, b) => Math.abs(b[1].outflow + b[1].inflow) - Math.abs(a[1].outflow + a[1].inflow))
                      .slice(0, 3)
                      .map(([k, v]) => `${CATEGORY_LABEL[k]} (${(v.inflow - v.outflow).toLocaleString()})`)
                      .join(", ");
                    return (
                      <tr key={m.month} className="border-t border-black/5 dark:border-white/10">
                        <td className="py-2 pr-3 font-mono">{m.month}</td>
                        <td className="py-2 pr-3 text-right font-mono text-green-700 dark:text-green-300">
                          {m.inflow.toLocaleString()}
                        </td>
                        <td className="py-2 pr-3 text-right font-mono text-red-700 dark:text-red-300">
                          {m.outflow.toLocaleString()}
                        </td>
                        <td
                          className={`py-2 pr-3 text-right font-mono font-semibold ${m.net >= 0 ? "text-green-700 dark:text-green-300" : "text-red-700 dark:text-red-300"}`}
                        >
                          {m.net >= 0 ? "+" : ""}
                          {m.net.toLocaleString()}
                        </td>
                        <td className="py-2 pr-3 text-right opacity-70">{m.count}</td>
                        <td className="py-2 pr-3 text-xs opacity-70">{cats || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">Top contractors</h2>
            {contractors.length === 0 ? (
              <div className="text-sm opacity-60">No transactions tagged as contractor yet.</div>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {contractors.map(([who, total]) => (
                  <li
                    key={who}
                    className="flex justify-between border-b border-black/5 dark:border-white/10 py-2"
                  >
                    <span className="font-mono text-xs truncate max-w-[60%]">{who}</span>
                    <span className="font-mono font-semibold text-red-700 dark:text-red-300">
                      {total.toLocaleString()} ZEC
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
