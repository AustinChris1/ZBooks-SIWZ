import { getShieldedExplorer } from "./explorer";
import { getKey, updateKeySyncStatus, upsertTransactions } from "./db";

// In-process lock so a re-click of "Sync" can't run two zingo processes
// against the same wallet. Multi-process deploys would need a DB lease.
const inFlight = new Set<string>();

export interface SyncOutcome {
  ok: boolean;
  inserted?: number;
  updated?: number;
  syncedToBlock?: number | null;
  error?: string;
}

export async function syncUfvk(ufvkId: string): Promise<SyncOutcome> {
  const key = await getKey(ufvkId);
  if (!key) return { ok: false, error: "UFVK not found" };

  if (inFlight.has(ufvkId)) {
    return { ok: false, error: "A sync is already running for this key" };
  }
  inFlight.add(ufvkId);

  const explorer = getShieldedExplorer();
  if (!explorer) {
    inFlight.delete(ufvkId);
    const msg =
      "No shielded backend configured. Set LIGHTWALLET_RPC_URL + LIGHTWALLET_RPC_TOKEN, or ZCASH_RPC_URL, or SIWZ_DEMO=1.";
    await updateKeySyncStatus(ufvkId, { sync_status: "error", last_sync_error: msg });
    return { ok: false, error: msg };
  }
  if (!explorer.getTransactionsForUfvk) {
    inFlight.delete(ufvkId);
    const msg = "The configured shielded backend doesn't support UFVK syncing.";
    await updateKeySyncStatus(ufvkId, { sync_status: "error", last_sync_error: msg });
    return { ok: false, error: msg };
  }

  await updateKeySyncStatus(ufvkId, { sync_status: "syncing", last_sync_error: undefined });

  try {
    const result = await explorer.getTransactionsForUfvk(key.ufvk, {
      birthday: key.birthday,
    });
    const normalised = result.transactions.map((t) => {
      const amountZec = zatoshiStringToZec(t.amountZatoshi);
      return {
        txid: t.txid,
        direction: t.direction,
        // Outgoing stored as negative so /reports + /transactions render without a direction-aware sign flip.
        amount_zec: t.direction === "out" ? -Math.abs(amountZec) : Math.abs(amountZec),
        counterparty: t.counterparty ?? undefined,
        memo: t.memo ?? undefined,
        timestamp: t.timestamp ?? Date.now(),
        block_height: t.blockHeight ?? undefined,
      };
    });

    const { inserted, updated } = await upsertTransactions(ufvkId, normalised);
    await updateKeySyncStatus(ufvkId, {
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
    await updateKeySyncStatus(ufvkId, { sync_status: "error", last_sync_error: msg });
    return { ok: false, error: msg };
  } finally {
    inFlight.delete(ufvkId);
  }
}

// Fire-and-forget: HTTP returns immediately, client polls /api/keys for status.
export function syncUfvkInBackground(ufvkId: string): void {
  void syncUfvk(ufvkId).catch((err) => {
    console.error(`[sync] uncaught for ${ufvkId}:`, err);
  });
}

function zatoshiStringToZec(s: string): number {
  const n = Number(s);
  if (!Number.isFinite(n)) return 0;
  return n / 1e8;
}
