// Pulls bounty data from zechub.zone (zec-bounties' Express backend).
// Public API, no auth required.

const DEFAULT_API = "https://zechub.zone";

const API_BASE = (process.env.ZEC_BOUNTIES_API_URL ?? DEFAULT_API).replace(/\/$/, "");

export type ZecBountyStatus = "TO_DO" | "IN_PROGRESS" | "IN_REVIEW" | "DONE" | "CANCELLED";

export interface ZecBountyUser {
  id?: string;
  name?: string;
  email?: string | null;
  avatar?: string | null;
  z_address?: string | null;
  role?: string | null;
}

export interface ZecBounty {
  id: string;
  title: string;
  description: string;
  bountyAmount: number;
  dateCreated: string;
  timeToComplete?: string;
  status: ZecBountyStatus;
  isApproved: boolean;
  isPaid: boolean;
  paymentAuthorized?: boolean;
  paidAt?: string | null;
  categoryId?: string | null;
  difficulty?: "EASY" | "MEDIUM" | "HARD";
  assigneeUser?: ZecBountyUser | null;
  createdByUser?: ZecBountyUser | null;
}

interface BountiesResponse {
  data: ZecBounty[];
  total?: number;
  page?: number;
  limit?: number;
}

export class ZecBountiesError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "ZecBountiesError";
    this.status = status;
  }
}

/** Fetch all bounties from zec-bounties, paging until exhausted. */
export async function fetchAllBounties(): Promise<ZecBounty[]> {
  const all: ZecBounty[] = [];
  let page = 1;
  const limit = 100;
  for (;;) {
    const res = await fetch(`${API_BASE}/api/bounties?page=${page}&limit=${limit}`, {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) {
      throw new ZecBountiesError(`zec-bounties returned ${res.status}`, res.status);
    }
    const json = (await res.json()) as BountiesResponse;
    all.push(...(json.data ?? []));
    const total = json.total ?? all.length;
    if (all.length >= total || (json.data ?? []).length === 0) break;
    page += 1;
    // Safety: zec-bounties shouldn't have >5000 bounties; cap to avoid runaways.
    if (page > 50) break;
  }
  return all;
}

/** IN_PROGRESS + IN_REVIEW bounties are scheduling targets; TO_DO is unapproved,
 *  DONE is ZecHub-paid. See docs/zbooks-payouts.md for the full mapping. */
export function filterPayableBounties(bounties: ZecBounty[]): ZecBounty[] {
  return bounties.filter(
    (b) =>
      (b.status === "IN_PROGRESS" || b.status === "IN_REVIEW") &&
      b.isApproved &&
      !b.isPaid &&
      !!b.assigneeUser?.z_address &&
      b.bountyAmount > 0,
  );
}

export type ZcashNetwork = "mainnet" | "testnet" | "regtest" | "unknown";

/** Detect network from a Zcash address prefix (UA, sapling, transparent). */
export function detectAddressNetwork(address: string): ZcashNetwork {
  if (!address) return "unknown";
  const a = address.trim();
  // Unified addresses
  if (a.startsWith("u1")) return "mainnet";
  if (a.startsWith("utest1")) return "testnet";
  if (a.startsWith("uregtest1")) return "regtest";
  // Sapling shielded
  if (a.startsWith("zs1")) return "mainnet";
  if (a.startsWith("ztestsapling1")) return "testnet";
  if (a.startsWith("zregtestsapling1")) return "regtest";
  // Transparent P2PKH / P2SH
  if (a.startsWith("t1") || a.startsWith("t3")) return "mainnet";
  if (a.startsWith("tm") || a.startsWith("t2")) return "testnet";
  return "unknown";
}

export type BountyBlockReason =
  | "payable"
  | "no_assignee"
  | "no_address"
  | "amount_zero"
  | "in_progress"
  | "not_approved"
  | "cancelled"
  | "already_paid"
  | "address_unknown"
  | "network_mismatch";

export interface BountyImportCandidate {
  bounty: ZecBounty;
  network: ZcashNetwork;
  payable: boolean;
  reason: BountyBlockReason;
  reasonLabel: string;
}

/** Decorate every bounty with the reason it is or isn't importable. */
export function buildImportCandidates(
  bounties: ZecBounty[],
  zbooksNetwork: "mainnet" | "testnet" | "regtest",
): BountyImportCandidate[] {
  return bounties.map((bounty) => {
    const address = bounty.assigneeUser?.z_address ?? "";
    const network = detectAddressNetwork(address);

    // Reason precedence: work state first, then assignee, then network.
    let reason: BountyBlockReason = "payable";
    let reasonLabel = "Ready to pay";

    if (bounty.status === "CANCELLED") {
      reason = "cancelled";
      reasonLabel = "Cancelled upstream";
    } else if (bounty.status === "TO_DO") {
      reason = "in_progress";
      reasonLabel = "TO_DO upstream (not yet started / approved)";
    } else if (bounty.status === "DONE") {
      reason = "already_paid";
      reasonLabel = bounty.isPaid
        ? "Marked paid on zec-bounties"
        : "Marked DONE upstream (payment is being handled there)";
    } else if (!bounty.isApproved) {
      reason = "not_approved";
      reasonLabel = "Not yet approved by reviewer";
    } else if (bounty.isPaid) {
      reason = "already_paid";
      reasonLabel = "Already paid on zec-bounties";
    } else if (!bounty.assigneeUser) {
      reason = "no_assignee";
      reasonLabel = "No assignee set";
    } else if (!address) {
      reason = "no_address";
      reasonLabel = "Assignee has no z_address on file";
    } else if (!(bounty.bountyAmount > 0)) {
      reason = "amount_zero";
      reasonLabel = "Amount is zero";
    } else if (network === "unknown") {
      reason = "address_unknown";
      reasonLabel = "Address prefix not recognised";
    } else if (network !== zbooksNetwork) {
      reason = "network_mismatch";
      reasonLabel = `On ${network}, this ZBooks runs on ${zbooksNetwork}`;
    }

    return {
      bounty,
      network,
      payable: reason === "payable",
      reason,
      reasonLabel,
    };
  });
}

/** Shape a bounty into the fields ZBooks's payout_items table needs. */
export function bountyToPayoutLine(bounty: ZecBounty): {
  label: string;
  address: string;
  amount_zec: number;
  memo: string;
  external_ref: string;
} {
  return {
    label: bounty.assigneeUser?.name
      ? `${bounty.assigneeUser.name}: ${bounty.title}`
      : bounty.title,
    address: bounty.assigneeUser!.z_address!,
    amount_zec: bounty.bountyAmount,
    memo: `zec-bounty: ${bounty.title}`.slice(0, 512),
    external_ref: `zec-bounties:${bounty.id}`,
  };
}
