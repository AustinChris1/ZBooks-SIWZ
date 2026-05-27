/**
 * Block-explorer client for SIWZ memo-challenge verification.
 *
 * Two backends are exercised from the same interface:
 *
 *   - BlockchairExplorer — public block explorer; reads transparent
 *     outputs by address. Used for transparent service addresses
 *     (memo-challenge in amount-encoding mode).
 *   - ZcashRpcExplorer  — talks to a local/remote Zcash daemon
 *     (zcashd/zaino/zallet) via HTTP RPC or zcash-cli. Reads
 *     DECRYPTED incoming memos on shielded service addresses (sapling /
 *     unified) — requires the daemon to hold the IVK.
 *
 * Plus `MockExplorer` (in-memory fixtures) for DEMO mode and tests.
 *
 * The factory picks one based on which env vars are set; the issue
 * endpoint guards against asking the wrong kind of explorer for the
 * service address type.
 */

import { ZcashRpcClient, decodeMemoHex, ZcashRpcError } from "./zcash-rpc";

export interface TxOutput {
  address: string;
  amountZatoshi: bigint;
}

export interface TxDetails {
  txid: string;
  outputs: TxOutput[];
  blockHeight?: number;
  blockTime?: number;
}

export interface RecentOutput extends TxOutput {
  txid: string;
  blockTime?: number;
  blockHeight?: number;
}

/**
 * A decrypted shielded note received at a sapling / orchard / unified
 * service address. Memo is the UTF-8 form (after stripping 0xf6 padding).
 */
export interface RecentMemo {
  txid: string;
  memo: string;
  amountZatoshi: bigint;
  blockTime?: number;
  blockHeight?: number;
}

/**
 * A single value transfer derived from a UFVK sync. Wire shape between
 * the lightwallet-rpc wrapper and ZBooks. Numeric fields stay as strings
 * to keep JSON-safe big numbers; the ZBooks importer is what converts to
 * the persisted Transaction shape.
 */
export interface UfvkTransaction {
  txid: string;
  direction: "in" | "out";
  amountZatoshi: string;
  memo: string | null;
  counterparty: string | null;
  blockHeight: number | null;
  timestamp: number | null;
  status: string;
  poolReceived: string | null;
}

export interface UfvkSyncResult {
  transactions: UfvkTransaction[];
  syncedToBlock: number | null;
  /** Chain tip the wrapper saw at the time of the response. */
  chainTip?: number | null;
  /** Wallet birthday height (the block we started scanning from). */
  walletBirthday?: number | null;
  syncedAt: string;
}

export interface Explorer {
  /**
   * Look up a single transparent transaction by its txid. Returns null if
   * the explorer hasn't seen it (e.g. unconfirmed, or wrong network).
   * Should NOT throw on "not found" — only on real network/API errors.
   */
  getTransaction(txid: string): Promise<TxDetails | null>;
  /**
   * Return the most recent N transparent outputs paying to the given
   * t-address. Used by the SIWZ memo-challenge auto-polling endpoint in
   * transparent-amount mode.
   */
  getRecentOutputsToAddress(address: string, limit?: number): Promise<RecentOutput[]>;
  /**
   * Return the most recent N decrypted shielded notes received at the
   * given shielded address (sapling / unified). Used by the SIWZ memo-
   * challenge auto-polling endpoint in shielded-memo mode. Implementations
   * that don't have access to the IVK (e.g. block explorers) should
   * either throw or omit this method; the issue endpoint refuses
   * shielded service addresses when no shielded-capable explorer exists.
   */
  getRecentMemosToAddress?(address: string, limit?: number): Promise<RecentMemo[]>;
  /**
   * Sync a UFVK to chain tip and return every value transfer it has
   * received or sent. Optional because only backends with a real lite-
   * wallet behind them can satisfy it (LightwalletExplorer today). Used
   * by the ZBooks transaction importer.
   *
   * `birthday` is the lower-bound scan block, consulted only on the
   * wrapper's first sync for this UFVK. Omit to let the wrapper pick.
   */
  getTransactionsForUfvk?(ufvk: string, opts?: { birthday?: number }): Promise<UfvkSyncResult>;
}

