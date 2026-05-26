import { NextResponse } from "next/server";
import { verifyMemoChallenge } from "@siwz/core";
import { getDefaultExplorer } from "@/lib/explorer";
import { signSnapEnvelope } from "@/lib/snap-auth";

export const dynamic = "force-dynamic";

/**
 * Verify a memo-challenge:
 *   1. Take the user-supplied txid + the challenge token.
 *   2. Look up the tx via the configured block explorer.
 *   3. Check at least one of the tx's transparent outputs pays the
 *      exact (serviceAddress, amount) pair encoded in the token.
 *   4. If verified, return an HMAC envelope the client can hand to
 *      NextAuth's "memo" credentials provider for session creation.
 *
 * Notes:
 *   - Idempotent: caller may poll this endpoint with the same txid.
 *   - One-shot enforcement (rejecting reuse of the same txid) is the
 *     application's responsibility — for ZBooks the session creation
 *     itself is one-shot via NextAuth's signIn flow.
 */
export async function POST(req: Request) {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) return NextResponse.json({ error: "server misconfigured" }, { status: 500 });

  let body: { token?: unknown; txid?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const token = typeof body.token === "string" ? body.token : "";
  const txid = typeof body.txid === "string" ? body.txid.trim().toLowerCase() : "";
  if (!token) return NextResponse.json({ error: "token is required" }, { status: 400 });
  if (!/^[0-9a-f]{64}$/.test(txid)) return NextResponse.json({ error: "txid must be 64 hex chars" }, { status: 400 });

  const explorer = getDefaultExplorer();
  let tx;
  try {
    tx = await explorer.getTransaction(txid);
  } catch (err) {
    return NextResponse.json({ error: `Explorer lookup failed: ${(err as Error).message}` }, { status: 502 });
  }
  if (!tx) {
    return NextResponse.json({
      error: "Transaction not found yet. If you just sent it, wait for the next block (~75s on mainnet) and retry.",
      retryable: true,
    }, { status: 404 });
  }

  // Try to match any of the tx outputs against the token.
  let matched = false;
  let lastErr: string | undefined;
  let identity: string | undefined;
  for (const output of tx.outputs) {
    const result = await verifyMemoChallenge({
      secret,
      token,
      observedAmountZatoshi: output.amountZatoshi,
      observedRecipient: output.address,
    });
    if (result.ok) {
      matched = true;
      identity = result.identity;
      break;
    }
    lastErr = `${result.error}: ${result.errorMessage}`;
  }

  if (!matched || !identity) {
    return NextResponse.json({
      error: `Transaction ${txid} doesn't contain a matching output. ${lastErr ?? ""} Re-check the amount and recipient on the wallet's send screen.`,
    }, { status: 400 });
  }

  // Return a signed envelope so the client can hand verified credentials
  // to NextAuth without re-asking the explorer on every callback hop.
  const envelope = signSnapEnvelope({ fingerprint: hashIdentity(identity), ufvk: identity }, secret);
  return NextResponse.json({
    ok: true,
    identity,
    envelope,
    txid,
    blockHeight: tx.blockHeight,
  });
}

function hashIdentity(s: string): string {
  // Stable 32-hex-char identifier so the snap/memo identity formats line up.
  // Re-uses the snap session shape so the rest of ZBooks doesn't have to
  // branch on auth method.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createHash } = require("node:crypto");
  return createHash("sha256").update(s).digest("hex").slice(0, 32);
}
