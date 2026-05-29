import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { getRun } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { buildRunUri } from "@/lib/payouts";

export const dynamic = "force-dynamic";

// GET → SVG QR of the run's multi-recipient ZIP 321 URI. Built server-side from
// the run id so we don't push a long URI through the query string.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireRole("admin", "treasurer");
  if (!auth.ok) return NextResponse.json({ error: "forbidden" }, { status: auth.status });

  const run = await getRun(params.id);
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });

  let uri: string;
  try {
    const built = buildRunUri(run);
    if (!built) {
      return NextResponse.json({ error: "no completed, unpaid items to pay" }, { status: 400 });
    }
    uri = built.uri;
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  const svg = await QRCode.toString(uri, {
    type: "svg",
    errorCorrectionLevel: "L", // lowest ECC: batch URIs are long, keep modules scannable
    margin: 1,
    width: 320,
  });
  return new NextResponse(svg, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "private, no-store",
    },
  });
}
