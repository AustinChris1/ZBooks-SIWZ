# ZBooks payouts: pay your contributors, non-custodially

ZBooks started as read-only accounting: paste a viewing key, get a P&L. Payouts
close the other half of the loop, paying the contributors you already track,
without ZBooks ever holding a spending key.

The model in one line: ZBooks initiates and reconciles payments, it never
custodies or sends them. The treasurer signs in their own wallet.

This closes a useful loop for a small ZEC-paid team. It is not a full
finance suite (see Limits below).

## Why not just let ZBooks send the money?

A viewing key (UFVK) is read-only. It can see the treasury and propose a spend,
but it cannot authorize one. That is the whole non-custodial promise, so we keep
it. Three ways to "pay from ZBooks" exist; we picked the safest that ships today:

| Approach | One-click? | Custody | Status |
|---|---|---|---|
| **A. ZBooks holds the spending key** | yes | ZBooks custodies the treasury | rejected: breaks the thesis, and it is money-transmission territory |
| **B. ZBooks builds a PCZT, treasurer signs** | yes | none (ZBooks builds, wallet signs) | roadmap: needs `webzjs-wallet` WASM or snap `signPczt` |
| **C. ZBooks emits a ZIP 321 payment request** | scan | none | shipped: works with every wallet, no WASM |

We ship **C** now and keep **B** on the roadmap. When the snap's `signPczt` (or a
published in-browser wallet lib) lands, ZBooks builds the transaction itself and
the treasurer just approves, which also removes the wallet caveat below.

## The batch is the point

A naive payout pays contributors one at a time. On Zcash that hurts: every
shielded send returns its change as a new note that is not spendable until it
confirms (a few blocks, roughly minutes). Pay 10 people sequentially and each
send waits on the previous one's change note. That is the multi-minute stall you
feel testing repeated sends.

A batch is a single transaction with many outputs. It selects inputs once, pays
everyone, and produces one change note, so there is one confirmation wait. For a
weekly payout run you pay once and move on. ZBooks encodes the whole run as one
multi-recipient ZIP 321 URI ([`buildZip321Multi`](../packages/siwz-core/src/zip321.ts)):

```
zcash:?address=<a0>&amount=<v0>&memo=<m0>&address.1=<a1>&amount.1=<v1>&...
```

Shielded outputs do not leak who got what to outside observers, so batching costs
no privacy. Each recipient only ever sees their own note.

## Wallet requirement

ZIP 321 the spec supports multiple payments, but whether a wallet executes a
multi-payment URI as one multi-output transaction is wallet-dependent:

- **YWallet**: multi-recipient send. Works.
- **Zingo** (mobile and `zingo-cli send`): multi-recipient. Works.
- **Zashi**: single-recipient ZIP 321 as of mid-2026 ([issue #43](https://github.com/Electric-Coin-Company/zashi-android)). A batch URI degrades to paying only the first line, which reintroduces the sequential-send stall.

Pay the treasury from a multi-recipient wallet (YWallet or Zingo). The Pay dialog
says this inline. Roadmap option B removes this constraint entirely.

## The flow

1. **Payees**: save a contributor once (name and Zcash address). Use a unified or
   Sapling address to carry a memo with the payment.
2. **Run**: create a payout run; pick the treasury key it pays from (the UFVK
   ZBooks watches to reconcile).
3. **Line items**: add `(payee, amount, memo)`. Each has a *work status*
   (`in_progress` or `completed`) and a *pay status* (`unpaid` or `paid`). Only
   completed, unpaid items enter the batch; in-progress work is left out.
4. **Pre-flight**: before generating the QR, ZBooks checks the treasury's
   spendable balance against `total + estimated ZIP 317 fee`. It refuses to
   present a batch the treasury cannot cover.
5. **Pay**: scan the single QR (or copy the URI, or open in wallet), approve in
   the wallet.
6. **Reconcile**: ZBooks re-syncs the treasury, finds the outgoing tx, matches
   each output (address and amount) back to its line item, and flips it `paid`
   with the txid. Unmatched lines stay pending. Treasurers can also paste a txid
   to settle a line by hand.
7. **Accounting**: a reconciled payout auto-tags as a `contractor` expense and
   labels the counterparty from the payee, so the run posts straight into the P&L.

Documented, initiated, paid, reconciled, in one tool.

## Treasury balance

Reconciliation and pre-flight both need the treasury's balance. The
[`lightwallet-rpc` wrapper](../apps/lightwallet-rpc/src/server.mjs) exposes
`POST /balance` (alongside `/memos` and `/transactions`); it shells out to
`zingo-cli balance` and returns total plus spendable (spendable excludes
unconfirmed change, per the [ZIP 315](https://zips.z.cash/zip-0315) UX
convention). In `SIWZ_DEMO=1` the mock explorer returns a synthetic balance so
the pre-flight panel has something to show.

A full viewing key sees both incoming and outgoing notes, so the treasury shows
up in ZBooks as a fully-audited account (grants in, payouts out, running balance)
with no spending key anywhere near the server.

## Limits

What this does not do yet, so the home copy does not oversell it:

- **Multisig and governance treasuries.** The batch is one URI signed by one
  treasurer in one wallet. A DAO with a 2-of-3 / FROST treasury or an on-chain
  approval step is not handled.
- **Fiat valuation, cost basis, capital gains.** The P&L is ZEC-denominated.
  Tax-ready fiat books need per-tx valuation and gain/loss lots.
- **Recurring automation.** A run is created by hand each cycle. No schedules,
  withholding, invoices, or contributor self-service.

## Surface area

- UI: [`/payouts`](../apps/demo/src/app/payouts/page.tsx) (runs and payees) and
  [`/payouts/[id]`](../apps/demo/src/app/payouts/[id]/PayoutRunDetail.tsx) (run detail, batch QR, reconcile).
  Admin and treasurer only; viewers are redirected and the nav link is hidden, since payouts expose the
  payee address book and amounts.
- Lib: [`payouts.ts`](../apps/demo/src/lib/payouts.ts) (URI build, ZIP 317 fee, pre-flight); reconciliation in [`db.ts`](../apps/demo/src/lib/db.ts).
- API: `POST/GET /api/payees`, `/api/payouts`, `/api/payouts/[id]/items`, `/api/payouts/[id]/qr`, `/api/payouts/[id]/reconcile`.
- Regression test: `node scripts/e2e-payouts.mjs` against a `SIWZ_DEMO=1` server.

## Roadmap

- **PCZT one-click (option B).** Build the transaction in ZBooks from the viewing
  key, hand the unsigned PCZT to the treasurer's wallet (snap `signPczt`, or an
  in-browser wallet lib) to sign and broadcast. Removes the multi-recipient
  wallet requirement.
- **Per-row "Pay this one" QR.** A single-recipient fallback for treasurers stuck
  on a single-recipient wallet.
- **Dework / CSV import.** Pull completed tasks straight into a run.
