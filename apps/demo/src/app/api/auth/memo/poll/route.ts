import { NextResponse } from "next/server";
import { verifyMemoChallenge } from "@siwz/core";
import { getDefaultExplorer } from "@/lib/explorer";
import { signSnapEnvelope } from "@/lib/snap-auth";
import { createHash } from "node:crypto";

export const dynamic = "force-dynamic";

/**
 * Auto-polling endpoint for the SIWZ memo-challenge flow.
 *
 *   POST /api/auth/memo/poll
 *   { token: "<from /issue>" }
 *
 * Decodes the token to learn the expected (serviceAddress, amount) pair,
 * scans the most-recent transparent outputs paying to that service
 * address, and returns an envelope as soon as one matches. The client
 * polls this endpoint every few seconds until it returns 200, then hands
 * the envelope to NextAuth's "memo" credentials provider.
 *
 * Response:
 *   200 { ok: true, identity, envelope, txid }   ← matched
 *   202 { ok: false, retryable: true }            ← keep polling
 *   400/500 on bad input / explorer errors
 */
export async function POST(req: Request) {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) return NextResponse.json({ error: "server misconfigured" }, { status: 500 });

  let body: { token?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const token = typeof body.token === "string" ? body.token : "";
  if (!token) return NextResponse.json({ error: "token is required" }, { status: 400 });

  // Quick token sanity-check: extract the recipient so we know what
  // address to scan. We don't trust the payload at this stage — full
  // HMAC verification happens via verifyMemoChallenge below.
  const parts = token.split(".");
  if (parts.length !== 2) return NextResponse.json({ error: "malformed token" }, { status: 400 });
  let recipient: string;
  try {
    const payloadJson = Buffer.from(parts[0]!.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const payload = JSON.parse(payloadJson) as { to?: unknown };
    if (typeof payload.to !== "string") throw new Error("missing to");
    recipient = payload.to;
  } catch {
    return NextResponse.json({ error: "malformed token payload" }, { status: 400 });
  }

  const explorer = getDefaultExplorer();
  let outputs;
  try {
    outputs = await explorer.getRecentOutputsToAddress(recipient, 50);
  } catch (err) {
    return NextResponse.json({ error: `Explorer lookup failed: ${(err as Error).message}` }, { status: 502 });
  }

  for (const output of outputs) {
    const result = await verifyMemoChallenge({
      secret,
      token,
      observedAmountZatoshi: output.amountZatoshi,
      observedRecipient: output.address,
    });
    if (result.ok && result.identity) {
      const envelope = signSnapEnvelope(
        { fingerprint: hashIdentity(result.identity), ufvk: result.identity },
        secret,
      );
      return NextResponse.json({
        ok: true,
        identity: result.identity,
        envelope,
        txid: output.txid,
        blockHeight: output.blockHeight,
      });
    }
  }

  return NextResponse.json(
    { ok: false, retryable: true },
    { status: 202 },
  );
}

function hashIdentity(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 32);
}
