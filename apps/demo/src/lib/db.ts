import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  CATEGORY_LABEL,
  type Category,
  type Counterparty,
  type Role,
  type SyncStatus,
  type TeamMember,
  type Transaction,
  type Ufvk,
} from "./types";

// JSON file store. Types + CATEGORY_LABEL live in ./types so client
// components can import them without dragging node:fs into the bundle.
export { CATEGORY_LABEL };
export type {
  Category,
  Counterparty,
  Role,
  SyncStatus,
  TeamMember,
  Transaction,
  Ufvk,
};

const DATA_DIR = join(process.cwd(), "data");
const DB_PATH = process.env.DATA_PATH ?? join(DATA_DIR, "zbooks.json");

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

interface FileShape {
  ufvks: Ufvk[];
  transactions: Transaction[];
  team: TeamMember[];
  counterparties: Counterparty[];
}

const EMPTY: FileShape = { ufvks: [], transactions: [], team: [], counterparties: [] };

function read(): FileShape {
  if (!existsSync(DB_PATH)) return { ...EMPTY };
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
    };
  } catch {
    return { ...EMPTY };
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
