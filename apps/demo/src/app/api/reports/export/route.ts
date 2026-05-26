import { NextResponse } from "next/server";
import { listTransactions } from "@/lib/db";
import { transactionsCsv } from "@/lib/reports";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireRole("admin", "treasurer", "viewer");
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: auth.status });

  const csv = transactionsCsv(listTransactions());
  const today = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="zbooks-${today}.csv"`,
    },
  });
}
