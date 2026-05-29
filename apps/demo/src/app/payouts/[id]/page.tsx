import { notFound, redirect } from "next/navigation";
import { getRun, listKeys, listPayees, reconcileRun } from "@/lib/db";
import { canSeePayouts, canTag, currentUser } from "@/lib/session";
import { runPreflight } from "@/lib/payouts";
import { PayoutRunDetail } from "./PayoutRunDetail";

export const dynamic = "force-dynamic";

export default async function PayoutRunPage({ params }: { params: { id: string } }) {
  const user = await currentUser();
  if (!user) redirect("/");
  if (!canSeePayouts(user.role)) redirect("/transactions");

  if (!getRun(params.id)) notFound();
  // Auto-match against already-synced treasury txs so payments show as paid
  // without any manual step. Idempotent; no network (use the button to sync).
  try {
    reconcileRun(params.id);
  } catch {
    // best-effort
  }
  const run = getRun(params.id);
  if (!run) notFound();

  const preflight = await runPreflight(run);
  const payees = listPayees().map((p) => ({ id: p.id, label: p.label, address: p.address }));
  const keys = listKeys().map((k) => ({ id: k.id, label: k.label, primary: k.primary }));

  return (
    <PayoutRunDetail
      run={run}
      preflight={preflight}
      payees={payees}
      keys={keys}
      canEdit={canTag(user.role)}
    />
  );
}
