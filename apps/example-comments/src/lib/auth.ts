import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { SiwzProvider } from "@siwz/next-auth";

const SECRET = process.env.NEXTAUTH_SECRET ?? "dev-secret-please-set-NEXTAUTH_SECRET";

// 1. SIWZ paste-flow provider (works with any wallet that supports signmessage).
const siwz = SiwzProvider({
  expectedDomain: process.env.SIWZ_DOMAIN ?? "localhost:3001",
  secret: SECRET,
});

// 2. Memo-challenge provider (works with any shielded wallet via ZIP 321).
//    Memo-challenge has its own /api/auth/memo/{issue,poll} endpoints in this
//    app — the credentials provider here just consumes the HMAC envelope
//    they produce. Same envelope shape SIWZ ships in @siwz/next-auth.
const memo = CredentialsProvider({
  id: "memo",
  name: "Sign in with Zcash memo",
  credentials: {
    identity: { label: "Identity", type: "text" },
    envelope: { label: "Envelope", type: "text" },
  },
  async authorize(credentials) {
    const c = credentials as Partial<{ identity: string; envelope: string }> | undefined;
    if (!c?.identity || !c.envelope) return null;
    // Verify envelope HMAC matches the identity we expect (re-use the same
    // hmac function our /api/auth/memo/poll signed with).
    const { createHmac, timingSafeEqual } = await import("node:crypto");
    const expected = createHmac("sha256", SECRET)
      .update(`memo::${c.identity}`)
      .digest("hex");
    if (c.envelope.length !== expected.length) return null;
    if (!timingSafeEqual(Buffer.from(c.envelope), Buffer.from(expected))) return null;
    return { id: c.identity, name: c.identity };
  },
});

export const authOptions: NextAuthOptions = {
  providers: [CredentialsProvider(siwz as Parameters<typeof CredentialsProvider>[0]), memo],
  session: { strategy: "jwt" },
  secret: SECRET,
  pages: { signIn: "/" },
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.address = (user as { id: string }).id;
      return token;
    },
    async session({ session, token }) {
      (session.user as Record<string, unknown>).address = token.address;
      return session;
    },
  },
};
