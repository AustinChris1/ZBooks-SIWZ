import { NextResponse } from "next/server";
import { removeKey, updateKeyLabel } from "@/lib/db";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";

// PATCH { label } renames a key.
export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  const auth = await requireRole("admin", "treasurer");
  if (!auth.ok) return NextResponse.json({ error: "forbidden" }, { status: auth.status });

  let body: { label?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const label = typeof body.label === "string" ? body.label.trim() : "";
  if (!label) return NextResponse.json({ error: "label required" }, { status: 400 });
  if (label.length > 80) return NextResponse.json({ error: "label too long" }, { status: 400 });

  updateKeyLabel(params.id, label);
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const auth = await requireRole("admin", "treasurer");
  if (!auth.ok) return NextResponse.json({ error: "forbidden" }, { status: auth.status });
  removeKey(params.id);
  return NextResponse.json({ ok: true });
}
