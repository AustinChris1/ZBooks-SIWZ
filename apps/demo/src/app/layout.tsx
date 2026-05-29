import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getMember } from "@/lib/db";
import { canSeePayouts } from "@/lib/session";
import Link from "next/link";
import { PageTransition } from "@/components/PageTransition";
import { ThemeToggle } from "@/components/ThemeToggle";

// Inline script that runs before React mounts so the html.dark class is
// set on first paint — eliminates the white-flash on dark-preferring users.
const THEME_BOOTSTRAP = `
(function(){try{
  var t = localStorage.getItem('zbooks.theme');
  var resolved = t === 'light' || t === 'dark'
    ? t
    : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.classList.add(resolved);
  document.documentElement.style.colorScheme = resolved;
}catch(e){}})();
`;

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ZBooks — accounting for teams paid in ZEC",
  description:
    "Add a viewing key, get a P&L. The accounting tool ZEC teams have been pasting txids into spreadsheets to avoid building.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  const address = (session?.user as { address?: string } | undefined)?.address;
  const role = address ? getMember(address)?.role : undefined;
  const showPayouts = role ? canSeePayouts(role) : false;

  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      {/* suppressHydrationWarning on <body> only — covers extension-
          injected attrs like Grammarly's data-new-gr-c-s-check-loaded
          and data-gr-ext-installed. Does not affect children. */}
      <body suppressHydrationWarning>
        <Providers>
          <div className="min-h-screen flex flex-col">
            <Header signedInAs={address} showPayouts={showPayouts} />
            <main className="mx-auto w-full max-w-5xl px-4 py-10 flex-1">
              <PageTransition>{children}</PageTransition>
            </main>
            <Footer />
          </div>
        </Providers>
      </body>
    </html>
  );
}

function Header({ signedInAs, showPayouts }: { signedInAs?: string; showPayouts?: boolean }) {
  return (
    <header className="border-b border-neutral-200 dark:border-neutral-800/80 bg-white/60 dark:bg-neutral-950/40 backdrop-blur sticky top-0 z-10">
      <div className="mx-auto max-w-5xl px-4 py-3.5 flex items-center justify-between gap-6">
        <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-tight">
          <span className="inline-flex items-center justify-center h-7 w-7 rounded-md bg-zcash-yellow text-zcash-dark text-xs font-bold">
            Z
          </span>
          <span>ZBooks</span>
          <span className="text-xs font-normal text-neutral-500 hidden sm:inline">
            accounting for ZEC teams
          </span>
        </Link>
        <div className="flex items-center gap-1 sm:gap-2">
          <nav className="flex gap-0.5 sm:gap-1 text-sm">
            {signedInAs ? (
              <>
                <NavLink href="/keys">Keys</NavLink>
                <NavLink href="/transactions">Transactions</NavLink>
                {showPayouts && <NavLink href="/payouts">Payouts</NavLink>}
                <NavLink href="/reports">Reports</NavLink>
                <NavLink href="/counterparties">Contacts</NavLink>
                <NavLink href="/audit">Audit</NavLink>
                <NavLink href="/team">Team</NavLink>
              </>
            ) : null}
          </nav>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-md px-3 py-1.5 text-neutral-600 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-800/60 transition-colors"
    >
      {children}
    </Link>
  );
}

function Footer() {
  return (
    <footer className="border-t border-neutral-200 dark:border-neutral-800/80">
      <div className="mx-auto max-w-5xl px-4 py-6 text-sm text-neutral-500">
        ZBooks, built for the Zechub hackathon, paired with{" "}
        <a className="underline hover:text-neutral-700 dark:hover:text-neutral-300" href="https://github.com" target="_blank" rel="noreferrer">
          Sign in with Zcash
        </a>
        . Authentication is non-custodial: we only see signed messages, never keys.
      </div>
    </footer>
  );
}
