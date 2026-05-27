import { CATEGORY_LABEL, type Category, type Transaction } from "./types";

export interface MonthBucket {
  /** YYYY-MM */
  month: string;
  inflow: number;
  outflow: number;
  net: number;
  byCategory: Partial<Record<Category, { inflow: number; outflow: number }>>;
  count: number;
}

/**
 * Group transactions by calendar month (UTC). Returns most-recent first.
 */
export function monthlyPL(txs: Transaction[]): MonthBucket[] {
  const buckets = new Map<string, MonthBucket>();
  for (const t of txs) {
    const d = new Date(t.timestamp);
    const month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    let b = buckets.get(month);
    if (!b) {
      b = { month, inflow: 0, outflow: 0, net: 0, byCategory: {}, count: 0 };
      buckets.set(month, b);
    }
    if (t.amount_zec >= 0) b.inflow += t.amount_zec;
    else b.outflow += Math.abs(t.amount_zec);
    b.net += t.amount_zec;
    b.count += 1;
    if (t.tag) {
      const c = b.byCategory[t.tag] ?? { inflow: 0, outflow: 0 };
      if (t.amount_zec >= 0) c.inflow += t.amount_zec;
      else c.outflow += Math.abs(t.amount_zec);
      b.byCategory[t.tag] = c;
    }
  }
  return [...buckets.values()].sort((a, b) => b.month.localeCompare(a.month));
}

/**
 * Filter a transaction list to a YYYY-MM..YYYY-MM range (inclusive on
 * both ends). When `from` or `to` is omitted the corresponding end is
 * left open. Both ends are interpreted in UTC to match `monthlyPL`.
 */
export function filterByMonthRange(
  txs: Transaction[],
  from?: string,
  to?: string,
): Transaction[] {
  if (!from && !to) return txs;
  const fromTs = from ? Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, 1) : -Infinity;
  // `to` is INCLUSIVE — we add one month to capture the entire selected month.
  const toTs = to
    ? Date.UTC(+to.slice(0, 4), +to.slice(5, 7), 1)
    : Infinity;
  return txs.filter((t) => t.timestamp >= fromTs && t.timestamp < toTs);
}

/**
 * Build a CSV blob from transactions. Columns chosen to match what most
 * accountants (or QuickBooks/Xero import) expect.
 */
export function transactionsCsv(txs: Transaction[]): string {
  const header = [
    "Date",
    "Direction",
    "Amount (ZEC)",
    "Category",
    "Counterparty",
    "Memo",
    "Notes",
    "TxID",
    "Block Height",
  ];
  const escape = (v: string | number | undefined | null) => {
    if (v == null) return "";
    const s = String(v).replace(/"/g, '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  };
  const lines = [header.join(",")];
  for (const t of txs) {
    lines.push(
      [
        escape(new Date(t.timestamp).toISOString()),
        escape(t.direction.toUpperCase()),
        escape(t.amount_zec),
        escape(t.tag ? CATEGORY_LABEL[t.tag] : ""),
        escape(t.counterparty),
        escape(t.memo),
        escape(t.notes),
        escape(t.txid),
        escape(t.block_height),
      ].join(","),
    );
  }
  return lines.join("\n");
}
