import { NextResponse } from "next/server";
import {
  markLineItemPaid,
  removeLineItem,
  setLineItemPayStatus,
  updateLineItem,
  type WorkStatus,
} from "@/lib/db";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";

// PATCH edits a line item. Recognised fields:
//   label, address, amountZec, memo, workStatus  -> edit the row
//   action: "mark_paid" (+ optional txid) | "mark_unpaid" | "mark_failed"
export async function PATCH(
  req: Request,
  { params }: { params: { id: string; itemId: string } },
) {
  const auth = await requireRole("admin", "treasurer");
  if (!auth.ok) return NextResponse.json({ error: "forbidden" }, { status: auth.status });

  let body: {
    label?: unknown;
    address?: unknown;
    amountZec?: unknown;
    memo?: unknown;
    workStatus?: unknown;
    action?: unknown;
    txid?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    if (body.action === "mark_paid") {
      const txid = typeof body.txid === "string" ? body.txid : undefined;
      return NextResponse.json({ item: markLineItemPaid(params.itemId, { txid }) });
    }
    if (body.action === "mark_unpaid") {
      return NextResponse.json({ item: setLineItemPayStatus(params.itemId, "unpaid") });
    }
    if (body.action === "mark_failed") {
      return NextResponse.json({ item: setLineItemPayStatus(params.itemId, "failed") });
    }

    const patch: {
      label?: string;
      address?: string;
      amount_zec?: number;
      memo?: string;
      work_status?: WorkStatus;
    } = {};
    if (typeof body.label === "string") patch.label = body.label;
    if (typeof body.address === "string") patch.address = body.address;
    if (body.amountZec !== undefined) {
      const n = Number(body.amountZec);
      if (!Number.isFinite(n) || n <= 0) {
        return NextResponse.json({ error: "amountZec must be positive" }, { status: 400 });
      }
      patch.amount_zec = n;
    }
    if (typeof body.memo === "string") patch.memo = body.memo;
    if (body.workStatus === "completed" || body.workStatus === "in_progress") {
      patch.work_status = body.workStatus;
    }
    return NextResponse.json({ item: updateLineItem(params.itemId, patch) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 404 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string; itemId: string } },
) {
  const auth = await requireRole("admin", "treasurer");
  if (!auth.ok) return NextResponse.json({ error: "forbidden" }, { status: auth.status });
  removeLineItem(params.itemId);
  return NextResponse.json({ ok: true });
}
