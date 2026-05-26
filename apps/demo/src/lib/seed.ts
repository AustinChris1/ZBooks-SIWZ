import type { Transaction } from "./db";

/**
 * Sample shielded transactions used to populate ZBooks the first time
 * a viewing key is added. These mimic the shape of real data a
 * lightwalletd sync would produce so the UI feels real.
 *
 * `relativeAgeMs` is the number of milliseconds before "now" the tx
 * happened — the loader converts it to an absolute timestamp when
 * inserting so the dates always look recent.
 */
export type SeedTx = Omit<Transaction, "id" | "ufvk_id" | "timestamp"> & {
  relativeAgeMs: number;
};

const DAY = 24 * 60 * 60 * 1000;

export const SEED_TRANSACTIONS: SeedTx[] = [
  {
    txid: "f3a1c2d4e5f6789a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a",
    direction: "in",
    amount_zec: 12500,
    counterparty: "u1grantsource…rotreg6",
    memo: "Q2 2026 grant — community education program",
    block_height: 2_750_120,
    relativeAgeMs: 28 * DAY,
  },
  {
    txid: "a4b5c6d7e8f90a1b2c3d4e5f607182930a4b5c6d7e8f90a1b2c3d4e5f6071829",
    direction: "out",
    amount_zec: -2500,
    counterparty: "u1contractorAnnabel…fk21x",
    memo: "May invoice — content writing (4 articles)",
    block_height: 2_751_402,
    relativeAgeMs: 22 * DAY,
  },
  {
    txid: "b1c2d3e4f5061728394a5b6c7d8e9f0a1b2c3d4e5f061728394a5b6c7d8e9f0a",
    direction: "out",
    amount_zec: -1800,
    counterparty: "u1contractorBoaz…m9p4q",
    memo: "May invoice — design",
    block_height: 2_751_988,
    relativeAgeMs: 20 * DAY,
  },
  {
    txid: "c2d3e4f50617283940a5b6c7d8e9f0a1b2c3d4e5f061728394a5b6c7d8e9f0a1",
    direction: "out",
    amount_zec: -340,
    counterparty: "u1conferenceFee…wp8k",
    memo: "ZconVII conference ticket (D. Patel)",
    block_height: 2_753_201,
    relativeAgeMs: 14 * DAY,
  },
  {
    txid: "d3e4f50617283940a5b6c7d8e9f0a1b2c3d4e5f061728394a5b6c7d8e9f0a1b2",
    direction: "out",
    amount_zec: -120,
    counterparty: "u1saaSToolname…h4j7l",
    memo: "Notion team plan — June",
    block_height: 2_753_990,
    relativeAgeMs: 12 * DAY,
  },
  {
    txid: "e4f50617283940a5b6c7d8e9f0a1b2c3d4e5f061728394a5b6c7d8e9f0a1b2c3",
    direction: "in",
    amount_zec: 75,
    counterparty: "u1eventRefund…q3w2e",
    memo: "Unused conference workshop — refund",
    block_height: 2_754_870,
    relativeAgeMs: 9 * DAY,
  },
  {
    txid: "f50617283940a5b6c7d8e9f0a1b2c3d4e5f061728394a5b6c7d8e9f0a1b2c3d4",
    direction: "out",
    amount_zec: -2200,
    counterparty: "u1contractorAnnabel…fk21x",
    memo: "June invoice — content writing + editing pass",
    block_height: 2_755_510,
    relativeAgeMs: 6 * DAY,
  },
  {
    txid: "a50617283940a5b6c7d8e9f0a1b2c3d4e5f061728394a5b6c7d8e9f0a1b2c3d5",
    direction: "out",
    amount_zec: -50,
    counterparty: "u1domainRegistrar…ee99",
    memo: "Domain renewal — zechub.org",
    block_height: 2_755_820,
    relativeAgeMs: 5 * DAY,
  },
  {
    txid: "b50617283940a5b6c7d8e9f0a1b2c3d4e5f061728394a5b6c7d8e9f0a1b2c3d6",
    direction: "out",
    amount_zec: -800,
    counterparty: "u1internalTreasury…sub4",
    memo: "Internal: ops sub-account top-up",
    block_height: 2_756_001,
    relativeAgeMs: 3 * DAY,
  },
  {
    txid: "c50617283940a5b6c7d8e9f0a1b2c3d4e5f061728394a5b6c7d8e9f0a1b2c3d7",
    direction: "in",
    amount_zec: 50,
    counterparty: "u1communityDonor…xq77",
    memo: "Donation — thanks for the wallets explainer!",
    block_height: 2_756_180,
    relativeAgeMs: 2 * DAY,
  },
];
