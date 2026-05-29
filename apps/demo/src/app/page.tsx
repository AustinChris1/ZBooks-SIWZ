"use client";

import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { SignInPanel } from "@/components/SignInPanel";

const features = [
  {
    title: "Bring your own viewing keys",
    body: "Paste one or more UFVKs. ZBooks gets read-only access; your spending key never leaves the wallet.",
    icon: <KeyIcon />,
  },
  {
    title: "Pay everyone in one batch",
    body: "Build a payout run from completed work and settle it in one transaction. The treasurer signs in their own wallet, and ZBooks reconciles each payment back to its line.",
    icon: <SendIcon />,
  },
  {
    title: "Reports your accountant recognises",
    body: "Monthly P&L, contractor totals, and a CSV export shaped for QuickBooks and Xero. Reconciled payouts post themselves.",
    icon: <ChartIcon />,
  },
  {
    title: "Memos become categories",
    body: "Shielded memos arrive as the first draft of every transaction's notes. The treasurer reviews, everyone else can just read.",
    icon: <TagIcon />,
  },
  {
    title: "Roles, not seats",
    body: "Admin sets policy, treasurer tags and pays, viewer reads. Onboarding a new finance contractor is one sign-in.",
    icon: <UsersIcon />,
  },
  {
    title: "Shielded by default",
    body: "Sign-in and balance sync ride encrypted Zcash memos, so amounts and counterparties stay off the public ledger.",
    icon: <ShieldIcon />,
  },
];

const stagger = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
};
const rise = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.21, 0.5, 0.3, 1] } },
};

export default function HomePage() {
  return (
    <div className="flex flex-col gap-14">
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: [0.21, 0.5, 0.3, 1] }}
        className="flex flex-col gap-5 max-w-3xl"
      >
        <span className="inline-flex items-center gap-2 text-xs uppercase tracking-wider text-neutral-500">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-zcash-yellow" aria-hidden />
          Built for ZEC-paid teams
        </span>
        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-semibold tracking-tight leading-[1.04]">
          Accounting &amp; payroll for{" "}
          <span className="text-zcash-yellow">shielded ZEC teams</span>.
        </h1>
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, delay: 0.12, ease: [0.21, 0.5, 0.3, 1] }}
      >
        <SignInPanel />
      </motion.section>

      <motion.section
        variants={stagger}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: "-80px" }}
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
      >
        {features.map((f) => (
          <motion.div key={f.title} variants={rise}>
            <Card title={f.title} body={f.body} icon={f.icon} />
          </motion.div>
        ))}
      </motion.section>
    </div>
  );
}

function Card({ title, body, icon }: { title: string; body: string; icon: ReactNode }) {
  return (
    <div className="group h-full rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/40 p-5 hover:border-neutral-300 dark:hover:border-neutral-700 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_10px_30px_-15px_rgba(0,0,0,0.25)] dark:hover:shadow-[0_10px_30px_-15px_rgba(0,0,0,0.6)]">
      <div className="inline-flex items-center justify-center h-10 w-10 rounded-lg bg-zcash-yellow/10 text-zcash-yellow mb-3.5 group-hover:bg-zcash-yellow/20 transition-colors">
        {icon}
      </div>
      <div className="font-semibold tracking-tight">{title}</div>
      <div className="text-sm text-neutral-600 dark:text-neutral-400 mt-1.5 leading-relaxed">{body}</div>
    </div>
  );
}

function KeyIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="7.5" cy="15.5" r="3.5" />
      <path d="M10.5 13L20 3.5" />
      <path d="M16 7l3 3" />
      <path d="M18 5l3 3" />
    </svg>
  );
}
function SendIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M22 2L11 13" />
      <path d="M22 2L15 22l-4-9-9-4z" />
    </svg>
  );
}
function ChartIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 3v18h18" />
      <path d="M7 14l4-4 3 3 6-7" />
    </svg>
  );
}
function TagIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <circle cx="7" cy="7" r="1.2" fill="currentColor" />
    </svg>
  );
}
function UsersIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
function ShieldIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}
