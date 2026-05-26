import { NextResponse } from "next/server";
import { primeDemoFixture } from "@/lib/explorer";
import { randomBytes } from "node:crypto";

export const dynamic = "force-dynamic";

/**
 * DEMO-mode only: simulate the on-chain payment for a given memo-challenge
 * token. Primes the mock explorer with a synthetic tx whose output matches
 * the token's (serviceAddress, amount) — so the subsequent poll call sees
 * it and signs the user in.
 *
 * Refuses outside SIWZ_DEMO=1. This endpoint exists so that the demo flow
 * mirrors the real flow in shape (user takes an explicit action → server
 * sees a payment → user gets signed in), instead of secretly signing users
 * in the moment they request a challenge.
 *
 *   POST /api/auth/memo/demo-simulate
 *   { token: "<from /issue>" }
 *   → 200 { ok: true, txid: <synthetic> } | 400 / 403 on error
 */
export async function POST(req: Request) {
  if (process.env.SIWZ_DEMO !== "1") {
    return NextResponse.json(
      { error: "demo-simulate is only available when SIWZ_DEMO=1" },
      { status: 403 },
    );
  }

  let body: { token?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const token = typeof body.token === "string" ? body.token : "";
  const parts = token.split(".");
  if (parts.length !== 2) return NextResponse.json({ error: "malformed token" }, { status: 400 });

  let recipient: string;
  let amountZatoshi: bigint;
  try {
    const payloadJson = Buffer.from(
      parts[0]!.replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    ).toString("utf8");
    const payload = JSON.parse(payloadJson) as { to?: unknown; z?: unknown };
    if (typeof payload.to !== "string") throw new Error("missing to");
    if (typeof payload.z !== "string") throw new Error("missing z");
    recipient = payload.to;
    amountZatoshi = BigInt(payload.z);
  } catch (err) {
    return NextResponse.json({ error: `bad token payload: ${(err as Error).message}` }, { status: 400 });
  }

  const txid = primeDemoFixture(
    { serviceAddress: recipient, amountZatoshi },
    () => randomBytes(32).toString("hex"),
  );
  if (!txid) {
    return NextResponse.json(
      { error: "mock explorer unavailable" },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, txid });
}
