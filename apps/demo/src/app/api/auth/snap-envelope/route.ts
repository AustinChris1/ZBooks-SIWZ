import { NextResponse } from "next/server";
import { signSnapEnvelope, validateSnapCredentials } from "@/lib/snap-auth";

export const dynamic = "force-dynamic";

/**
 * Returns an HMAC envelope for Snap credentials so the client can hand
 * verifiable credentials to NextAuth's credentials provider.
 *
 * The Snap-auth model is permission-based (the dApp is trusted because
 * MetaMask approved the connection), but we still want a server-side
 * integrity check so a stray fetch from a malicious page can't fabricate
 * a session by guessing credentials.
 */
export async function POST(req: Request) {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) return NextResponse.json({ error: "server misconfigured" }, { status: 500 });
  let body: { fingerprint?: unknown; ufvk?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const fingerprint = typeof body.fingerprint === "string" ? body.fingerprint : "";
  const ufvk = typeof body.ufvk === "string" ? body.ufvk : "";
  const inspection = validateSnapCredentials({ fingerprint, ufvk });
  if (!inspection.ok) return NextResponse.json({ error: inspection.reason }, { status: 400 });
  const envelope = signSnapEnvelope({ fingerprint, ufvk }, secret);
  return NextResponse.json({ envelope });
}
