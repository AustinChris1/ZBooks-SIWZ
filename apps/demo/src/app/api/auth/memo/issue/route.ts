import { NextResponse } from "next/server";
import { issueMemoChallenge } from "@siwz/core";
import { inspectUfvk } from "@/lib/ufvk";
import { SIWZ_NETWORK } from "@/lib/auth";
import { primeDemoFixture } from "@/lib/explorer";
import { randomBytes } from "node:crypto";

export const dynamic = "force-dynamic";

const SERVICE_ADDRESS = process.env.SIWZ_SERVICE_ADDRESS;
const DEMO_MODE = process.env.SIWZ_DEMO === "1";

/**
 * Addresses derived from publicly-known test private keys. ANYTHING sent
 * to these can be swept by anyone who reads the source code. The issue
 * endpoint refuses to use them so a misconfigured deploy can't silently
 * drain real funds. Updates here MUST keep this list in sync with any
 * helper that derives addresses from fixed bytes.
 */
const KNOWN_LEAKED_ADDRESSES = new Set([
  // priv = 0x0d * 32 — historically baked into early dev configs.
  "t1QzwK7oMTdr4XF32s5RAtK9Eq45NFtdSbo",
  // priv = 0x07 * 32 — test helper FIXED_PRIV in @siwz/core tests.
  "t1MKNc8vbN8ybMUJFcdKf6i4bRTKvtQCxpH",
]);

/**
 * Issue a memo-challenge: returns a ZIP 321 URI (for QR/deep-link
 * rendering on the client), the expected amount, and a stateless
 * verification token.
 *
 * Body: { ufvk: string } — the user's claimed UFVK, which we'll bind
 * to the session that gets created when the matching tx is detected.
 */
export async function POST(req: Request) {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) return NextResponse.json({ error: "server misconfigured: NEXTAUTH_SECRET missing" }, { status: 500 });
  if (!SERVICE_ADDRESS) {
    return NextResponse.json({
      error:
        "Server misconfigured: SIWZ_SERVICE_ADDRESS is not set. " +
        "Generate one with `node scripts/gen-service-address.mjs` " +
        "(or paste an address from your wallet) into apps/demo/.env.local, " +
        "then restart the dev server.",
    }, { status: 500 });
  }
  if (KNOWN_LEAKED_ADDRESSES.has(SERVICE_ADDRESS)) {
    return NextResponse.json({
      error:
        `Refusing to use ${SERVICE_ADDRESS} as a service address — its private key is in this repo's source. ` +
        `Any funds sent there can be swept by anyone who reads the code. ` +
        `Generate a fresh one with: node scripts/gen-service-address.mjs`,
    }, { status: 500 });
  }

  // UFVK is OPTIONAL. If provided, the resulting session is bound to it
  // so the user can later sign back in from a different device with the
  // same key. If omitted, the session is anonymous (server-assigned id)
  // and the user can attach a UFVK later from the /keys page.
  let body: { ufvk?: unknown } = {};
  try {
    body = await req.json().catch(() => ({}));
  } catch {
    /* empty body is fine */
  }
  const ufvkRaw = typeof body.ufvk === "string" ? body.ufvk.trim() : "";
  let identity: string | undefined;
  if (ufvkRaw) {
    const inspection = inspectUfvk(ufvkRaw);
    if (!inspection.valid) return NextResponse.json({ error: inspection.reason }, { status: 400 });
    identity = ufvkRaw;
  }

  const challenge = await issueMemoChallenge({
    secret,
    serviceAddress: SERVICE_ADDRESS,
    network: SIWZ_NETWORK,
    identity, // may be undefined → server assigns anonymous id
    label: "ZBooks",
    message: "Sign in to ZBooks. Send this exact amount from the wallet you want to authenticate as.",
    ttlSeconds: 600,
  });

  // NOTE: we do NOT auto-prime the mock explorer here, even in DEMO mode.
  // Auto-priming makes "do nothing → get signed in" the observed behavior,
  // which surprises users (it surprised the project owner). Instead we
  // expose /api/auth/memo/demo-simulate which the UI calls when the user
  // explicitly clicks the "Simulate payment" button.

  return NextResponse.json({
    uri: challenge.uri,
    amountZec: challenge.amountZec,
    amountZatoshi: challenge.amountZatoshi,
    serviceAddress: challenge.serviceAddress,
    token: challenge.token,
    expiresAt: challenge.expiresAt,
    demoMode: DEMO_MODE,
  });
}
