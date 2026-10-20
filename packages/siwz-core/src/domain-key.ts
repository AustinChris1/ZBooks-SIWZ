/**
 * SIWZ domain-scoped keys: the off-chain signature Zcash does not otherwise have.
 *
 * Zcash has no deployed message-signing scheme for shielded addresses. ZIP 322
 * ("Generic Signed Message Format") is Reserved with no body, and the Orchard
 * address signature proposal (zcash/zips#1154) was closed unmerged in January
 * 2026. ZIP 304 is Sapling-only, still Draft, and unimplemented in wallets.
 *
 * So SIWZ does not ask for one. Instead the wallet derives an ordinary Ed25519
 * keypair from the seed it already holds, scoped to the verifier's domain, and
 * signs a plaintext SIWZ message with it. No circuit, no consensus change, and
 * no new ZIP is needed before a wallet can ship it.
 *
 * The identity is the per-domain public key, which yields three properties that
 * an address-bound signature cannot:
 *
 *   1. No payment address is disclosed. A unified address in a signed message
 *      would publish a receive address into every login log it touches.
 *   2. Logins are unlinkable across verifiers. Each domain derives an
 *      independent key, unlike Ethereum where one 0x… follows the user
 *      everywhere.
 *   3. Identity survives device loss. Derivation is deterministic, so a seed
 *      restore reproduces the same identity at every domain.
 *
 * What it proves is control of the seed, not control of funds at a given
 * address. When a verifier needs the latter, use the memo challenge.
 */

import { ed25519 } from "@noble/curves/ed25519";
import { blake2b } from "@noble/hashes/blake2b";
import { base64, bech32m } from "@scure/base";
import { SiwzError } from "./errors.js";

const ENC = new TextEncoder();

/** Human-readable prefix for a bech32m-encoded SIWZ identity. */
export const SIWZ_ID_HRP = "siwz";

/**
 * Domain separation for the signed payload. Prepended to the message bytes so a
 * SIWZ signature can never be replayed as, or confused with, any other
 * signature a Zcash wallet produces.
 */
export const SIWZ_SIGNING_PREFIX = "SIWZ-domain-key-v1:\n";

// BLAKE2b personalisation must be exactly 16 bytes, as in ZIP 32.
const PERSONAL_ROOT = ENC.encode("SIWZ_Root_v1____");
const PERSONAL_DOMAIN = ENC.encode("SIWZ_Domain_v1__");

/**
 * Required seed length: the 64-byte BIP 39 binary seed, the PBKDF2 output over
 * the wallet's mnemonic.
 *
 * Pinned to one length on purpose. A BIP 39 seed is 64 bytes and a ZIP 32 seed
 * may be 32, so accepting "at least 32" would let two correct wallets derive
 * different identities from the same mnemonic. A wallet holding only a spending
 * key, with no mnemonic, cannot derive SIWZ domain keys.
 */
export const SIWZ_SEED_BYTES = 64;

/** A derived, domain-scoped SIWZ signing identity. */
export interface SiwzDomainKey {
  /** Ed25519 secret key (32 bytes). Never leaves the wallet. */
  secretKey: Uint8Array;
  /** Ed25519 public key (32 bytes). */
  publicKey: Uint8Array;
  /** bech32m encoding of `publicKey`, used as the message subject. */
  identity: string;
  /** The normalised domain this key is scoped to. */
  domain: string;
  /** The wallet account index this key belongs to. */
  account: number;
}

// Authority grammar: host[:port] only. A scheme, path, userinfo or wildcard
// must be rejected rather than normalised, so that "https://example.com" can
// never derive a different key than "example.com".
const AUTHORITY = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*(?::(\d{1,5}))?$/;

/**
 * Canonical domain form used in derivation. The input must already be a bare
 * authority, `host` or `host:port`, matching the `domain` field of a SIWZ
 * message. Host is lower-cased, a trailing dot removed, and an explicit
 * default port (`:80`, `:443`) dropped, so one site cannot derive two
 * identities.
 *
 * Throws on anything that is not an authority. Passing a URL is a bug, not an
 * input to clean up.
 */
export function normalizeSiwzDomain(domain: string): string {
  if (typeof domain !== "string") {
    throw new SiwzError("INVALID_MESSAGE", "domain must be a string");
  }
  const lowered = domain.trim().toLowerCase();
  if (!lowered) throw new SiwzError("INVALID_MESSAGE", "domain must not be empty");
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(lowered)) {
    throw new SiwzError(
      "INVALID_MESSAGE",
      `domain must be a bare authority without a scheme; got "${domain}"`,
    );
  }
  // Drop a trailing dot on the host, keeping any port.
  const candidate = lowered.replace(/\.(?=:|$)/, "");
  const match = AUTHORITY.exec(candidate);
  if (!match) {
    throw new SiwzError(
      "INVALID_MESSAGE",
      `domain must be "host" or "host:port" with no scheme, path or credentials; got "${domain}"`,
    );
  }
  if (match[1] !== undefined) {
    const port = Number(match[1]);
    if (port < 1 || port > 65535) {
      throw new SiwzError("INVALID_MESSAGE", `port out of range in domain "${domain}"`);
    }
    if (port === 80 || port === 443) return candidate.slice(0, candidate.lastIndexOf(":"));
  }
  return candidate;
}

/**
 * Derive the domain-scoped keypair for a seed and wallet account. This is the
 * reference implementation wallets must match; a verifier never calls it.
 *
 * root = BLAKE2b-256(seed, personal = "SIWZ_Root_v1____")
 * sk   = BLAKE2b-256(BE32(account) || utf8(domain), key = root,
 *                    personal = "SIWZ_Domain_v1__")
 *
 * Personalised, keyed BLAKE2b keeps this key tree independent of every other
 * key derived from the same seed. Note that this is a BLAKE2b tree of its own,
 * not a ZIP 32 hardened path.
 *
 * `account` is the wallet's account index, included so that two accounts in one
 * wallet present distinct identities to the same site. It is encoded as four
 * bytes, big-endian.
 */
