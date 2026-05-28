import { createHash } from "node:crypto";
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { SiwzProvider } from "@siwz/next-auth";
import { ZCASH_BLOCKS, type Network } from "@siwz/core";
import {
  onSnapAuthSuccess,
  validateSnapCredentials,
  verifySnapEnvelope,
} from "./snap-auth";
import { addKey, ensureMember, listKeys } from "./db";
import { inspectUfvk } from "./ufvk";

const SECRET = process.env.NEXTAUTH_SECRET;
if (!SECRET) {
  // Warn rather than throw so Next can build its import graph before env-checks run.
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
    identity: { label: "Identity", type: "text" },
    envelope: { label: "Envelope", type: "text" },
    // Optional: if the user pasted a UFVK at the start of the ceremony,
    // the client forwards it here so we can auto-attach it to /keys.
    ufvk: { label: "UFVK", type: "text" },
  },
  async authorize(credentials) {
    try {
      const c = credentials as Partial<{ identity: string; envelope: string; ufvk: string }> | undefined;
      if (!c?.identity || !c.envelope) return null;
      if (!SECRET) return null;

      const fingerprint = hashIdentity(c.identity);
      if (!verifySnapEnvelope({ fingerprint, ufvk: c.identity }, c.envelope, SECRET)) {
        console.warn("[memo] envelope HMAC mismatch");
        return null;
      }

      // Use c.identity directly — don't re-derive through snapIdentityFor
      // (which would double-hash the anon prefix into snap:<hash-of-anon>).
      const identity = c.identity;
      ensureMember(identity);

      // Auto-import UFVK only when its hash matches the identity's anon
      // suffix (anti-spoof: a client can't attach someone else's UFVK).
      const ufvk = (c.ufvk ?? "").trim();
      if (ufvk && identity.startsWith("anon:")) {
        const expectedSuffix = createHash("sha256").update(ufvk).digest("hex").slice(0, 32);
        if (`anon:${expectedSuffix}` === identity) {
          const inspection = inspectUfvk(ufvk);
          if (inspection.valid) {
            const already = listKeys().some((k) => k.ufvk.trim() === ufvk);
            if (!already) {
              addKey({
                owner: identity,
                label: "SIWZ memo-challenge",
                ufvk,
                birthday: ZCASH_BLOCKS.SAFE_RECENT_BIRTHDAY,
              });
            }
          }
        } else {
          console.warn("[memo] supplied UFVK doesn't match identity; ignoring");
        }
      }

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
    // SiwzProvider returns a config object; NextAuth v4 needs it wrapped in CredentialsProvider.
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