// ----- Blockchair -----

const BLOCKCHAIR_BASE = "https://api.blockchair.com/zcash";

export class BlockchairExplorer implements Explorer {
  constructor(private readonly apiKey?: string) {}

  async getTransaction(txid: string): Promise<TxDetails | null> {
    if (!/^[0-9a-fA-F]{64}$/.test(txid)) return null;
    const url = new URL(`${BLOCKCHAIR_BASE}/dashboards/transaction/${txid}`);
    if (this.apiKey) url.searchParams.set("key", this.apiKey);
    const res = await fetch(url.toString(), {
      headers: { accept: "application/json" },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new ExplorerError(`Blockchair returned ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as BlockchairResponse;
    const tx = json?.data?.[txid];
    if (!tx) return null;
    return {
      txid,
      outputs: (tx.outputs ?? []).map((o) => ({
        address: o.recipient,
        amountZatoshi: BigInt(o.value),
      })),
      blockHeight: tx.transaction?.block_id ?? undefined,
      blockTime: tx.transaction?.time
        ? new Date(tx.transaction.time + "Z").getTime()
        : undefined,
    };
  }

  async getRecentOutputsToAddress(address: string, limit = 50): Promise<RecentOutput[]> {
    // Blockchair's outputs query returns rows with full output detail
    // including the parent txid — exactly what the polling endpoint needs
    // without an extra per-tx fetch.
    const url = new URL(`${BLOCKCHAIR_BASE}/outputs`);
    url.searchParams.set("q", `recipient(${address})`);
    url.searchParams.set("limit", String(limit));
    if (this.apiKey) url.searchParams.set("key", this.apiKey);
    const res = await fetch(url.toString(), { headers: { accept: "application/json" } });
    if (!res.ok) throw new ExplorerError(`Blockchair outputs query returned ${res.status}`);
    const json = (await res.json()) as BlockchairOutputsResponse;
    return (json.data ?? []).map((row) => ({
      address: row.recipient,
      amountZatoshi: BigInt(row.value),
      txid: row.transaction_hash,
      blockHeight: row.block_id ?? undefined,
      blockTime: row.time ? new Date(row.time + "Z").getTime() : undefined,
    }));
  }
}

interface BlockchairResponse {
  data?: Record<
    string,
    {
      transaction?: { block_id?: number; time?: string };
      outputs?: { recipient: string; value: string | number }[];
    }
  >;
}

interface BlockchairOutputsResponse {
  data?: {
    transaction_hash: string;
    recipient: string;
    value: string | number;
    block_id?: number;
    time?: string;
  }[];
}

export class ExplorerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExplorerError";
  }
}

// ----- Mock (tests / demo mode) -----

export class MockExplorer implements Explorer {
  // Tagged so callers can detect a mock across Next.js dev hot-reloads
  // (where `instanceof` is unreliable because each route can import its
  // own copy of the module → a different class identity).
  readonly __mock = true as const;

  constructor(
    private readonly fixtures: Record<string, TxDetails> = {},
    private readonly memos: RecentMemo[] = [],
  ) {}

  add(tx: TxDetails): void {
    this.fixtures[tx.txid] = tx;
  }

  addMemo(m: RecentMemo): void {
    this.memos.push(m);
  }

  async getTransaction(txid: string): Promise<TxDetails | null> {
    return this.fixtures[txid] ?? null;
  }

  async getRecentOutputsToAddress(address: string, limit = 50): Promise<RecentOutput[]> {
    const rows: RecentOutput[] = [];
    for (const tx of Object.values(this.fixtures)) {
      for (const o of tx.outputs) {
        if (o.address === address) {
          rows.push({
            address: o.address,
            amountZatoshi: o.amountZatoshi,
            txid: tx.txid,
            blockHeight: tx.blockHeight,
            blockTime: tx.blockTime,
          });
        }
      }
    }
    return rows.slice(-limit).reverse();
  }

  async getRecentMemosToAddress(_address: string, limit = 50): Promise<RecentMemo[]> {
    // The mock doesn't enforce per-address routing for memos because tests
    // and the demo-simulate endpoint inject memos directly. In a real
    // explorer the daemon's wallet is already scoped to addresses it owns.
    return this.memos.slice(-limit).reverse();
  }
}

export function isMockExplorer(e: Explorer): e is MockExplorer {
  return Boolean((e as { __mock?: boolean }).__mock);
}

// ----- Zcash daemon RPC explorer -----

/**
 * Explorer backed by a Zcash daemon's wallet RPC (zcashd / zaino /
 * zallet). Reads decrypted memos for incoming shielded notes addressed
 * to a service z-addr / UA the daemon's wallet has the IVK for.
 *
 * The transparent output path here is a fallback — for transparent
 * service addresses, BlockchairExplorer is usually a better fit (no
 * local daemon required). We still implement it so a deployment with
 * no public-explorer access can rely solely on the daemon.
 */
export class ZcashRpcExplorer implements Explorer {
  constructor(private readonly rpc: ZcashRpcClient) {}

  describe(): string {
    return this.rpc.describe();
  }

  async getTransaction(txid: string): Promise<TxDetails | null> {
    try {
      const raw = await this.rpc.call<RpcGetRawTransaction>("getrawtransaction", [txid, 1]);
      if (!raw || !raw.vout) return null;
      return {
        txid,
        outputs: raw.vout.map((v) => ({
          address: v.scriptPubKey?.addresses?.[0] ?? "",
          amountZatoshi: BigInt(Math.round((v.value ?? 0) * 1e8)),
        })).filter((o) => o.address),
        blockHeight: raw.height ?? undefined,
        blockTime: raw.time ? raw.time * 1000 : undefined,
      };
    } catch (err) {
      if (err instanceof ZcashRpcError && err.code === "rpc") return null;
      throw err;
    }
  }

  async getRecentOutputsToAddress(address: string, limit = 50): Promise<RecentOutput[]> {
    // Use the daemon's wallet to list received transparent outputs.
    // Requires the address to be watched / owned by the wallet.
    const rows = await this.rpc.call<RpcListReceivedByAddress[]>(
      "z_listreceivedbyaddress",
      [address, 0],
    ).catch(() => null);
    if (rows && Array.isArray(rows)) {
      return rows.slice(-limit).reverse().map((r) => ({
        address,
        amountZatoshi: BigInt(Math.round((r.amount ?? 0) * 1e8)),
        txid: r.txid,
        blockHeight: r.blockheight ?? r.height ?? undefined,
      }));
    }
    return [];
  }

  async getRecentMemosToAddress(address: string, limit = 50): Promise<RecentMemo[]> {
    // Try z_listreceivedbyaddress first — the standard zcashd RPC.
    // Returns one entry per received note with hex-encoded memo, value,
    // txid, etc. Works for sapling, orchard, and unified addresses in
    // recent daemon versions.
    let rows: RpcListReceivedByAddress[];
    try {
      rows = await this.rpc.call<RpcListReceivedByAddress[]>(
        "z_listreceivedbyaddress",
        [address, 0],
      );
    } catch (err) {
      if (err instanceof ZcashRpcError && err.code === "method-not-found") {
        // Some daemons rename or scope this differently. We don't have a
        // good universal fallback that decrypts memos without it; surface
        // the error so the caller can show a config message.
        throw new ZcashRpcError(
          "method-not-found",
          `Your Zcash daemon doesn't support z_listreceivedbyaddress. ` +
          `For SIWZ shielded sign-in we need a wallet RPC that returns ` +
          `decrypted memos for incoming notes. Try a recent zcashd (>=5.0) ` +
          `or check your zallet/zaino RPC docs for the equivalent method.`,
        );
      }
      throw err;
    }
    return rows
      .slice(-limit)
      .reverse()
      .map((r): RecentMemo | null => {
        const memo = decodeMemoHex(r.memo ?? "");
        if (memo == null) return null;
        return {
          txid: r.txid,
          memo,
          amountZatoshi: BigInt(Math.round((r.amount ?? 0) * 1e8)),
          blockHeight: r.blockheight ?? r.height ?? undefined,
        };
      })
      .filter((m): m is RecentMemo => m !== null);
  }
}

