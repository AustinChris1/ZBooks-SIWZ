import { NextResponse } from "next/server";
import { addLineItem, createRun, findExistingExternalRefs } from "@/lib/db";
import { requireRole } from "@/lib/session";
import {
  bountyToPayoutLine,
  detectAddressNetwork,
  fetchAllBounties,
  filterPayableBounties,
  type ZecBounty,
} from "@/lib/zec-bounties";
import { SIWZ_NETWORK } from "@/lib/auth";

export const dynamic = "force-dynamic";

// POST { bountyIds: string[], target: { type: "new", title?: string, sourceUfvkId?: string } | { type: "existing", runId: string } }
// Returns { ok: true, runId, added: number, skipped: { id, reason }[] }
export async function POST(req: Request) {
  const auth = await requireRole("admin", "treasurer");
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: auth.status });

  let body: {
    bountyIds?: unknown;
    target?: { type?: unknown; title?: unknown; sourceUfvkId?: unknown; runId?: unknown };
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const ids = Array.isArray(body.bountyIds) ? body.bountyIds.filter((x) => typeof x === "string") : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: "bountyIds required (non-empty array of strings)" }, { status: 400 });
  }
  if (ids.length > 100) {
    return NextResponse.json({ error: "max 100 bounties per import" }, { status: 400 });
  }

  let upstream: ZecBounty[];
  try {
    upstream = await fetchAllBounties();
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to fetch from zec-bounties: ${(err as Error).message}` },
      { status: 502 },
    );
  }

  const wanted = new Set(ids);
  const selected = upstream.filter((b) => wanted.has(b.id));
  const payable = filterPayableBounties(selected);

  const skipped: { id: string; reason: string }[] = [];

  for (const id of ids) {
    if (!upstream.some((b) => b.id === id)) {
      skipped.push({ id, reason: "Not found upstream" });
      continue;
    }
    const b = selected.find((x) => x.id === id)!;
    if (!payable.includes(b)) {
      const reason = !b.assigneeUser?.z_address
        ? "No assignee address"
        : b.isPaid
        ? "Already marked paid upstream"
        : b.status !== "DONE"
        ? `Status is ${b.status}, not DONE`
        : !b.isApproved
        ? "Not approved"
        : "Not payable";
      skipped.push({ id, reason });
    }
  }

  // Filter again by network (don't accept off-network even if the caller forced it)
  const onNetwork = payable.filter((b) => {
    const net = detectAddressNetwork(b.assigneeUser!.z_address!);
    if (net === SIWZ_NETWORK) return true;
    skipped.push({ id: b.id, reason: `${net} address, this ZBooks runs on ${SIWZ_NETWORK}` });
    return false;
  });

  // Dedupe against payout_items.external_ref
  const refs = onNetwork.map((b) => `zec-bounties:${b.id}`);
  const existing = await findExistingExternalRefs(refs);
  const fresh = onNetwork.filter((b) => !existing.has(`zec-bounties:${b.id}`));
  for (const b of onNetwork) {
    if (existing.has(`zec-bounties:${b.id}`)) {
      skipped.push({ id: b.id, reason: "Already imported into a previous run" });
    }
  }

  if (fresh.length === 0) {
    return NextResponse.json({ error: "No bounties to import", skipped, added: 0 }, { status: 400 });
  }

  // Determine target run
  let runId: string;
  const target = body.target ?? {};
  if (target.type === "existing" && typeof target.runId === "string") {
    runId = target.runId;
  } else {
    const title =
      (typeof target.title === "string" && target.title.trim()) ||
      `ZecBounties · ${new Date().toISOString().slice(0, 10)}`;
    const run = await createRun({
      title,
      sourceUfvkId: typeof target.sourceUfvkId === "string" ? target.sourceUfvkId : undefined,
      by: auth.address,
      note: `Imported ${fresh.length} bount${fresh.length === 1 ? "y" : "ies"} from zec-bounties`,
    });
    runId = run.id;
  }

  let added = 0;
  for (const b of fresh) {
    const line = bountyToPayoutLine(b);
    try {
      await addLineItem(runId, {
        label: line.label,
        address: line.address,
        amountZec: line.amount_zec,
        memo: line.memo,
        externalRef: line.external_ref,
        workStatus: "completed",
      });
      added += 1;
    } catch (err) {
      skipped.push({ id: b.id, reason: `Insert failed: ${(err as Error).message}` });
    }
  }

  return NextResponse.json({ ok: true, runId, added, skipped });
}
