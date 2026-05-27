import { NextResponse } from "next/server";
import { verifyMemoChallenge } from "@siwz/core";
import { getDefaultExplorer, getShieldedExplorer, type RecentMemo, type RecentOutput } from "@/lib/explorer";
import { signSnapEnvelope } from "@/lib/snap-auth";
import { createHash } from "node:crypto";

export const dynamic = "force-dynamic";

/**
 * Auto-polling endpoint for the SIWZ memo-challenge flow.
 *
 *   POST /api/auth/memo/poll
 *   { token: "<from /issue>" }
 *
 * Inspects the token's mode marker and dispatches:
 *   - transparent-amount → scan recent transparent outputs to the
 *     service address; match by amount.
 *   - shielded-memo      → ask the shielded explorer (daemon RPC) for
 *     decrypted memos to the service address; match by nonce-in-memo.
 *
 * Response:
 *   200 { ok: true, identity, envelope, txid, mode }   ← matched
 *   202 { ok: false, retryable: true }                  ← keep polling
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

  // Peek at the payload to learn the recipient + mode.
  const parts = token.split(".");
  if (parts.length !== 2) return NextResponse.json({ error: "malformed token" }, { status: 400 });
  let recipient: string;
  let mode: "transparent-amount" | "shielded-memo";
  try {
    const payloadJson = Buffer.from(parts[0]!.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const payload = JSON.parse(payloadJson) as { to?: unknown; m?: unknown };
    if (typeof payload.to !== "string") throw new Error("missing to");
    recipient = payload.to;
    mode = payload.m === "sm" ? "shielded-memo" : "transparent-amount";
  } catch {
    return NextResponse.json({ error: "malformed token payload" }, { status: 400 });
  }

  try {
    if (mode === "transparent-amount") {
      return await pollTransparent(secret, token, recipient);
    }
    return await pollShielded(secret, token, recipient);
  } catch (err) {
    return NextResponse.json(
      { error: `Explorer lookup failed: ${(err as Error).message}` },
      { status: 502 },
    );
  }
}

async function pollTransparent(secret: string, token: string, recipient: string) {
  const explorer = getDefaultExplorer();
  const outputs: RecentOutput[] = await explorer.getRecentOutputsToAddress(recipient, 50);

  for (const output of outputs) {
    const result = await verifyMemoChallenge({
      secret,
      token,
      observedAmountZatoshi: output.amountZatoshi,
      observedRecipient: output.address,
    });
    if (result.ok && result.identity) {
      return success(result.identity, secret, output.txid, "transparent-amount", output.blockHeight);
    }
  }
  return NextResponse.json({ ok: false, retryable: true }, { status: 202 });
}

async function pollShielded(secret: string, token: string, recipient: string) {
  const explorer = getShieldedExplorer();
  if (!explorer?.getRecentMemosToAddress) {
    return NextResponse.json(
      { error: "No shielded explorer is configured. Set ZCASH_RPC_URL or ZCASH_CLI_PATH." },
      { status: 500 },
    );
  }
  const memos: RecentMemo[] = await explorer.getRecentMemosToAddress(recipient, 50);

  for (const memo of memos) {
    const result = await verifyMemoChallenge({
      secret,
      token,
      observedMemo: memo.memo,
      observedRecipient: recipient,
    });
    if (result.ok && result.identity) {
      return success(result.identity, secret, memo.txid, "shielded-memo", memo.blockHeight);
    }
  }
  return NextResponse.json({ ok: false, retryable: true }, { status: 202 });
}

function success(
  identity: string,
  secret: string,
  txid: string,
  mode: "transparent-amount" | "shielded-memo",
  blockHeight?: number,
) {
  const envelope = signSnapEnvelope(
    { fingerprint: hashIdentity(identity), ufvk: identity },
    secret,
  );
  return NextResponse.json({
    ok: true,
    identity,
    envelope,
    txid,
    mode,
    blockHeight,
  });
}

function hashIdentity(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 32);
}
