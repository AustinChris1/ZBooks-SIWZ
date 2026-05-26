/**
 * End-to-end test of the Snap auth path against the running ZBooks demo.
 *
 *   node scripts/e2e-snap.mjs
 *
 * Steps:
 *   1. Synthesize a Snap identity (fingerprint + UFVK)
 *   2. POST /api/auth/snap-envelope to get the HMAC envelope
 *   3. POST credentials to NextAuth's "snap" provider callback
 *   4. Assert session is created with identity = `snap:<fingerprint>`
 *   5. Assert the UFVK was auto-imported into /keys
 *
 * MetaMask isn't part of this script — we simulate the data shape the
 * Snap would return after a successful in-browser permission grant.
 */
import { randomBytes } from "node:crypto";

const BASE = process.env.BASE ?? "http://localhost:3000";
const ok = (m) => console.log(`✓ ${m}`);
const fail = (m) => { console.error(`✗ ${m}`); process.exit(1); };

async function main() {
  // 1) Synthesize: random 32-byte fingerprint (hex), valid-shaped UFVK
  const fingerprint = randomBytes(16).toString("hex");
  // bech32 alphabet chars only — uview1 + 80 of them
  const ufvk = `uview1${"q".repeat(80)}`;
  ok(`synthetic identity: fingerprint=${fingerprint.slice(0, 12)}…`);

  // 2) Get HMAC envelope from server
  const envRes = await fetch(`${BASE}/api/auth/snap-envelope`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fingerprint, ufvk }),
  });
  if (!envRes.ok) {
    const t = await envRes.text();
    fail(`snap-envelope endpoint returned ${envRes.status}: ${t}`);
  }
  const { envelope } = await envRes.json();
  ok(`got envelope (${envelope.length} chars)`);

  // 3) NextAuth CSRF → snap callback
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  if (!csrfRes.ok) fail(`csrf endpoint returned ${csrfRes.status}`);
  const csrfCookies = csrfRes.headers.getSetCookie?.() ?? [csrfRes.headers.get("set-cookie")].filter(Boolean);
  const { csrfToken } = await csrfRes.json();
  const cookieHeader = (jar) => jar.map((c) => c.split(";")[0]).filter(Boolean).join("; ");
  const cookieJar = [...csrfCookies];

  const body = new URLSearchParams({
    csrfToken,
    callbackUrl: `${BASE}/`,
    fingerprint,
    ufvk,
    envelope,
    json: "true",
  });
  const cbRes = await fetch(`${BASE}/api/auth/callback/snap`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: cookieHeader(cookieJar),
    },
    body,
  });
  cookieJar.push(...(cbRes.headers.getSetCookie?.() ?? [cbRes.headers.get("set-cookie")].filter(Boolean)));
  const cbJson = await cbRes.json().catch(() => null);
  if (cbJson?.url?.includes("error")) fail(`NextAuth rejected snap sign-in: ${cbJson.url}`);
  if (!cookieJar.some((c) => /next-auth\.session-token=|__Secure-next-auth\.session-token=/.test(c))) {
    fail(`No session cookie set.\nSet-Cookie:\n${cookieJar.join("\n")}\nBody: ${JSON.stringify(cbJson)}`);
  }
  ok("session cookie issued by NextAuth snap provider");

  // 4) Confirm session identity
  const sessRes = await fetch(`${BASE}/api/auth/session`, {
    headers: { cookie: cookieHeader(cookieJar) },
  });
  const sess = await sessRes.json();
  const expectedId = `snap:${fingerprint.slice(0, 32)}`;
  if (sess?.user?.address !== expectedId) {
    fail(`session.user.address mismatch: expected ${expectedId}, got ${JSON.stringify(sess)}`);
  }
  ok(`session.user.address = ${sess.user.address}`);

  // 5) Confirm UFVK was auto-imported via /api/keys
  const keysRes = await fetch(`${BASE}/api/keys`, {
    headers: { cookie: cookieHeader(cookieJar) },
  });
  if (!keysRes.ok) fail(`/api/keys returned ${keysRes.status}`);
  const { keys } = await keysRes.json();
  const imported = keys.find((k) => k.ufvk === ufvk);
  if (!imported) fail(`UFVK was not auto-imported. Keys: ${JSON.stringify(keys, null, 2)}`);
  ok(`UFVK auto-imported as "${imported.label}" (primary=${imported.primary})`);

  console.log("\nALL CHECKS PASSED ✓");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
