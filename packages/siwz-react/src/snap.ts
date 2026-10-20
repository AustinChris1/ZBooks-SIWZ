/**
 * MetaMask Snap integration for Zcash, targeting the ChainSafe WebZjs Zcash Snap.
 *
 * Sign-in never requests a viewing key. A UFVK is a permanent, unrevocable read
 * capability over the whole account and proves nothing about key control, so it is
 * the wrong credential for auth. Instead this module attempts, in order:
 *
 *   1. `signMessage` - SIWE parity. The Snap signs the SIWZ challenge, the server
 *      verifies the signature against the address. Nothing is disclosed.
 *   2. a send method - the Snap pays the memo challenge (dust + nonce in the memo)
 *      and the server verifies it on-chain by watching its own receiving address.
 *
 * The published Snap exposes neither yet, so both probes fail cleanly with
 * `method-unavailable` and callers fall back to the QR / paste flows. When
 * ChainSafe ships either method, the Snap path lights up with no code change here.
 * Tracking: https://github.com/ChainSafe/WebZjs/issues/165
 */

export const DEFAULT_SNAP_ID = "npm:@chainsafe/webzjs-zcash-snap";

/** Candidate RPC names for SIWE-style message signing, tried in order. */
const SIGN_MESSAGE_METHODS = ["signMessage", "siwz_signMessage", "zcash_signMessage"] as const;

/** Candidate RPC names for "pay this ZIP 321 URI", tried in order. */
const SEND_METHODS = ["sendZip321", "sendTransaction", "send", "signAndSendTransaction"] as const;

interface EthereumProvider {
  isMetaMask?: boolean;
  request: <T = unknown>(args: { method: string; params?: unknown }) => Promise<T>;
}

interface Eip6963ProviderInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

interface Eip6963ProviderDetail {
  info: Eip6963ProviderInfo;
  provider: EthereumProvider;
}

declare global {
  interface Window {
    ethereum?: EthereumProvider & { providers?: EthereumProvider[] };
  }
}

/**
 * Find the MetaMask provider via EIP-6963, falling back to legacy
 * `window.ethereum` detection when no announce event arrives.
 */
export async function findMetaMaskProvider(): Promise<EthereumProvider | null> {
  if (typeof window === "undefined") return null;

  const found: EthereumProvider[] = [];
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<Eip6963ProviderDetail>).detail;
    if (!detail) return;
    if (detail.info.rdns === "io.metamask" || detail.info.name === "MetaMask") {
      found.push(detail.provider);
    }
  };
  window.addEventListener("eip6963:announceProvider", handler);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  await new Promise((r) => setTimeout(r, 150));
  window.removeEventListener("eip6963:announceProvider", handler);

  if (found.length > 0) return found[0] ?? null;

  const eth = window.ethereum;
  if (!eth) return null;
  if (eth.isMetaMask) return eth;
  if (eth.providers && Array.isArray(eth.providers)) {
    const mm = eth.providers.find((p) => p.isMetaMask);
    if (mm) return mm;
  }
  return null;
}

export type SnapStatus =
  | { kind: "no-metamask"; message: string }
  | { kind: "snap-not-installed"; message: string; snapId: string }
  | { kind: "ready"; snapId: string; version: string };