// Shape of zcashd's getrawtransaction verbose response (subset we need).
interface RpcGetRawTransaction {
  vout?: { value?: number; scriptPubKey?: { addresses?: string[] } }[];
  height?: number;
  time?: number;
}

// Shape of zcashd's z_listreceivedbyaddress entry.
interface RpcListReceivedByAddress {
  txid: string;
  amount?: number;
  memo?: string;     // hex-encoded, padded with 0xf6 to 512 bytes
  blockheight?: number;
  height?: number;
}

/**
 * In DEMO mode, prime the singleton mock explorer with a fixture that
 * satisfies the given expected output and return the synthetic txid.
 * In non-demo mode, returns null.
 */
export function primeDemoFixture(
  expected: { serviceAddress: string; amountZatoshi: bigint },
  randomTxid: () => string,
): string | null {
  if (process.env.SIWZ_DEMO !== "1") return null;
  const e = getDefaultExplorer();
  if (!isMockExplorer(e)) return null;
  const txid = randomTxid();
  e.add({
    txid,
    outputs: [{ address: expected.serviceAddress, amountZatoshi: expected.amountZatoshi }],
    blockHeight: 2_900_000 + Math.floor(Math.random() * 1000),
    blockTime: Date.now(),
  });
  return txid;
}

/**
 * Shielded counterpart to primeDemoFixture: inject a decrypted memo
 * fixture so the shielded-memo poll path sees a matching note. Returns
 * the synthetic txid that the demo UI can show the user.
 */
