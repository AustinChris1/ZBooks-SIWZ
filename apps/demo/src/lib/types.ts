// Pure types shared between server (db.ts) and client. Live here so
// client components can import them without dragging node:fs into the bundle.

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
  // Scan-start block for the wrapper's first sync; wrapper has its own default if unset.
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

// A contributor the team pays. Separate from Counterparty: counterparties
// label addresses ZBooks observes; payees are people you actively pay out to.
export interface Payee {
  id: string;
  label: string;
  address: string;
  notes?: string;
  added_by: string;
  added_at: number;
  archived?: boolean;
}

// Whether the underlying work is done. Only `completed` items enter a batch.
export type WorkStatus = "in_progress" | "completed";
// Whether the money has moved. Reconciliation flips `unpaid` -> `paid`.
export type PayStatus = "unpaid" | "paid" | "failed";
export type PayoutRunStatus = "draft" | "sent" | "reconciled" | "void";

// A weekly (or ad-hoc) payout. Pays FROM the treasury watched by source_ufvk_id.
export interface PayoutRun {
  id: string;
  title: string;
  source_ufvk_id?: string;
  created_by: string;
  created_at: number;
  status: PayoutRunStatus;
  sent_at?: number;
  note?: string;
}

// One contributor's line in a run. label/address are denormalised from the
// payee at creation time so editing/removing a payee never rewrites history.
export interface PayoutLineItem {
  id: string;
  run_id: string;
  payee_id?: string;
  label: string;
  address: string;
  amount_zec: number;
  memo?: string;
  work_status: WorkStatus;
  pay_status: PayStatus;
  txid?: string;
  paid_at?: number;
  paid_block?: number;
  // true = auto-matched against a synced treasury tx; false/undefined = marked by hand.
  reconciled?: boolean;
}
