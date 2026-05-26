import { SignInPanel } from "@/components/SignInPanel";

export default function HomePage() {
  return (
    <div className="flex flex-col gap-12">
      <section className="flex flex-col gap-3 max-w-2xl">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
          <span className="text-zcash-yellow">ZBooks</span> — accounting for teams paid in ZEC
        </h1>
        <p className="text-lg opacity-80">
          DAOs, grant recipients and contractor teams paid in Zcash are
          pasting txids into spreadsheets every quarter. ZBooks is what
          they actually need: paste a viewing key, see your transactions
          tagged and categorized, export reports your accountant
          recognizes.
        </p>
        <p className="text-sm opacity-60">
          Read-only (viewing keys, never spending keys). Non-custodial
          sign-in via <strong>Sign in with Zcash</strong>. Multi-user
          roles built in.
        </p>
      </section>

      <section>
        <SignInPanel />
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card title="Bring your own keys" body="Paste one or more UFVKs. Read-only — your spending keys never leave your wallet." />
        <Card title="Auto-tag from memos" body="Shielded memos become the first draft of every transaction's category. Treasurer reviews, the rest of the team can just read." />
        <Card title="Reports that look like reports" body="Monthly P&L, contractor totals, CSV export your accountant can drop into QuickBooks or Xero." />
        <Card title="Roles, not seats" body="Admin sets policy. Treasurer tags. Viewer reads. Onboard a new finance contractor in one sign-in." />
        <Card title="Non-custodial sign-in" body="No passwords. Sign a SIWZ challenge with the wallet you already use — Zodl, Zingo, YWallet, MetaMask + Zcash Snap." />
        <Card title="Production = serverless" body="No native deps. Drops into Vercel / Cloudflare / Fly. Pair with Postgres when you outgrow the JSON store." />
      </section>

      <section className="rounded-lg border border-black/10 dark:border-white/10 p-5 bg-black/[0.02] dark:bg-white/[0.02]">
        <div className="font-semibold mb-2">Hackathon disclosure</div>
        <p className="text-sm opacity-80">
          ZBooks is a v0.1 reference implementation. The lightwalletd-based
          sync (UFVK → real on-chain transactions) is stubbed with seeded
          sample data so the rest of the UI/UX flow is fully exercisable
          without a Zcash full node. Wiring that in is one swap of the
          stub in <code className="font-mono">src/lib/db.ts</code>.
        </p>
      </section>
    </div>
  );
}

function Card({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-black/10 dark:border-white/10 p-4">
      <div className="font-semibold">{title}</div>
      <div className="text-sm opacity-80 mt-1">{body}</div>
    </div>
  );
}