export async function detectSnapEnvironment(snapId: string = DEFAULT_SNAP_ID): Promise<SnapStatus> {
  if (typeof window === "undefined") {
    return { kind: "no-metamask", message: "MetaMask is not available in this environment." };
  }
  const mm = await findMetaMaskProvider();
  if (!mm) {
    return {
      kind: "no-metamask",
      message:
        "MetaMask wasn't found. If you have multiple Ethereum wallets installed (Phantom, Coinbase, Brave, …), one of them may be capturing window.ethereum — try pausing them or set MetaMask as default.",
    };
  }
  let snaps: Record<string, { version: string }> = {};
  try {
    snaps = await mm.request<Record<string, { version: string }>>({
      method: "wallet_getSnaps",
    });
  } catch (err) {
    const msg = (err as Error).message ?? "";
    if (/no corresponding handler|method not found|does not support/i.test(msg)) {
      return {
        kind: "no-metamask",
        message:
          "A wallet responded but it doesn't support the MetaMask Snaps API. Confirm MetaMask is the active provider in your browser's wallet picker.",
      };
    }
    return {
      kind: "snap-not-installed",
      message: "Couldn't query installed Snaps. Update MetaMask to the latest version.",
      snapId,
    };
  }
  const installed = snaps[snapId];
  if (!installed) {
    return {
      kind: "snap-not-installed",
      message: `The Zcash Snap isn't installed in this MetaMask yet. Click the button below to install and connect it.`,
      snapId,
    };
  }
  return { kind: "ready", snapId, version: installed.version };
}

export async function requestSnapInstall(snapId: string = DEFAULT_SNAP_ID): Promise<string> {
  const mm = await findMetaMaskProvider();
  if (!mm) throw new Error("MetaMask was not found in this browser.");
  const result = await mm.request<Record<string, { version: string }>>({
    method: "wallet_requestSnaps",
    params: { [snapId]: {} },
  });
  const v = result?.[snapId]?.version;
  if (!v) throw new Error("MetaMask declined to install the Snap.");
  return v;
}

export type SnapErrorCode = "no-metamask" | "user-rejected" | "snap-error" | "method-unavailable";

export class SnapInvokeError extends Error {
  readonly code: SnapErrorCode;
  constructor(code: SnapErrorCode, message: string) {
    super(message);
    this.name = "SnapInvokeError";
    this.code = code;
  }
}

// Methods the Snap has already told us it doesn't implement. Keyed by
// `snapId:method` so a second click doesn't re-walk the whole candidate list.
const unavailableMethods = new Set<string>();

async function invokeSnap<T = unknown>(snapId: string, method: string, params?: unknown): Promise<T> {
  if (unavailableMethods.has(`${snapId}:${method}`)) {
    throw new SnapInvokeError("method-unavailable", `The Snap doesn't expose ${method}.`);
  }
  const mm = await findMetaMaskProvider();
  if (!mm) throw new SnapInvokeError("no-metamask", "MetaMask was not found in this browser.");
  try {
    return await mm.request<T>({
      method: "wallet_invokeSnap",
      params: { snapId, request: { method, params } },
    });
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    if (/reject|denied|cancel/i.test(msg)) {
      throw new SnapInvokeError("user-rejected", "MetaMask request was cancelled.");
    }
    if (/method.*(not found|not supported|unsupported|no corresponding handler)/i.test(msg)) {
      unavailableMethods.add(`${snapId}:${method}`);
      throw new SnapInvokeError("method-unavailable", `The Snap doesn't expose ${method}.`);
    }
    throw new SnapInvokeError("snap-error", msg);
  }
}

/**
 * Walk candidate RPC names, skipping ones the Snap has rejected as unknown.
 * Any other failure (user rejection, internal error) propagates immediately:
 * the method exists, so trying the next alias would be wrong.
 */
async function invokeFirstAvailable<T>(
  snapId: string,
  methods: readonly string[],
  params: unknown,
): Promise<{ method: string; result: T }> {
  for (const method of methods) {
    try {
      const result = await invokeSnap<T>(snapId, method, params);
      return { method, result };
    } catch (err) {
      if (err instanceof SnapInvokeError && err.code === "method-unavailable") continue;
      throw err;
    }
  }
  throw new SnapInvokeError(
    "method-unavailable",
    `This Snap exposes none of: ${methods.join(", ")}.`,
  );
}

/** Returns the connected account's stable per-seed identifier (no spend authority). */
export async function snapGetSeedFingerprint(snapId: string = DEFAULT_SNAP_ID): Promise<string> {
  const raw = await invokeSnap<unknown>(snapId, "getSeedFingerprint");
  return normaliseFingerprint(raw);
}

