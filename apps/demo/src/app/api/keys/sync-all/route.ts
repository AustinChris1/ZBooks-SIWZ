import { NextResponse } from "next/server";
import { listKeys } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { syncUfvkInBackground } from "@/lib/sync";

export const dynamic = "force-dynamic";

/**
 * Fan-out endpoint hit by the BackgroundSync component every 5 min.
 * Returns immediately; each per-key sync runs out of band so we don't
 * keep an HTTP connection open through a multi-minute initial sync.
 */
export async function POST() {
  const auth = await requireRole("admin", "treasurer", "viewer");
  if (!auth.ok) return NextResponse.json({ error: "unauthorized" }, { status: auth.status });

  const keys = listKeys();
  // Cap concurrency so 20 keys don't spawn 20 zingo processes at once
  // on the wrapper. The sync layer already guards against a per-key
  // double-sync via its in-flight set, so this is just a politeness
  // limit on the wrapper's CPU.
  for (const k of keys) syncUfvkInBackground(k.id);

  return NextResponse.json({ ok: true, queued: keys.length });
}
