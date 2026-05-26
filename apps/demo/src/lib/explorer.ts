/**
 * Block-explorer client for SIWZ memo-challenge verification.
 *
 * The job: given a txid the user claims they just sent, return the list
 * of transparent outputs in that tx (recipient address + amount in
 * zatoshi). The verifier then checks whether any output matches the
 * (serviceAddress, expectedAmount) pair from the issued challenge.
 *
 * Default backend is [Blockchair](https://blockchair.com/api/docs)'s Zcash
 * dashboard endpoint — free, no API key required, supports mainnet only.
 * The shape is small and stable; if the free tier becomes unreliable we
 * can swap in zcashscan or run our own indexer behind the same interface.
 *
 * Pluggable on purpose: in tests we use the `MockExplorer` to inject a
 * synthetic tx; in production the user can swap in their own explorer
 * by setting `EXPLORER` to a different implementation.
 */

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

export interface Explorer {
  /**
   * Look up a single transparent transaction by its txid. Returns null if
   * the explorer hasn't seen it (e.g. unconfirmed, or wrong network).
   * Should NOT throw on "not found" — only on real network/API errors.
   */
  getTransaction(txid: string): Promise<TxDetails | null>;
  /**
   * Return the most recent N transparent outputs (across multiple txs)
   * paying to the given address. Used by the SIWZ memo-challenge auto-
   * polling endpoint: we scan recent payments for one with the unique
   * amount that matches a pending challenge.
   */
  getRecentOutputsToAddress(address: string, limit?: number): Promise<RecentOutput[]>;
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

  constructor(private readonly fixtures: Record<string, TxDetails> = {}) {}

  add(tx: TxDetails): void {
    this.fixtures[tx.txid] = tx;
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
}

export function isMockExplorer(e: Explorer): e is MockExplorer {
  return Boolean((e as { __mock?: boolean }).__mock);
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

export function setExplorer(e: Explorer): () => void {
  const prev = cache[GLOBAL_KEY];
  cache[GLOBAL_KEY] = e;
  return () => {
    cache[GLOBAL_KEY] = prev;
  };
}