/**
 * Returns the account's Unified Full Viewing Key.
 *
 * @deprecated Never call this for authentication. A UFVK discloses the account's
 * entire payment history in both directions, permanently and unrevocably, and it
 * is not proof of key control. Kept only for apps that genuinely need to scan a
 * ledger with explicit user consent.
 */
export async function snapGetViewingKey(snapId: string = DEFAULT_SNAP_ID): Promise<string> {
  const raw = await invokeSnap<unknown>(snapId, "getViewingKey");
  return normaliseString(raw, "getViewingKey");
}

export interface SnapIdentity {
  /** Stable per-seed identifier (hex string). */
  fingerprint: string;
  /** The Snap ID this identity came from. */
  snapId: string;
  /** Installed Snap version (informational). */
  snapVersion: string;
  /**
   * Unified Full Viewing Key. Only present when `snapConnect` was called with
   * `includeViewingKey: true`, which sign-in must never do.
   * @deprecated See {@link snapGetViewingKey}.
   */
  ufvk?: string;
}

export interface SnapConnectOptions {
  /**
   * Also fetch the account's UFVK. Off by default and unnecessary for sign-in.
   * @deprecated See {@link snapGetViewingKey}.
   */
  includeViewingKey?: boolean;
}

/**
 * Install the Snap if needed, then read the account's seed fingerprint.
 *
 * A fingerprint is an attestation from MetaMask, not a cryptographic proof, so
 * it identifies a returning user but must not be the only basis for a session.
 * Pair it with {@link snapSignMessage} or {@link snapPayMemoChallenge}.
 */
export async function snapConnect(
  snapId: string = DEFAULT_SNAP_ID,
  opts: SnapConnectOptions = {},
): Promise<SnapIdentity> {
  let env = await detectSnapEnvironment(snapId);
  if (env.kind === "no-metamask") {
    throw new SnapInvokeError("no-metamask", env.message);
  }
  if (env.kind === "snap-not-installed") {
    await requestSnapInstall(env.snapId);
    env = await detectSnapEnvironment(snapId);
    if (env.kind !== "ready") {
      throw new SnapInvokeError("snap-error", env.kind === "snap-not-installed" ? env.message : "Snap install failed.");
    }
  }
  const identity: SnapIdentity = {
    fingerprint: await snapGetSeedFingerprint(env.snapId),
    snapId: env.snapId,
    snapVersion: env.version,
  };
  if (opts.includeViewingKey) {
    identity.ufvk = await snapGetViewingKey(env.snapId);
  }
  return identity;
}

export interface SnapSignature {
  /** Base64 or hex signature, as returned by the Snap. */
  signature: string;
  /** The address that signed, when the Snap reports it. */
  address?: string;
  /** Which RPC name answered, for diagnostics. */
  method: string;
}

/**
 * Ask the Snap to sign a SIWZ challenge string (the SIWE-equivalent path).
 * Throws `method-unavailable` until the Snap ships a message-signing RPC;
 * callers should fall back to the memo or paste flow on that code.
 */
export async function snapSignMessage(
  message: string,
  snapId: string = DEFAULT_SNAP_ID,
): Promise<SnapSignature> {
  const { method, result } = await invokeFirstAvailable<unknown>(snapId, SIGN_MESSAGE_METHODS, {
    message,
  });
  return { ...normaliseSignature(result, method), method };
}

export interface SnapPayment {
  /** Transaction ID of the broadcast payment, when the Snap reports one. */
  txid?: string;
  /** Which RPC name answered, for diagnostics. */
  method: string;
}

/**
 * Ask the Snap to pay a memo challenge, given the ZIP 321 URI the SIWZ server
 * issued. This keeps the user inside MetaMask instead of scanning a QR code,
 * and the server still verifies the payment on-chain.
 *
 * Throws `method-unavailable` until the Snap ships a send RPC. `signPczt` alone
 * is not enough here: constructing the PCZT needs WebZjs WASM in the page, so
 * that variant belongs in the integrating app, not this helper.
 */
