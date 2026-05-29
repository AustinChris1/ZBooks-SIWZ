import { buildZip321Multi, isShieldedAddress, type ZIP321Request } from "@siwz/core";
import { getShieldedExplorer, type UfvkBalance } from "./explorer";
import { getKey, type RunWithItems } from "./db";
import type { PayoutLineItem } from "./types";

// ZIP 317 marginal fee per logical action (https://zips.z.cash/zip-0317).
export const ZIP317_MARGINAL_FEE_ZAT = 5000;

// Completed, unpaid rows are the ones that go into the batch.
// In-progress items (e.g. an unfinished video) are deliberately excluded.
export function payableItems(run: RunWithItems): PayoutLineItem[] {
  return run.items.filter((i) => i.work_status === "completed" && i.pay_status !== "paid");
}

// Rough ZIP 317 estimate: one spend + (N recipients + change) outputs, floored
// at the grace action count. Conservative enough for a "do we have enough?" check.
export function estimateFeeZec(recipientCount: number): number {
  if (recipientCount <= 0) return 0;
  const actions = Math.max(2, recipientCount + 1);
  return (actions * ZIP317_MARGINAL_FEE_ZAT) / 1e8;
}

// Build the single multi-recipient ZIP 321 URI for a run. Memos are attached
// only to shielded recipients (ZIP 321 forbids memos to transparent addresses).
export function buildRunUri(
  run: RunWithItems,
): { uri: string; totalZec: number; count: number } | null {
  const items = payableItems(run);
  if (items.length === 0) return null;
  const payments: ZIP321Request[] = items.map((i) => {
    const p: ZIP321Request = { address: i.address, amount: i.amount_zec.toFixed(8) };
    if (i.memo && isShieldedAddress(i.address)) p.memo = i.memo;
    return p;
  });
  const uri = buildZip321Multi(payments);
  const totalZec = items.reduce((s, i) => s + i.amount_zec, 0);
  return { uri, totalZec, count: items.length };
}

export interface RunPreflight {
  count: number;
  totalZec: number;
  feeZec: number;
  requiredZec: number;
  balance: UfvkBalance | null;
  spendableZec: number | null;
  // null when the backend can't report a balance; UI shows unknown and doesn't block.
  sufficient: boolean | null;
  uri: string | null;
}

export async function runPreflight(run: RunWithItems): Promise<RunPreflight> {
  const built = buildRunUri(run);
  const count = built?.count ?? 0;
  const totalZec = built?.totalZec ?? 0;
  const feeZec = estimateFeeZec(count);
  const requiredZec = totalZec + feeZec;

  let balance: UfvkBalance | null = null;
  if (run.source_ufvk_id) {
    balance = await getTreasuryBalance(run.source_ufvk_id).catch(() => null);
  }
  const spendableZec = balance ? Number(balance.spendableZatoshi) / 1e8 : null;
  const sufficient = spendableZec == null ? null : spendableZec + 1e-8 >= requiredZec;

  return {
    count,
    totalZec,
    feeZec,
    requiredZec,
    balance,
    spendableZec,
    sufficient,
    uri: built?.uri ?? null,
  };
}

export async function getTreasuryBalance(ufvkId: string): Promise<UfvkBalance | null> {
  const key = getKey(ufvkId);
  if (!key) return null;
  const explorer = getShieldedExplorer();
  if (!explorer?.getBalanceForUfvk) return null;
  return explorer.getBalanceForUfvk(key.ufvk, { birthday: key.birthday });
}