export function deriveSiwzDomainKey(
  seed: Uint8Array,
  domain: string,
  account = 0,
): SiwzDomainKey {
  if (seed.length !== SIWZ_SEED_BYTES) {
    throw new SiwzError(
      "INVALID_MESSAGE",
      `seed must be exactly ${SIWZ_SEED_BYTES} bytes (the BIP 39 binary seed); got ${seed.length}`,
    );
  }
  if (!Number.isInteger(account) || account < 0 || account > 0xffffffff) {
    throw new SiwzError("INVALID_MESSAGE", `account must be a uint32; got ${account}`);
  }
  const normalised = normalizeSiwzDomain(domain);
  const domainBytes = ENC.encode(normalised);
  const input = new Uint8Array(4 + domainBytes.length);
  input[0] = (account >>> 24) & 0xff;
  input[1] = (account >>> 16) & 0xff;
  input[2] = (account >>> 8) & 0xff;
  input[3] = account & 0xff;
  input.set(domainBytes, 4);

  const root = blake2b(seed, { dkLen: 32, personal: PERSONAL_ROOT });
  const secretKey = blake2b(input, { dkLen: 32, key: root, personal: PERSONAL_DOMAIN });
  const publicKey = ed25519.getPublicKey(secretKey);
  return {
    secretKey,
    publicKey,
    identity: encodeSiwzIdentity(publicKey),
    domain: normalised,
    account,
  };
}

/** bech32m-encode a 32-byte Ed25519 public key as a `siwz1…` identity. */
export function encodeSiwzIdentity(publicKey: Uint8Array): string {
  if (publicKey.length !== 32) {
    throw new SiwzError("INVALID_ADDRESS", `public key must be 32 bytes; got ${publicKey.length}`);
  }
  return bech32m.encode(SIWZ_ID_HRP, bech32m.toWords(publicKey), 128);
}

/** Decode a `siwz1…` identity back to its Ed25519 public key. */
export function decodeSiwzIdentity(identity: string): Uint8Array {
  let decoded: { prefix: string; words: number[] };
  try {
    decoded = bech32m.decode(identity as `${string}1${string}`, 128);
  } catch (err) {
    throw new SiwzError("INVALID_ADDRESS", `not a valid SIWZ identity: ${(err as Error).message}`);
  }
  if (decoded.prefix !== SIWZ_ID_HRP) {
    throw new SiwzError("INVALID_ADDRESS", `expected "${SIWZ_ID_HRP}" prefix, got "${decoded.prefix}"`);
  }
  const bytes = bech32m.fromWords(decoded.words);
  if (bytes.length !== 32) {
    throw new SiwzError("INVALID_ADDRESS", `SIWZ identity must hold 32 bytes; got ${bytes.length}`);
  }
  return Uint8Array.from(bytes);
}

/** True when `subject` parses as a SIWZ identity rather than a Zcash address. */
export function isSiwzIdentity(subject: string): boolean {
  if (!subject.startsWith(`${SIWZ_ID_HRP}1`)) return false;
  try {
    decodeSiwzIdentity(subject);
    return true;
  } catch {
    return false;
  }
}

/** The exact bytes a wallet signs: the prefix followed by the SIWZ message. */
export function siwzSigningPayload(message: string): Uint8Array {
  return ENC.encode(SIWZ_SIGNING_PREFIX + message);
}

/**
 * Sign a SIWZ message with a domain-scoped secret key. Reference implementation
 * for wallets and tests; returns a base64 Ed25519 signature (64 bytes).
 */
export function signSiwzMessage(message: string, secretKey: Uint8Array): string {
  return base64.encode(ed25519.sign(siwzSigningPayload(message), secretKey));
}

/**
 * Verify a domain-key signature against the identity in the message subject.
 *
 * The verifier needs nothing but the message, the signature, and the identity:
 * the identity *is* the public key, so there is no registry and no lookup. The
 * domain inside the signed message is what stops a signature issued for one
 * site from being replayed at another.
 *
 * Note what this cannot check: whether the wallet really derived the key for
 * this domain. A wallet that reuses one key everywhere produces valid
 * signatures and forfeits only its own user's unlinkability.
 */
export function verifySiwzDomainSignature(
  message: string,
  signatureBase64: string,
  identity: string,
): { valid: true } | { valid: false; error: "INVALID_ADDRESS" | "INVALID_SIGNATURE"; errorMessage: string } {
  let publicKey: Uint8Array;
  try {
    publicKey = decodeSiwzIdentity(identity);
  } catch (err) {
    return { valid: false, error: "INVALID_ADDRESS", errorMessage: (err as Error).message };
  }

  let signature: Uint8Array;
  try {
    signature = base64.decode(signatureBase64);
  } catch {
    return { valid: false, error: "INVALID_SIGNATURE", errorMessage: "signature is not valid base64" };
  }
  if (signature.length !== 64) {
    return {
      valid: false,
      error: "INVALID_SIGNATURE",
      errorMessage: `Ed25519 signature must be 64 bytes; got ${signature.length}`,
    };
  }

  let ok: boolean;
  try {
    ok = ed25519.verify(signature, siwzSigningPayload(message), publicKey);
  } catch (err) {
    return { valid: false, error: "INVALID_SIGNATURE", errorMessage: (err as Error).message };
  }
  if (!ok) {
    return {
      valid: false,
      error: "INVALID_SIGNATURE",
      errorMessage: "signature does not verify against the identity in the message",
    };
  }
  return { valid: true };
}
