import { NextResponse } from "next/server";
import { createRun, listRuns } from "@/lib/db";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireRole("admin", "treasurer");
  if (!auth.ok) return NextResponse.json({ error: "forbidden" }, { status: auth.status });
  return NextResponse.json({ runs: listRuns() });
}

export async function POST(req: Request) {
  const auth = await requireRole("admin", "treasurer");
  if (!auth.ok) return NextResponse.json({ error: "forbidden" }, { status: auth.status });

  let body: { title?: unknown; sourceUfvkId?: unknown; note?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const sourceUfvkId = typeof body.sourceUfvkId === "string" ? body.sourceUfvkId : undefined;
  const note = typeof body.note === "string" ? body.note : undefined;
  if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });
  if (title.length > 120) return NextResponse.json({ error: "title too long" }, { status: 400 });

  const run = createRun({ title, sourceUfvkId, note, by: auth.address });
  return NextResponse.json({ run });
}
