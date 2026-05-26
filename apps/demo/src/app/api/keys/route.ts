import { NextResponse } from "next/server";
import { addKey, listKeys } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { inspectUfvk } from "@/lib/ufvk";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireRole("admin", "treasurer", "viewer");
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: auth.status });
  return NextResponse.json({ keys: listKeys() });
}

export async function POST(req: Request) {
  const auth = await requireRole("admin", "treasurer");
  if (!auth.ok) return NextResponse.json({ error: "forbidden" }, { status: auth.status });

  let body: { label?: unknown; ufvk?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const ufvk = typeof body.ufvk === "string" ? body.ufvk.trim() : "";
  const label = typeof body.label === "string" ? body.label.trim() : "";
  if (!ufvk) return NextResponse.json({ error: "ufvk is required" }, { status: 400 });
  const inspection = inspectUfvk(ufvk);
  if (!inspection.valid) {
    return NextResponse.json({ error: inspection.reason }, { status: 400 });
  }
  const key = addKey({ owner: auth.address, label: label || "Untitled key", ufvk });
  return NextResponse.json({ key });
}
