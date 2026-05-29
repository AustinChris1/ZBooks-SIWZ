import { SignInPanel } from "@/components/SignInPanel";

export default function HomePage() {
  return (
    <div className="flex flex-col gap-14">
      <section className="flex flex-col gap-4 max-w-2xl">
        <div className="inline-flex items-center gap-2 text-xs uppercase tracking-wider text-neutral-500">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-zcash-yellow" aria-hidden />
          Built for ZEC-paid teams
        </div>
        <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight leading-[1.05]">
          The accounting tool ZEC teams have been{" "}
          <span className="text-zcash-yellow">avoiding spreadsheets</span> to build.
        </h1>
        <p className="text-lg text-neutral-600 dark:text-neutral-300 leading-relaxed">
          DAOs, grant recipients and contractor teams paid in Zcash keep
          pasting txids into Google Sheets every quarter. ZBooks does
          that for them: paste a viewing key, get categorised
          transactions and a P&amp;L your accountant recognises. When payday
          comes, it pays the whole team in one batch.
        </p>
        <p className="text-sm text-neutral-500">
          Non-custodial by design. ZBooks reads your books and builds the
          payout, but the treasurer signs in their own wallet, so your spending
          key never leaves it. Sign in via{" "}
          <strong className="text-neutral-700 dark:text-neutral-300">Sign in with Zcash</strong>.
          Multi-user roles built in.
        </p>
      </section>

      <section>
        <SignInPanel />
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Card
          title="Bring your own viewing keys"
          body="Paste one or more UFVKs. ZBooks gets read-only access; your spending key never leaves the wallet."
        />
        <Card
          title="Pay everyone in one batch"
          body="Build a payout run from completed work and settle it in one transaction: one scan, one confirmation. The treasurer signs in their own wallet, and ZBooks reconciles each payment back to its line."
        />
        <Card
          title="Reports your accountant recognises"
          body="Monthly P&L, contractor totals, and a CSV export shaped for QuickBooks and Xero. Reconciled payouts post themselves."
        />
        <Card
          title="Memos become categories"
          body="Shielded memos arrive as the first draft of every transaction's notes. The treasurer reviews, everyone else can just read."
        />
        <Card
          title="Roles, not seats"
          body="Admin sets policy, treasurer tags and pays, viewer reads. Onboarding a new finance contractor is one sign-in."
        />
        <Card
          title="Self-hostable on a $3 VPS"
          body="The shielded sync runs on a tiny zingo-cli lite wallet, not a 300 GB full node. Front-end deploys to Vercel."
        />
      </section>
    </div>
  );
}

function Card({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/40 p-5 hover:border-neutral-300 dark:hover:border-neutral-700 transition-colors">
      <div className="font-semibold tracking-tight">{title}</div>
      <div className="text-sm text-neutral-600 dark:text-neutral-400 mt-1.5 leading-relaxed">{body}</div>
    </div>
  );
}
