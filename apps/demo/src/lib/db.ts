import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  CATEGORY_LABEL,
  type Category,
  type Counterparty,
  type PayStatus,
  type Payee,
  type PayoutLineItem,
  type PayoutRun,
  type PayoutRunStatus,
  type Role,
  type SyncStatus,
  type TeamMember,
  type Transaction,
  type Ufvk,
  type WorkStatus,
} from "./types";

// JSON file store. Types + CATEGORY_LABEL live in ./types so client
// components can import them without dragging node:fs into the bundle.
export { CATEGORY_LABEL };
export type {
  Category,
  Counterparty,
  PayStatus,
  Payee,
  PayoutLineItem,
  PayoutRun,
  PayoutRunStatus,
  Role,
  SyncStatus,
  TeamMember,
  Transaction,
  Ufvk,
  WorkStatus,
};

const DATA_DIR = join(process.cwd(), "data");
const DB_PATH = process.env.DATA_PATH ?? join(DATA_DIR, "zbooks.json");

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

interface FileShape {
  ufvks: Ufvk[];
  transactions: Transaction[];
  team: TeamMember[];
  counterparties: Counterparty[];
  payees: Payee[];
  payout_runs: PayoutRun[];
  payout_items: PayoutLineItem[];
}

const EMPTY: FileShape = {
  ufvks: [],
  transactions: [],
  team: [],
  counterparties: [],
  payees: [],
  payout_runs: [],
  payout_items: [],
};

function read(): FileShape {
  if (!existsSync(DB_PATH)) return structuredClone(EMPTY);
  try {
    const parsed = JSON.parse(readFileSync(DB_PATH, "utf8")) as Partial<FileShape>;
    return {
      ufvks: (parsed.ufvks ?? []).map((k) => ({
        ...k,
        sync_status: (k.sync_status ?? "idle") as SyncStatus,
      })),
      transactions: parsed.transactions ?? [],
      team: parsed.team ?? [],
      counterparties: parsed.counterparties ?? [],
      payees: parsed.payees ?? [],
      payout_runs: parsed.payout_runs ?? [],
      payout_items: parsed.payout_items ?? [],
    };
  } catch {
    return structuredClone(EMPTY);
  }
}

