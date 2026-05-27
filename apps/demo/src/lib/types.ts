/**
 * Pure types + constants shared between server and client modules.
 *
 * db.ts depends on node:fs / node:crypto, so any client component that
 * imports a *value* (not just a type) from db.ts drags those node
 * imports into the browser bundle. To avoid that, the bits that need to
 * be referenced from both sides live here. db.ts re-exports them so
 * server code can keep importing from "@/lib/db" if it prefers.
 */

export type Role = "admin" | "treasurer" | "viewer";

export type Category =
  | "grant_payout"
  | "contractor"
  | "expense"
  | "reimbursement"
  | "refund"
  | "internal_transfer"
  | "income"
  | "other";

export const CATEGORY_LABEL: Record<Category, string> = {
  grant_payout: "Grant payout",
  contractor: "Contractor",
  expense: "Expense",
  reimbursement: "Reimbursement",
  refund: "Refund",
  internal_transfer: "Internal transfer",
  income: "Income",
  other: "Other / unclassified",
};

export type SyncStatus = "idle" | "syncing" | "ok" | "error";

export interface Ufvk {
  id: string;
  owner: string;
  label: string;
  ufvk: string;
  primary: boolean;
  created_at: number;
  sync_status: SyncStatus;
  last_synced_at?: number;
  last_synced_block?: number;
  last_sync_error?: string;
  last_tx_count?: number;
  last_chain_tip?: number;
  wallet_birthday?: number;
  /**
   * User-supplied scan-start block. When set, the wrapper's first sync
   * for this UFVK uses it as `--birthday`. Optional — the wrapper has
   * its own sensible default (NU5 activation).
   */
  birthday?: number;
}

export interface Transaction {
  id: string;
  ufvk_id: string;
  txid: string;
  direction: "in" | "out";
  amount_zec: number;
  counterparty?: string;
  memo?: string;
  timestamp: number;
  block_height?: number;
  tag?: Category;
  notes?: string;
  tagged_by?: string;
  tagged_at?: number;
}

export interface TeamMember {
  address: string;
  role: Role;
  added_by: string;
  added_at: number;
}

export interface Counterparty {
  address: string;
  label: string;
  notes?: string;
  added_by: string;
  added_at: number;
  updated_at?: number;
}