export function primeDemoMemoFixture(
  expected: { memo: string; amountZatoshi: bigint },
  randomTxid: () => string,
): string | null {
  if (process.env.SIWZ_DEMO !== "1") return null;
  const e = getDefaultExplorer();
  if (!isMockExplorer(e)) return null;
  const txid = randomTxid();
  e.addMemo({
    txid,
    memo: expected.memo,
    amountZatoshi: expected.amountZatoshi,
    blockHeight: 2_900_000 + Math.floor(Math.random() * 1000),
    blockTime: Date.now(),
  });
  return txid;
}

// ----- Default singleton -----
//
// We cache the singleton on globalThis so Next.js dev mode (which loads
// each route module separately) doesn't end up with one mock-explorer
// instance per route. With the global cache, /api/auth/memo/issue and
// /api/auth/memo/verify both see the same MockExplorer and the seeded
// fixture round-trips.

const GLOBAL_KEY = Symbol.for("@siwz/zbooks/explorer");
type GlobalCache = { [k: symbol]: Explorer | undefined };
const cache = globalThis as unknown as GlobalCache;

export function getDefaultExplorer(): Explorer {
  const wantMock = process.env.SIWZ_DEMO === "1";
  const existing = cache[GLOBAL_KEY];
  // Re-check the env each lookup so a stale singleton (e.g. created
  // before SIWZ_DEMO was set during dev) doesn't lock us into the
  // wrong backend. globalThis persists across Next.js HMR reloads;
  // env vars can change between reloads if .env.local is edited.
  if (existing && wantMock === isMockExplorer(existing)) return existing;
  const made: Explorer = wantMock
    ? new MockExplorer()
    : new BlockchairExplorer(process.env.BLOCKCHAIR_API_KEY);
  cache[GLOBAL_KEY] = made;
  return made;
}