export async function snapPayMemoChallenge(
  zip321Uri: string,
  snapId: string = DEFAULT_SNAP_ID,
): Promise<SnapPayment> {
  const { method, result } = await invokeFirstAvailable<unknown>(snapId, SEND_METHODS, {
    uri: zip321Uri,
    zip321: zip321Uri,
  });
  return { txid: extractTxid(result), method };
}

export type SnapAuthAttempt =
  | { kind: "signature"; identity: SnapIdentity; signature: SnapSignature }
  | { kind: "payment"; identity: SnapIdentity; payment: SnapPayment }
  | { kind: "unsupported"; identity: SnapIdentity; tried: readonly string[] };

/**
 * Connect, then try every verifiable auth path the installed Snap supports.
 * Returns `unsupported` when none are available so the caller can fall back
 * to the QR or paste flow rather than inventing a session from a fingerprint.
 */
export async function snapAuthenticate(args: {
  /** The SIWZ challenge string to sign, when a signing RPC exists. */
  message?: string;
  /** The ZIP 321 URI to pay, when a send RPC exists. */
  zip321Uri?: string;
  snapId?: string;
}): Promise<SnapAuthAttempt> {
  const snapId = args.snapId ?? DEFAULT_SNAP_ID;
  const identity = await snapConnect(snapId);

  if (args.message) {
    try {
      return { kind: "signature", identity, signature: await snapSignMessage(args.message, snapId) };
    } catch (err) {
      if (!(err instanceof SnapInvokeError) || err.code !== "method-unavailable") throw err;
    }
  }
  if (args.zip321Uri) {
    try {
      return { kind: "payment", identity, payment: await snapPayMemoChallenge(args.zip321Uri, snapId) };
    } catch (err) {
      if (!(err instanceof SnapInvokeError) || err.code !== "method-unavailable") throw err;
    }
  }
  return { kind: "unsupported", identity, tried: [...SIGN_MESSAGE_METHODS, ...SEND_METHODS] };
}

function normaliseSignature(raw: unknown, method: string): { signature: string; address?: string } {
  if (typeof raw === "string") return { signature: raw };
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    const sig = ["signature", "sig", "value", "result", "data"].find((k) => typeof r[k] === "string");
    if (sig) {
      const address = typeof r.address === "string" ? r.address : undefined;
      return { signature: r[sig] as string, address };
    }
  }
  throw new SnapInvokeError("snap-error", `Snap.${method} returned an unexpected shape.`);
}

function extractTxid(raw: unknown): string | undefined {
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    for (const key of ["txid", "txId", "hash", "value", "result"]) {
      if (typeof r[key] === "string") return r[key] as string;
    }
  }
  return undefined;
}

function normaliseString(raw: unknown, method: string): string {
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    for (const key of ["value", "result", "data", "ufvk", "viewingKey"]) {
      if (typeof r[key] === "string") return r[key] as string;
    }
  }
  throw new SnapInvokeError("snap-error", `Snap.${method} returned an unexpected shape: ${JSON.stringify(raw)?.slice(0, 120)}`);
}

function normaliseFingerprint(raw: unknown): string {
  if (typeof raw === "string") return raw.startsWith("0x") ? raw.slice(2) : raw;
  if (Array.isArray(raw)) {
    return raw.map((b) => Number(b).toString(16).padStart(2, "0")).join("");
  }
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    for (const key of ["fingerprint", "value", "result", "data"]) {
      if (typeof r[key] === "string") return (r[key] as string).replace(/^0x/, "");
      if (Array.isArray(r[key])) {
        return (r[key] as number[]).map((b) => Number(b).toString(16).padStart(2, "0")).join("");
      }
    }
  }
  throw new SnapInvokeError("snap-error", `Snap.getSeedFingerprint returned an unexpected shape`);
}
