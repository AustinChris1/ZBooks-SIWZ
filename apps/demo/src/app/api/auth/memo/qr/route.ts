import { NextResponse } from "next/server";
import QRCode from "qrcode";

export const dynamic = "force-dynamic";

/**
 * Render a ZIP 321 URI as a QR code, returned as an SVG body. The QR
 * is generated server-side so the client just embeds <img src="…" />
 * without pulling in a QR library.
 *
 *   GET /api/auth/memo/qr?uri=zcash%3A…
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const uri = url.searchParams.get("uri");
  if (!uri || !uri.startsWith("zcash:")) {
    return NextResponse.json({ error: "uri query param missing or not a zcash: URI" }, { status: 400 });
  }
  if (uri.length > 1200) {
    // QR encoders can handle ~2.9KB but readability degrades fast; ZIP 321
    // URIs are typically well under 400 bytes for SIWZ.
    return NextResponse.json({ error: "uri too long for sensible QR rendering" }, { status: 400 });
  }
  const svg = await QRCode.toString(uri, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 1,
    width: 256,
  });
  return new NextResponse(svg, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "private, no-store",
    },
  });
}
