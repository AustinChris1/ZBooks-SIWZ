import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { addKey, ensureMember, listKeys } from "./db";
import { inspectUfvk } from "./ufvk";

/**
 * Snap-based auth for ZBooks.
 *
 * The ChainSafe Zcash Snap doesn't expose signMessage, so SIWZ-classic
 * (challenge-signature) can't run via the Snap. Instead, we use the
 * Snap's *permission grant* as authentication:
 *
 *   1. User clicks "Sign in with MetaMask"
 *   2. dApp asks the Snap for the seed fingerprint + UFVK
 *      (MetaMask shows a connection prompt the user must approve)
 *   3. dApp posts those to this endpoint
 *   4. We treat the fingerprint as the user's stable identity, and
 *      auto-import the UFVK
 *
 * Threat model: anyone who can call getSeedFingerprint via this snap in
 * this browser is treated as authenticated. We rely on MetaMask's
 * approval flow as the gate. Compare with SIWZ-classic which proves
 * spending-key ownership cryptographically.
 *
 * The fingerprint is mapped to a synthetic identifier `snap:<hex>` used
 * everywhere a Zcash address would be (in the session, in the team
 * table, in audit fields on transactions). It's not an on-chain
 * address — it's a stable opaque ID. The team page can still display
 * it; it just looks like `snap:0123abcd…`.
 */

const ALLOWED_FP = /^[0-9a-fA-F]{8,128}$/;

export interface SnapCredentials {
  fingerprint: string;
  ufvk: string;
}

/**
 * Lightweight envelope-signed integrity check on Snap credentials,
 * preventing forging from a CSRF-relayed request. The dApp client signs
 * the (fingerprint, ufvk) bundle with NEXTAUTH_SECRET before posting;
 * the server reverifies before trusting.
 *
 * We don't strictly need this for the Snap auth model (it's not a
 * signature-of-ownership), but it does mean a random script tag can't
 * just POST arbitrary credentials and get a session.
 */
export function signSnapEnvelope(creds: SnapCredentials, secret: string): string {
  return createHmac("sha256", secret)
    .update(`${creds.fingerprint}::${creds.ufvk}`)
    .digest("hex");
}

export function verifySnapEnvelope(creds: SnapCredentials, envelope: string, secret: string): boolean {
  const expected = signSnapEnvelope(creds, secret);
  if (envelope.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(envelope), Buffer.from(expected));
}

export function validateSnapCredentials(creds: SnapCredentials): { ok: true } | { ok: false; reason: string } {
  if (!ALLOWED_FP.test(creds.fingerprint)) {
    return { ok: false, reason: "Fingerprint must be hex (8–128 chars)" };
  }
  // Anonymous memo-challenge sessions ride this same envelope path but
  // present a synthetic identity rather than a real UFVK; allow that.
  if (creds.ufvk.startsWith("anon:")) return { ok: true };
  const inspection = inspectUfvk(creds.ufvk);
  if (!inspection.valid) return { ok: false, reason: inspection.reason };
  return { ok: true };
}

/**
 * Compute the synthetic "address" that represents a Snap-authenticated
 * user across the rest of ZBooks.
 *
 * Preference order:
 *   1. UFVK hash, when a real UFVK is present. The UFVK is stable
 *      across MetaMask reinstalls / Snap reprovisioning because it's
 *      derived from the wallet's seed. Using its hash means the same
 *      user keeps the same identity (team role, audit history, key
 *      ownership) regardless of which fingerprint MetaMask hands back
 *      this session. This is also the SAME identity scheme the memo-
 *      signin path uses for UFVK-bound sessions, so a user who signs
 *      in once via Snap and once via memo-with-UFVK is one person.
 *   2. Snap fingerprint, when UFVK is missing (e.g. anonymous memo
 *      sessions that ride this envelope path). Still snap-prefixed so
 *      legacy team entries created from fingerprints don't change.
 */
export function snapIdentityFor(fingerprint: string, ufvk?: string): string {
  if (ufvk && !ufvk.startsWith("anon:")) {
    return `anon:${createHash("sha256").update(ufvk).digest("hex").slice(0, 32)}`;
  }
  return `snap:${fingerprint.slice(0, 32)}`;
}

/**
 * Side-effect on successful Snap-or-memo auth: make sure the user is on
 * the team, and auto-import their UFVK if it isn't there already.
 *
 * The label parameter lets callers attribute the import to the right
 * sign-in path (Snap vs memo-challenge) so the user can see in the UI
 * how each key was added.
 */
export function onSnapAuthSuccess(
  creds: SnapCredentials,
  label = "MetaMask Zcash Snap",
): { identity: string } {
  const identity = snapIdentityFor(creds.fingerprint, creds.ufvk);
  ensureMember(identity);
  // Skip UFVK auto-import for anonymous memo-challenge sessions — the
  // "ufvk" field there is a synthetic `anon:<hex>` identity, not a real
  // viewing key. The user can attach a real UFVK later from /keys.
  const ufvk = creds.ufvk?.trim() ?? "";
  if (ufvk && !ufvk.startsWith("anon:")) {
    const existing = listKeys();
    const already = existing.find((k) => k.ufvk.trim() === ufvk);
    if (!already) {
      addKey({ owner: identity, label, ufvk });
    }
  }
  return { identity };
}
