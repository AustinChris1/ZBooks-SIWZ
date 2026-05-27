import { NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { syncUfvk, syncUfvkInBackground } from "@/lib/sync";

export const dynamic = "force-dynamic";

/**
 * Manual refresh trigger for a single UFVK.
 *
 *   POST /api/keys/:id/sync           → fire-and-forget (returns immediately)
 *   POST /api/keys/:id/sync?wait=1    → blocking (waits for completion)
 *
 * The blocking form is used by tests + the demo "Sync now" button on a
 * freshly-imported key when we want the user to see the result before
 * navigating. The default is non-blocking because first-time syncs of
 * an active UFVK can take a couple of minutes.
 */
export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  const auth = await requireRole("admin", "treasurer");
  if (!auth.ok) return NextResponse.json({ error: "forbidden" }, { status: auth.status });

  const url = new URL(req.url);
  const wait = url.searchParams.get("wait") === "1";

  if (wait) {
    const outcome = await syncUfvk(params.id);
    return NextResponse.json(outcome, { status: outcome.ok ? 200 : 502 });
  }
  syncUfvkInBackground(params.id);
  return NextResponse.json({ ok: true, queued: true });
}
