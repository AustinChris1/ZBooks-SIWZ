import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const ALLOWED_FP = /^[0-9a-fA-F]{8,128}$/;

// HMAC-signs a server-side envelope over Snap creds. The Snap auth model
// trusts MetaMask's approval prompt; this just stops random page scripts
// from posting fabricated credentials.
export async function POST(req: Request) {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) return NextResponse.json({ error: "NEXTAUTH_SECRET not set" }, { status: 500 });
  let body: { fingerprint?: unknown; ufvk?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad JSON" }, { status: 400 }); }
  const fingerprint = typeof body.fingerprint === "string" ? body.fingerprint : "";
  const ufvk = typeof body.ufvk === "string" ? body.ufvk : "";
  if (!ALLOWED_FP.test(fingerprint)) return NextResponse.json({ error: "fingerprint must be hex (8-128)" }, { status: 400 });
  // Snap sign-in sends `anon:<fingerprint>`, never a viewing key. Real uview
  // subjects stay accepted for apps that import a key with explicit consent.
  const isAnon = ufvk.startsWith("anon:") && ALLOWED_FP.test(ufvk.slice(5));
  if (!isAnon && !ufvk.startsWith("uview") && !ufvk.startsWith("uviewtest")) {
    return NextResponse.json({ error: "subject must be anon:<fingerprint> or a uview... key" }, { status: 400 });
  }
  const envelope = createHmac("sha256", secret).update(`${fingerprint}::${ufvk}`).digest("hex");
  return NextResponse.json({ envelope });
}