function write(state: FileShape): void {
  // Atomic-ish: write to a tmp file then rename.
  const tmp = `${DB_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
  renameSync(tmp, DB_PATH);
}

// First address to sign in is promoted to admin so a fresh deploy has someone who can manage the team.
export function ensureMember(address: string): Role {
  const state = read();
  const existing = state.team.find((m) => m.address === address);
  if (existing) return existing.role;
  const role: Role = state.team.length === 0 ? "admin" : "viewer";
  state.team.push({
    address,
    role,
    added_by: state.team.length === 0 ? "self" : "auto",
    added_at: Date.now(),
  });
  write(state);
  return role;
}

export function getMember(address: string): TeamMember | undefined {
  return read().team.find((m) => m.address === address);
}

export function listMembers(): TeamMember[] {
  return [...read().team].sort((a, b) => a.added_at - b.added_at);
}

export function setRole(address: string, role: Role): void {
  const state = read();
  const m = state.team.find((x) => x.address === address);
  if (!m) throw new Error(`Address not in team: ${address}`);
  m.role = role;
  write(state);
}

export function addTeamMember(address: string, role: Role, addedBy: string): TeamMember {
  const state = read();
  if (state.team.some((m) => m.address === address)) {
    throw new Error("Address already on team");
  }
  const m: TeamMember = { address, role, added_by: addedBy, added_at: Date.now() };
  state.team.push(m);
  write(state);
  return m;
}

export function removeMember(address: string): void {
  const state = read();
  state.team = state.team.filter((m) => m.address !== address);
  write(state);
}

export function listKeys(): Ufvk[] {
  return [...read().ufvks].sort((a, b) => a.created_at - b.created_at);
}

export function addKey(input: {
  owner: string;
  label: string;
  ufvk: string;
  birthday?: number;
}): Ufvk {
  const state = read();
  const id = randomUUID();
  const key: Ufvk = {
    id,
    owner: input.owner,
    label: input.label.trim() || "Untitled key",
    ufvk: input.ufvk.trim(),
    primary: state.ufvks.length === 0,
    created_at: Date.now(),
    sync_status: "idle",
    ...(Number.isFinite(input.birthday) ? { birthday: input.birthday } : {}),
  };
  state.ufvks.push(key);
  write(state);
  return key;
}

export function getKey(id: string): Ufvk | undefined {
  return read().ufvks.find((k) => k.id === id);
}

export function updateKeySyncStatus(
  id: string,
  patch: Partial<Pick<Ufvk, "sync_status" | "last_synced_at" | "last_synced_block" | "last_sync_error" | "last_tx_count" | "last_chain_tip" | "wallet_birthday">>,
): void {
  const state = read();
  const k = state.ufvks.find((x) => x.id === id);
  if (!k) return;
  Object.assign(k, patch);
  write(state);
}

export function removeKey(id: string): void {
  const state = read();
  state.ufvks = state.ufvks.filter((k) => k.id !== id);
  state.transactions = state.transactions.filter((t) => t.ufvk_id !== id);
  write(state);
}

export function setPrimaryKey(id: string): void {
  const state = read();
  for (const k of state.ufvks) k.primary = k.id === id;
  write(state);
}

export function listTransactions(): Transaction[] {
  return [...read().transactions].sort((a, b) => b.timestamp - a.timestamp);
}

export function tagTransaction(id: string, input: {
  tag?: Category;
  notes?: string;
  taggedBy: string;
}): Transaction {
  const state = read();
  const t = state.transactions.find((x) => x.id === id);
  if (!t) throw new Error(`No such transaction: ${id}`);
  if (input.tag !== undefined) t.tag = input.tag;
  if (input.notes !== undefined) t.notes = input.notes;
  t.tagged_by = input.taggedBy;
  t.tagged_at = Date.now();
  write(state);
  return t;
}

// Existing rows keep their tag / notes / id so a re-sync doesn't clobber user-applied categorisation.
export function upsertTransactions(
  ufvkId: string,
  incoming: Array<{
    txid: string;
    direction: "in" | "out";
    amount_zec: number;
    counterparty?: string;
    memo?: string;
    timestamp: number;
    block_height?: number;
  }>,
): { inserted: number; updated: number } {
  const state = read();
  let inserted = 0;
  let updated = 0;
  for (const incoming_tx of incoming) {
    const existing = state.transactions.find(
      (t) => t.ufvk_id === ufvkId && t.txid === incoming_tx.txid,
    );
    if (existing) {
      existing.direction = incoming_tx.direction;
      existing.amount_zec = incoming_tx.amount_zec;
      existing.timestamp = incoming_tx.timestamp;
      if (incoming_tx.counterparty !== undefined) existing.counterparty = incoming_tx.counterparty;
      if (incoming_tx.memo !== undefined) existing.memo = incoming_tx.memo;
      if (incoming_tx.block_height !== undefined) existing.block_height = incoming_tx.block_height;
      updated++;
    } else {
      state.transactions.push({
        id: randomUUID(),
        ufvk_id: ufvkId,
        ...incoming_tx,
      });
      inserted++;
    }
  }
  write(state);
  return { inserted, updated };
}

export function listCounterparties(): Counterparty[] {
  return [...read().counterparties].sort((a, b) => a.label.localeCompare(b.label));
}

export function getCounterparty(address: string): Counterparty | undefined {
  return read().counterparties.find((c) => c.address === address);
}

// Empty label removes the mapping.
export function upsertCounterparty(input: {
  address: string;
  label: string;
  notes?: string;
  by: string;
}): Counterparty | null {
  const state = read();
  const address = input.address.trim();
  const label = input.label.trim();
  if (!address) throw new Error("address required");

  const idx = state.counterparties.findIndex((c) => c.address === address);
  if (!label) {
    if (idx >= 0) {
      state.counterparties.splice(idx, 1);
      write(state);
    }
    return null;
  }

  if (idx >= 0) {
    const existing = state.counterparties[idx];
    existing.label = label;
    if (input.notes !== undefined) existing.notes = input.notes || undefined;
    existing.updated_at = Date.now();
    write(state);
    return existing;
  }

  const made: Counterparty = {
    address,
    label,
    notes: input.notes?.trim() || undefined,
    added_by: input.by,
    added_at: Date.now(),
  };
  state.counterparties.push(made);
  write(state);
  return made;
}

export function counterpartyLabelMap(): Map<string, string> {
  return new Map(read().counterparties.map((c) => [c.address, c.label]));
}

// ---- Payees -----------------------------------------------------------------

export function listPayees(includeArchived = false): Payee[] {
  return read()
    .payees.filter((p) => includeArchived || !p.archived)
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function getPayee(id: string): Payee | undefined {
  return read().payees.find((p) => p.id === id);
}

export function addPayee(input: {
  label: string;
  address: string;
  notes?: string;
  by: string;
}): Payee {
  const state = read();
  const address = input.address.trim();
  const label = input.label.trim();
  if (!address) throw new Error("address required");
  if (!label) throw new Error("label required");
  if (state.payees.some((p) => p.address === address && !p.archived)) {
    throw new Error("A payee with that address already exists");
  }
  const payee: Payee = {
    id: randomUUID(),
    label,
    address,
    notes: input.notes?.trim() || undefined,
    added_by: input.by,
    added_at: Date.now(),
  };
  state.payees.push(payee);
  write(state);
  return payee;
}

export function updatePayee(
  id: string,
  patch: Partial<Pick<Payee, "label" | "address" | "notes" | "archived">>,
): Payee {
  const state = read();
  const p = state.payees.find((x) => x.id === id);
  if (!p) throw new Error(`No such payee: ${id}`);
  if (patch.label !== undefined) p.label = patch.label.trim() || p.label;
  if (patch.address !== undefined) p.address = patch.address.trim() || p.address;
  if (patch.notes !== undefined) p.notes = patch.notes.trim() || undefined;
  if (patch.archived !== undefined) p.archived = patch.archived;
  write(state);
  return p;
}

// ---- Payout runs ------------------------------------------------------------

export interface RunWithItems extends PayoutRun {
  items: PayoutLineItem[];
}

export function listRuns(): RunWithItems[] {
  const state = read();
  return [...state.payout_runs]
    .sort((a, b) => b.created_at - a.created_at)
    .map((r) => ({ ...r, items: state.payout_items.filter((i) => i.run_id === r.id) }));
}

export function getRun(id: string): RunWithItems | undefined {
  const state = read();
  const run = state.payout_runs.find((r) => r.id === id);
  if (!run) return undefined;
  return { ...run, items: state.payout_items.filter((i) => i.run_id === id) };
}

export function createRun(input: {
  title: string;
  sourceUfvkId?: string;
  note?: string;
  by: string;
}): PayoutRun {
  const state = read();
  const run: PayoutRun = {
    id: randomUUID(),
    title: input.title.trim() || "Untitled run",
    source_ufvk_id: input.sourceUfvkId,
    created_by: input.by,
    created_at: Date.now(),
    status: "draft",
    note: input.note?.trim() || undefined,
  };
  state.payout_runs.push(run);
  write(state);
  return run;
}

export function updateRun(
  id: string,
  patch: Partial<Pick<PayoutRun, "title" | "source_ufvk_id" | "note" | "status" | "sent_at">>,
): PayoutRun {
  const state = read();
  const r = state.payout_runs.find((x) => x.id === id);
  if (!r) throw new Error(`No such run: ${id}`);
  Object.assign(r, patch);
  write(state);
  return r;
}

export function setRunStatus(id: string, status: PayoutRunStatus): PayoutRun {
  const patch: Partial<PayoutRun> = { status };
  if (status === "sent") patch.sent_at = Date.now();
  return updateRun(id, patch);
}

export function removeRun(id: string): void {
  const state = read();
  state.payout_runs = state.payout_runs.filter((r) => r.id !== id);
  state.payout_items = state.payout_items.filter((i) => i.run_id !== id);
  write(state);
}

// ---- Line items -------------------------------------------------------------

export function addLineItem(
  runId: string,
  input: {
    payeeId?: string;
    label: string;
    address: string;
    amountZec: number;
    memo?: string;
    workStatus?: WorkStatus;
  },
): PayoutLineItem {
  const state = read();
  if (!state.payout_runs.some((r) => r.id === runId)) {
    throw new Error(`No such run: ${runId}`);
  }
  const item: PayoutLineItem = {
    id: randomUUID(),
    run_id: runId,
    payee_id: input.payeeId,
    label: input.label.trim() || "Unnamed",
    address: input.address.trim(),
    amount_zec: input.amountZec,
    memo: input.memo?.trim() || undefined,
    work_status: input.workStatus ?? "in_progress",
    pay_status: "unpaid",
  };
  if (!item.address) throw new Error("address required");
  if (!(item.amount_zec > 0)) throw new Error("amount must be positive");
  state.payout_items.push(item);
  write(state);
  return item;
}

export function updateLineItem(
  itemId: string,
  patch: Partial<Pick<PayoutLineItem, "label" | "address" | "amount_zec" | "memo" | "work_status">>,
): PayoutLineItem {
  const state = read();
  const item = state.payout_items.find((i) => i.id === itemId);
  if (!item) throw new Error(`No such line item: ${itemId}`);
  if (patch.label !== undefined) item.label = patch.label.trim() || item.label;
  if (patch.address !== undefined) item.address = patch.address.trim() || item.address;
  if (patch.amount_zec !== undefined) {
    if (!(patch.amount_zec > 0)) throw new Error("amount must be positive");
    item.amount_zec = patch.amount_zec;
  }
  if (patch.memo !== undefined) item.memo = patch.memo.trim() || undefined;
  if (patch.work_status !== undefined) item.work_status = patch.work_status;
  write(state);
  return item;
}

export function removeLineItem(itemId: string): void {
  const state = read();
  state.payout_items = state.payout_items.filter((i) => i.id !== itemId);
  write(state);
}

// Manual settlement: treasurer pastes the txid after paying in their wallet.
export function markLineItemPaid(
  itemId: string,
  input: { txid?: string; blockHeight?: number; reconciled?: boolean },
): PayoutLineItem {
  const state = read();
  const item = state.payout_items.find((i) => i.id === itemId);
  if (!item) throw new Error(`No such line item: ${itemId}`);
  item.pay_status = "paid";
  item.txid = input.txid?.trim() || item.txid;
  item.paid_at = Date.now();
  if (input.blockHeight !== undefined) item.paid_block = input.blockHeight;
  item.reconciled = input.reconciled ?? false;
  write(state);
  return item;
}

export function setLineItemPayStatus(itemId: string, status: PayStatus): PayoutLineItem {
  const state = read();
  const item = state.payout_items.find((i) => i.id === itemId);
  if (!item) throw new Error(`No such line item: ${itemId}`);
  item.pay_status = status;
  if (status === "unpaid") {
    item.txid = undefined;
    item.paid_at = undefined;
    item.paid_block = undefined;
    item.reconciled = undefined;
  }
  write(state);
  return item;
}

// Match unpaid completed items against the treasury's synced OUT txs by
// recipient address + amount. Each synced tx settles at most one line.
export function reconcileRun(runId: string): { matched: number; items: PayoutLineItem[] } {
  const state = read();
  const run = state.payout_runs.find((r) => r.id === runId);
  if (!run) throw new Error(`No such run: ${runId}`);

  const outTxs = state.transactions.filter(
    (t) =>
      t.direction === "out" &&
      (!run.source_ufvk_id || t.ufvk_id === run.source_ufvk_id),
  );
  const usedTxKeys = new Set(
    state.payout_items.filter((i) => i.txid).map((i) => `${i.txid}:${i.address}`),
  );

  let matched = 0;
  const touched: PayoutLineItem[] = [];
  for (const item of state.payout_items) {
    if (item.run_id !== runId) continue;
    if (item.pay_status === "paid") continue;
    if (item.work_status !== "completed") continue;

    const hit = outTxs.find((t) => {
      if (!t.counterparty || t.counterparty !== item.address) return false;
      if (Math.abs(Math.abs(t.amount_zec) - item.amount_zec) > 1e-8) return false;
      return !usedTxKeys.has(`${t.txid}:${item.address}`);
    });
    if (!hit) continue;

    item.pay_status = "paid";
    item.txid = hit.txid;
    item.paid_at = Date.now();
    item.paid_block = hit.block_height;
    item.reconciled = true;
    usedTxKeys.add(`${hit.txid}:${item.address}`);
    matched++;
    touched.push(item);

    // Close the accounting loop: an unclassified matched payout is a
    // contractor expense, and the recipient gets the payee's friendly label.
    const tx = state.transactions.find((t) => t.id === hit.id);
    if (tx && !tx.tag) {
      tx.tag = "contractor";
      tx.tagged_by = "payout-reconcile";
      tx.tagged_at = Date.now();
    }
    if (!state.counterparties.some((c) => c.address === item.address)) {
      state.counterparties.push({
        address: item.address,
        label: item.label,
        added_by: "payout-reconcile",
        added_at: Date.now(),
      });
    }
  }

  if (matched > 0) {
    if (run.status === "sent" && state.payout_items.filter((i) => i.run_id === runId && i.work_status === "completed").every((i) => i.pay_status === "paid")) {
      run.status = "reconciled";
    }
    write(state);
  }
  return { matched, items: touched };
}
