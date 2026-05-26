import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { SEED_TRANSACTIONS } from "./seed";

/**
 * Tiny JSON-file store for ZBooks. Replace with Postgres in production —
 * the API here is deliberately small (one record-type per collection) so
 * swapping it is mechanical.
 *
 * Atomic-ish write: write to a tmp file then rename. Same-directory rename
 * on NTFS doesn't expose a partial file to concurrent readers.
 */

const DATA_DIR = join(process.cwd(), "data");
const DB_PATH = process.env.DATA_PATH ?? join(DATA_DIR, "zbooks.json");

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

// ---------- types ----------

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

export interface Ufvk {
  id: string;
  owner: string;     // address that added it
  label: string;
  ufvk: string;
  primary: boolean;
  created_at: number;
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

interface FileShape {
  ufvks: Ufvk[];
  transactions: Transaction[];
  team: TeamMember[];
  _seeded: boolean;
}

// ---------- read/write ----------

const EMPTY: FileShape = { ufvks: [], transactions: [], team: [], _seeded: false };

function read(): FileShape {
  if (!existsSync(DB_PATH)) return { ...EMPTY };
  try {
    const parsed = JSON.parse(readFileSync(DB_PATH, "utf8")) as Partial<FileShape>;
    return {
      ufvks: parsed.ufvks ?? [],
      transactions: parsed.transactions ?? [],
      team: parsed.team ?? [],
      _seeded: parsed._seeded ?? false,
    };
  } catch {
    return { ...EMPTY };
  }
}

function write(state: FileShape): void {
  const tmp = `${DB_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
  renameSync(tmp, DB_PATH);
}

// ---------- team / roles ----------

/**
 * Ensures the signing-in address is recorded in the team table. The first
 * address ever to sign in is promoted to admin automatically (bootstrap).
 * Returns the resulting role.
 */
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

// ---------- ufvks ----------

export function listKeys(): Ufvk[] {
  return [...read().ufvks].sort((a, b) => a.created_at - b.created_at);
}

export function addKey(input: { owner: string; label: string; ufvk: string }): Ufvk {
  const state = read();
  const id = randomUUID();
  const key: Ufvk = {
    id,
    owner: input.owner,
    label: input.label.trim() || "Untitled key",
    ufvk: input.ufvk.trim(),
    primary: state.ufvks.length === 0,
    created_at: Date.now(),
  };
  state.ufvks.push(key);

  // Seed sample transactions for the first key so the demo has something
  // to show without lightwalletd integration.
  if (!state._seeded) {
    const now = Date.now();
    for (const t of SEED_TRANSACTIONS) {
      state.transactions.push({
        ...t,
        id: randomUUID(),
        ufvk_id: id,
        timestamp: now - t.relativeAgeMs,
        // strip the relativeAgeMs synthetic field
        ...{ relativeAgeMs: undefined as unknown as number },
      } as Transaction);
    }
    state._seeded = true;
  }
  write(state);
  return key;
}

export function removeKey(id: string): void {
  const state = read();
  state.ufvks = state.ufvks.filter((k) => k.id !== id);
  // Cascade-delete the transactions belonging to this key.
  state.transactions = state.transactions.filter((t) => t.ufvk_id !== id);
  write(state);
}

export function setPrimaryKey(id: string): void {
  const state = read();
  for (const k of state.ufvks) k.primary = k.id === id;
  write(state);
}

// ---------- transactions ----------

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
