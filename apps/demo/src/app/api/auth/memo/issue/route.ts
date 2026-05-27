import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { inferMemoChallengeMode, issueMemoChallenge, parseAddress } from "@siwz/core";
import { inspectUfvk } from "@/lib/ufvk";
import { SIWZ_NETWORK } from "@/lib/auth";
import {
  getDefaultExplorer,
  getShieldedExplorer,
  isMockExplorer,
} from "@/lib/explorer";

export const dynamic = "force-dynamic";

const SERVICE_ADDRESS = process.env.SIWZ_SERVICE_ADDRESS;
const DEMO_MODE = process.env.SIWZ_DEMO === "1";

/**
 * Addresses derived from publicly-known test private keys. ANYTHING sent
 * to these can be swept by anyone who reads the source code. The issue
 * endpoint refuses to use them so a misconfigured deploy can't silently
 * drain real funds.
 */
const KNOWN_LEAKED_ADDRESSES = new Set([
  "t1QzwK7oMTdr4XF32s5RAtK9Eq45NFtdSbo",
  "t1MKNc8vbN8ybMUJFcdKf6i4bRTKvtQCxpH",
]);

export async function POST(req: Request) {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) return NextResponse.json({ error: "server misconfigured: missing NEXTAUTH_SECRET" }, { status: 500 });
  if (!SERVICE_ADDRESS) {
    return NextResponse.json({
      error:
        "Server misconfigured: SIWZ_SERVICE_ADDRESS is not set. " +
        "Generate one with `node scripts/gen-service-address.mjs` " +
        "(or paste a t1…/zs…/u1… address from your wallet) into apps/demo/.env.local, " +
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

  // Detect address type → mode.
  let mode: "transparent-amount" | "shielded-memo";
  try {
    mode = inferMemoChallengeMode(SERVICE_ADDRESS);
  } catch (err) {
    return NextResponse.json({
      error: `SIWZ_SERVICE_ADDRESS is not a valid Zcash address: ${(err as Error).message}`,
    }, { status: 500 });
  }

  // For shielded mode, refuse to proceed unless we have access to a
  // shielded-capable explorer (mock in DEMO mode, or a daemon RPC).
  // Public block explorers can't decrypt memos so they cannot satisfy
  // shielded verification.
  if (mode === "shielded-memo") {
    const shieldedExplorer = getShieldedExplorer();
    if (!shieldedExplorer) {
      return NextResponse.json({
        error:
          "Service address is shielded (sapling/unified) but no shielded-capable explorer is configured. " +
          "Set ZCASH_RPC_URL (+ ZCASH_RPC_USER/PASS) for your daemon's HTTP RPC, " +
          "or set ZCASH_CLI_PATH to your zcash-cli binary. " +
          "See docs/memo-challenge.md for the full setup.",
      }, { status: 500 });
    }
    if (!shieldedExplorer.getRecentMemosToAddress) {
      return NextResponse.json({
        error:
          "The configured explorer doesn't implement getRecentMemosToAddress. " +
          "This indicates a misconfiguration — see docs/memo-challenge.md.",
      }, { status: 500 });
    }
  } else {
    // Transparent: surface a clear warning if SIWZ_DEMO=0 with no explorer
    // fallback, since BlockchairExplorer requires an internet connection
    // to the mainnet API.
    void getDefaultExplorer();
  }

  // Identity selection priority (most → least specific):
  //   1. `ufvk`            → cross-device persistent identity (Zcash-native)
  //   2. `previousAnonId`  → same-device persistent anonymous identity
  //   3. (nothing)         → fresh server-generated anon, ephemeral
  //
  // Both `ufvk` and `previousAnonId` are validated before use to avoid
  // a malicious client supplying an arbitrary string as their identity.
  let body: { ufvk?: unknown; previousAnonId?: unknown } = {};
  try {
    body = await req.json().catch(() => ({}));
  } catch {
    /* empty body is fine */
  }
  const ufvkRaw = typeof body.ufvk === "string" ? body.ufvk.trim() : "";
  const previousAnonIdRaw = typeof body.previousAnonId === "string" ? body.previousAnonId.trim() : "";
  let identity: string | undefined;
  if (ufvkRaw) {
    const inspection = inspectUfvk(ufvkRaw);
    if (!inspection.valid) return NextResponse.json({ error: inspection.reason }, { status: 400 });
    // Derive a deterministic anon-shaped identity from the UFVK rather
    // than carrying the raw UFVK as the session identity. Two wins:
    //   1. The UFVK never enters the signed challenge token, so even
    //      the HMAC payload doesn't leak it.
    //   2. The client can persist this anon-id in localStorage after
    //      sign-in (MemoSignIn.finishSignIn already does that for any
    //      identity matching /^anon:[0-9a-f]+$/i). On the next sign-in
    //      it's sent as previousAnonId and resolves to the SAME identity
    //      without the user pasting the UFVK again. The UFVK itself is
    //      still required only on the *first* device sign-in.
    identity = `anon:${createHash("sha256").update(ufvkRaw).digest("hex").slice(0, 32)}`;
  } else if (previousAnonIdRaw) {
    if (!/^anon:[0-9a-f]{8,128}$/i.test(previousAnonIdRaw)) {
      return NextResponse.json({
        error: "previousAnonId must match anon:<hex>",
      }, { status: 400 });
    }
    identity = previousAnonIdRaw;
  }

  const challenge = await issueMemoChallenge({
    secret,
    serviceAddress: SERVICE_ADDRESS,
    network: SIWZ_NETWORK,
    identity,
    label: "ZBooks",
    message:
      mode === "shielded-memo"
        ? "Sign in to ZBooks. Your wallet will pre-fill the memo from this URI; sending the memo proves the sign-in is yours."
        : "Sign in to ZBooks. Send this exact amount from the wallet you want to authenticate as.",
    ttlSeconds: 600,
  });

  return NextResponse.json({
    mode: challenge.mode,
    uri: challenge.uri,
    amountZec: challenge.amountZec,
    amountZatoshi: challenge.amountZatoshi,
    memo: challenge.memo,
    serviceAddress: challenge.serviceAddress,
    serviceAddressType: parseAddress(challenge.serviceAddress).type,
    token: challenge.token,
    expiresAt: challenge.expiresAt,
    demoMode: DEMO_MODE,
  });
}
