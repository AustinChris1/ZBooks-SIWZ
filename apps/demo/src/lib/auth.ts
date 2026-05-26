import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { SiwzProvider } from "@siwz/next-auth";
import type { Network } from "@siwz/core";
import {
  onSnapAuthSuccess,
  snapIdentityFor,
  validateSnapCredentials,
  verifySnapEnvelope,
} from "./snap-auth";

const SECRET = process.env.NEXTAUTH_SECRET;
if (!SECRET) {
  // We don't throw at module load because Next builds tsx import graphs
  // ahead of running env-checks; warn instead and let authorize() fail.
  console.warn("[demo] NEXTAUTH_SECRET is not set — auth will fail.");
}
const SIWZ_DOMAIN = process.env.SIWZ_DOMAIN ?? "localhost:3000";

export const SIWZ_NETWORK: Network = (process.env.SIWZ_NETWORK as Network) ?? "mainnet";

const siwzConfig = SiwzProvider({
  expectedDomain: SIWZ_DOMAIN,
  secret: SECRET ?? "insecure-dev-fallback-secret-do-not-use-in-prod",
});

const memoProvider = CredentialsProvider({
  id: "memo",
  name: "Sign in with Zcash memo",
  credentials: {
    identity: { label: "Identity (UFVK)", type: "text" },
    envelope: { label: "Envelope", type: "text" },
  },
  async authorize(credentials) {
    try {
      const c = credentials as Partial<{ identity: string; envelope: string }> | undefined;
      if (!c?.identity || !c.envelope) return null;
      if (!SECRET) return null;
      // The envelope is HMAC'd by /api/auth/memo/verify after the block
      // explorer confirmed the tx. Re-verify it here so a malicious page
      // can't forge sessions by guessing identity values.
      const fingerprint = hashIdentity(c.identity);
      if (!verifySnapEnvelope({ fingerprint, ufvk: c.identity }, c.envelope, SECRET)) {
        console.warn("[memo] envelope HMAC mismatch");
        return null;
      }
      const { identity } = onSnapAuthSuccess(
        { fingerprint, ufvk: c.identity },
        "SIWZ memo-challenge",
      );
      return {
        id: identity,
        name: identity,
        addressType: "memo",
        network: SIWZ_NETWORK,
      };
    } catch (err) {
      console.error("[memo] authorize threw:", err);
      return null;
    }
  },
});

function hashIdentity(s: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createHash } = require("node:crypto");
  return createHash("sha256").update(s).digest("hex").slice(0, 32);
}

const snapProvider = CredentialsProvider({
  id: "snap",
  name: "Sign in with MetaMask (Zcash Snap)",
  credentials: {
    fingerprint: { label: "Fingerprint", type: "text" },
    ufvk: { label: "UFVK", type: "text" },
    envelope: { label: "Envelope", type: "text" },
  },
  async authorize(credentials) {
    try {
      const c = credentials as Partial<{ fingerprint: string; ufvk: string; envelope: string }> | undefined;
      if (!c?.fingerprint || !c.ufvk || !c.envelope) return null;
      const inspection = validateSnapCredentials({ fingerprint: c.fingerprint, ufvk: c.ufvk });
      if (!inspection.ok) {
        console.warn(`[snap] credentials rejected: ${inspection.reason}`);
        return null;
      }
      if (!SECRET) return null;
      if (!verifySnapEnvelope({ fingerprint: c.fingerprint, ufvk: c.ufvk }, c.envelope, SECRET)) {
        console.warn("[snap] envelope HMAC mismatch");
        return null;
      }
      const { identity } = onSnapAuthSuccess({ fingerprint: c.fingerprint, ufvk: c.ufvk });
      return {
        id: identity,
        name: identity,
        addressType: "snap",
        network: SIWZ_NETWORK,
      };
    } catch (err) {
      console.error("[snap] authorize threw:", err);
      return null;
    }
  },
});

export const authOptions: NextAuthOptions = {
  providers: [
    // SiwzProvider returns a credentials provider config object; NextAuth v4
    // expects the provider to be wrapped with CredentialsProvider(...).
    CredentialsProvider(siwzConfig as Parameters<typeof CredentialsProvider>[0]),
    snapProvider,
    memoProvider,
  ],
  session: { strategy: "jwt" },
  pages: { signIn: "/" },
  secret: SECRET,
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.address = (user as { id: string }).id;
        token.addressType = (user as { addressType?: string }).addressType;
        token.network = (user as { network?: string }).network;
      }
      return token;
    },
    async session({ session, token }) {
      (session.user as Record<string, unknown>).address = token.address;
      (session.user as Record<string, unknown>).addressType = token.addressType;
      (session.user as Record<string, unknown>).network = token.network;
      return session;
    },
  },
};
