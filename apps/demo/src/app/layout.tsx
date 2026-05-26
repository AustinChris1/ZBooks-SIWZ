import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import Link from "next/link";

export const metadata: Metadata = {
  title: "ZBooks — accounting for teams paid in ZEC",
  description: "Add a viewing key, get a P&L. The accounting tool ZEC teams have been pasting txids into spreadsheets to avoid building.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  const address = (session?.user as { address?: string } | undefined)?.address;

  return (
    <html lang="en">
      <body>
        <Providers>
          <div className="min-h-screen flex flex-col">
            <Header signedInAs={address} />
            <main className="mx-auto w-full max-w-5xl px-4 py-8 flex-1">{children}</main>
            <Footer />
          </div>
        </Providers>
      </body>
    </html>
  );
}

function Header({ signedInAs }: { signedInAs?: string }) {
  return (
    <header className="border-b border-black/10 dark:border-white/10">
      <div className="mx-auto max-w-5xl px-4 py-4 flex items-center justify-between gap-6">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span className="inline-block h-6 w-6 rounded bg-zcash-yellow" aria-hidden />
          <span>ZBooks</span>
          <span className="text-xs font-normal opacity-50 hidden sm:inline">accounting for ZEC teams</span>
        </Link>
        <nav className="flex gap-1 sm:gap-3 text-sm">
          {signedInAs ? (
            <>
              <NavLink href="/keys">Keys</NavLink>
              <NavLink href="/transactions">Transactions</NavLink>
              <NavLink href="/reports">Reports</NavLink>
              <NavLink href="/team">Team</NavLink>
            </>
          ) : null}
        </nav>
      </div>
    </header>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-md px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/5"
    >
      {children}
    </Link>
  );
}

function Footer() {
  return (
    <footer className="border-t border-black/10 dark:border-white/10">
      <div className="mx-auto max-w-5xl px-4 py-6 text-sm opacity-70">
        ZBooks — built for the Zechub hackathon, paired with{" "}
        <a className="underline" href="https://github.com" target="_blank" rel="noreferrer">
          Sign in with Zcash
        </a>
        . Authentication is non-custodial: we only see signed messages, never keys.
      </div>
    </footer>
  );
}