/**
 * Get the Zcash-RPC-backed explorer (or null if no RPC is configured).
 * Used by the issue/poll endpoints when the service address is shielded
 * — a public block explorer can't decrypt shielded memos, so we need
 * the daemon's wallet. In DEMO mode the mock satisfies both backends.
 *
 * Tries (in priority order):
 *   1. SIWZ_DEMO=1 → MockExplorer (for local dev / e2e)
 *   2. LIGHTWALLET_RPC_URL → LightwalletExplorer (production-shaped: a
 *      small VPS running apps/lightwallet-rpc with a zingo-cli wallet)
 *   3. ZCASH_RPC_URL / ZCASH_CLI_PATH → ZcashRpcExplorer (full daemon)
 *   4. null → caller surfaces "no shielded backend configured"
 */
export function getShieldedExplorer(): Explorer | null {
  if (process.env.SIWZ_DEMO === "1") return getDefaultExplorer();
  const lwUrl = process.env.LIGHTWALLET_RPC_URL;
  const lwToken = process.env.LIGHTWALLET_RPC_TOKEN;
  if (lwUrl && lwToken) {
    return new LightwalletExplorer(lwUrl, lwToken);
  }
  const rpc = ZcashRpcClient.fromEnv();
  if (!rpc.isConfigured) return null;
  return new ZcashRpcExplorer(rpc);
}

// ----- Lightwallet wrapper explorer -----

/**
 * Talks to `apps/lightwallet-rpc` over HTTPS — the deployment path that
 * runs a tiny `zingo-cli` lite wallet on a VPS without needing a full
 * 60GB sync. See docs/winning-deployment.md for the deployment recipe.
 *
 * Only implements getRecentMemosToAddress because that's all the wrapper
 * exposes. For transparent fallback, use BlockchairExplorer alongside.
 */
export class LightwalletExplorer implements Explorer {
  constructor(private readonly url: string, private readonly token: string) {}

  async getTransaction(_txid: string): Promise<TxDetails | null> {
    // Not supported by the wrapper — that's a transparent-flow concern.
    return null;
  }

  async getRecentOutputsToAddress(_address: string, _limit = 50): Promise<RecentOutput[]> {
    return [];
  }

  async getRecentMemosToAddress(address: string, limit = 50): Promise<RecentMemo[]> {
    const res = await fetch(`${this.url.replace(/\/$/, "")}/memos`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({ address, limit }),
    });
    if (!res.ok) {
      throw new ExplorerError(`lightwallet-rpc returned ${res.status}: ${await res.text().catch(() => "")}`);
    }
    const json = (await res.json()) as { memos?: { txid: string; memo: string; amountZatoshi: string; blockHeight?: number }[] };
    return (json.memos ?? []).map((m) => ({
      txid: m.txid,
      memo: m.memo,
      amountZatoshi: BigInt(m.amountZatoshi),
      blockHeight: m.blockHeight,
    }));
  }

  async getTransactionsForUfvk(
    ufvk: string,
    opts: { birthday?: number } = {},
  ): Promise<UfvkSyncResult> {
    // First sync for a UFVK can take a couple of minutes server-side;
    // give the request room to breathe. Subsequent syncs are fast.
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 6 * 60_000);
    try {
      const body: { ufvk: string; birthday?: number } = { ufvk };
      if (Number.isFinite(opts.birthday)) body.birthday = opts.birthday;
      const res = await fetch(`${this.url.replace(/\/$/, "")}/transactions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        throw new ExplorerError(
          `lightwallet-rpc /transactions returned ${res.status}: ${await res.text().catch(() => "")}`,
        );
      }
      return (await res.json()) as UfvkSyncResult;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function setExplorer(e: Explorer): () => void {
  const prev = cache[GLOBAL_KEY];
  cache[GLOBAL_KEY] = e;
  return () => {
    cache[GLOBAL_KEY] = prev;
  };
}
