/**
 * UFVK → ZBooks transaction sync.
 *
 * The lightwallet-rpc wrapper on the VPS holds one zingo-cli wallet per
 * UFVK (see apps/lightwallet-rpc/src/server.mjs). This module is the
 * ZBooks-side glue: ask the wrapper for the latest value_transfers for
 * a UFVK, normalise into the persisted Transaction shape, upsert.
 *
 * Status is written back into the Ufvk row so the UI can show "syncing
 * now", "last synced 2m ago", or "last sync failed: <reason>".
 */
import { getShieldedExplorer } from "./explorer";
import { getKey, updateKeySyncStatus, upsertTransactions } from "./db";

/**
 * Module-level set of UFVK ids that have a sync in flight. Prevents two
 * concurrent calls (e.g. user spams the refresh button) from both
 * pulling against the wrapper. A real deployment with multiple ZBooks
 * processes would need a row-level "syncing since" timestamp + lease;
 * single-process JSON-file DB makes a memory set fine for now.
 */
const inFlight = new Set<string>();

export interface SyncOutcome {
  ok: boolean;
  inserted?: number;
  updated?: number;
  syncedToBlock?: number | null;
  error?: string;
}

export async function syncUfvk(ufvkId: string): Promise<SyncOutcome> {
  const key = getKey(ufvkId);
  if (!key) return { ok: false, error: "UFVK not found" };

  if (inFlight.has(ufvkId)) {
    return { ok: false, error: "A sync is already running for this key" };
  }
  inFlight.add(ufvkId);

  const explorer = getShieldedExplorer();
  if (!explorer) {
    inFlight.delete(ufvkId);
    const msg =
      "No shielded backend is configured. Set LIGHTWALLET_RPC_URL + " +
      "LIGHTWALLET_RPC_TOKEN, or ZCASH_RPC_URL, or enable SIWZ_DEMO=1.";
    updateKeySyncStatus(ufvkId, { sync_status: "error", last_sync_error: msg });
    return { ok: false, error: msg };
  }
  if (!explorer.getTransactionsForUfvk) {
    inFlight.delete(ufvkId);
    const msg =
      "The configured shielded backend doesn't support UFVK syncing. " +
      "LightwalletExplorer (via apps/lightwallet-rpc) is the only one that does today.";
    updateKeySyncStatus(ufvkId, { sync_status: "error", last_sync_error: msg });
    return { ok: false, error: msg };
  }

  updateKeySyncStatus(ufvkId, { sync_status: "syncing", last_sync_error: undefined });

  try {
    const result = await explorer.getTransactionsForUfvk(key.ufvk, {
      birthday: key.birthday,
    });
    const normalised = result.transactions.map((t) => {
      const amountZec = zatoshiStringToZec(t.amountZatoshi);
      return {
        txid: t.txid,
        direction: t.direction,
        // Outgoing amounts are stored as negative ZEC so the existing
        // /transactions and /reports rendering keeps working without
        // touching every consumer to read direction separately.
        amount_zec: t.direction === "out" ? -Math.abs(amountZec) : Math.abs(amountZec),
        counterparty: t.counterparty ?? undefined,
        memo: t.memo ?? undefined,
        timestamp: t.timestamp ?? Date.now(),
        block_height: t.blockHeight ?? undefined,
      };
    });

    const { inserted, updated } = upsertTransactions(ufvkId, normalised);
    updateKeySyncStatus(ufvkId, {
      sync_status: "ok",
      last_synced_at: Date.now(),
      last_synced_block: result.syncedToBlock ?? undefined,
      last_chain_tip: result.chainTip ?? undefined,
      wallet_birthday: result.walletBirthday ?? undefined,
      last_sync_error: undefined,
      last_tx_count: result.transactions.length,
    });
    return { ok: true, inserted, updated, syncedToBlock: result.syncedToBlock };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    updateKeySyncStatus(ufvkId, { sync_status: "error", last_sync_error: msg });
    return { ok: false, error: msg };
  } finally {
    inFlight.delete(ufvkId);
  }
}

/**
 * Fire-and-forget variant for endpoints that don't want to wait the
 * couple of minutes a first-time UFVK sync can take. The HTTP response
 * returns immediately with sync_status "syncing"; the client polls
 * /api/keys to learn when it finishes.
 */
export function syncUfvkInBackground(ufvkId: string): void {
  void syncUfvk(ufvkId).catch((err) => {
    // syncUfvk swallows its own errors into the row; this catch is just
    // for the truly unexpected exception that escapes its try/catch.
    console.error(`[sync] uncaught for ${ufvkId}:`, err);
  });
}

function zatoshiStringToZec(s: string): number {
  // zatoshi is u64-shaped on the wire; ZEC display values fit in a JS
  // number safely until ~90 million ZEC (and the chain's total supply
  // is 21M), so a direct divide is fine.
  const n = Number(s);
  if (!Number.isFinite(n)) return 0;
  return n / 1e8;
}
