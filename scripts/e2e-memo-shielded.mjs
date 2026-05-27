/**
 * End-to-end test of the SIWZ shielded-memo flow against ZBooks.
 *
 *   node scripts/e2e-memo-shielded.mjs
 *
 * Requires the dev server in DEMO mode (SIWZ_DEMO=1) AND SIWZ_SERVICE_ADDRESS
 * set to a shielded address (zs… or u1…). In demo mode the mock explorer
 * stands in for the daemon RPC; demo-simulate seeds a fake decrypted memo
 * that the poll endpoint then matches.
 *
 * Exercises:
 *   1. Issue endpoint returns mode="shielded-memo", a memo string, a ZIP
 *      321 URI containing memo=, and the canonical dust amount.
 *   2. Poll returns 202 before demo-simulate (no silent sign-in).
 *   3. demo-simulate primes a memo fixture.
 *   4. Poll returns 200 with identity + envelope.
 *   5. NextAuth memo provider creates a session.
 */
import { randomBytes } from "node:crypto";

const BASE = process.env.BASE ?? "http://localhost:3000";
const ok = (m) => console.log(`✓ ${m}`);
const fail = (m) => { console.error(`✗ ${m}`); process.exit(1); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // 1) Issue
  const issueRes = await fetch(`${BASE}/api/auth/memo/issue`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!issueRes.ok) {
    const t = await issueRes.text();
    if (t.includes("not configured")) {
      console.log("⚠️  Skipping: shielded-memo flow requires a shielded SIWZ_SERVICE_ADDRESS (zs…/u1…)");
      console.log("   Set one in apps/demo/.env.local + restart, then rerun this script.");
      process.exit(0);
    }
    if (t.includes("no shielded-capable explorer is configured")) {
      console.log("⚠️  Skipping: shielded address set, but no backend wired up.");
      console.log("   Either set SIWZ_DEMO=1 (mock explorer) for local testing,");
      console.log("   or deploy apps/lightwallet-rpc to a VPS and set");
      console.log("   LIGHTWALLET_RPC_URL + LIGHTWALLET_RPC_TOKEN. See docs/winning-deployment.md.");
      process.exit(0);
    }
    fail(`/api/auth/memo/issue → ${issueRes.status}: ${t}`);
  }
  const challenge = await issueRes.json();
  if (challenge.mode !== "shielded-memo") {
    console.log(`⚠️  SIWZ_SERVICE_ADDRESS is transparent (mode=${challenge.mode}). Use e2e-memo.mjs instead.`);
    process.exit(0);
  }
  if (!challenge.memo?.startsWith("SIWZ:")) fail(`expected memo SIWZ:<nonce>, got ${challenge.memo}`);
  if (!/[?&]memo=[A-Za-z0-9_-]+/.test(challenge.uri)) fail(`expected memo param in ZIP 321 URI`);
  ok(`shielded challenge: memo=${challenge.memo}, amount=${challenge.amountZec} ZEC`);
  ok(`ZIP 321 URI includes memo: ${challenge.uri.slice(0, 80)}…`);

  if (!challenge.demoMode) {
    console.log("⚠️  Skipping rest: not in DEMO mode. Set SIWZ_DEMO=1 to exercise full path.");
    process.exit(0);
  }

  // 2) Poll should not match before demo-simulate
  const earlyPoll = await fetch(`${BASE}/api/auth/memo/poll`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: challenge.token }),
  });
  if (earlyPoll.status !== 202) {
    fail(`expected 202 from poll before demo-simulate, got ${earlyPoll.status}`);
  }
  ok("poll returns 202 (no memo yet) before demo-simulate");

  // 3) Simulate
  const simRes = await fetch(`${BASE}/api/auth/memo/demo-simulate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: challenge.token }),
  });
  if (!simRes.ok) fail(`/api/auth/memo/demo-simulate → ${simRes.status}: ${await simRes.text()}`);
  const simJson = await simRes.json();
  if (simJson.mode !== "shielded-memo") fail(`demo-simulate mode mismatch: ${simJson.mode}`);
  ok(`demo simulate primed shielded memo (txid ${simJson.txid?.slice(0, 16)}…)`);

  // 4) Poll → 200
  let pollJson;
  let attempts = 0;
  while (attempts < 5) {
    attempts++;
    const r = await fetch(`${BASE}/api/auth/memo/poll`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: challenge.token }),
    });
    if (r.status === 200) {
      pollJson = await r.json();
      ok(`poll matched after ${attempts} attempt(s); mode=${pollJson.mode}`);
      break;
    }
    if (r.status === 202) {
      await sleep(400);
      continue;
    }
    fail(`/api/auth/memo/poll → ${r.status}: ${await r.text()}`);
  }
  if (!pollJson) fail(`poll never matched`);
  if (pollJson.mode !== "shielded-memo") fail(`poll mode mismatch: ${pollJson.mode}`);
  if (!pollJson.identity?.startsWith("anon:")) fail(`expected anonymous identity, got ${pollJson.identity}`);
  ok(`anonymous identity assigned: ${pollJson.identity}`);

  // 5) NextAuth memo callback
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  const csrfCookies = csrfRes.headers.getSetCookie?.() ?? [csrfRes.headers.get("set-cookie")].filter(Boolean);
  const { csrfToken } = await csrfRes.json();
  const cookieHeader = (jar) => jar.map((c) => c.split(";")[0]).filter(Boolean).join("; ");
  const cookieJar = [...csrfCookies];

  const body = new URLSearchParams({
    csrfToken,
    callbackUrl: `${BASE}/`,
    identity: pollJson.identity,
    envelope: pollJson.envelope,
    json: "true",
  });
  const cbRes = await fetch(`${BASE}/api/auth/callback/memo`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: cookieHeader(cookieJar),
    },
    body,
  });
  cookieJar.push(...(cbRes.headers.getSetCookie?.() ?? [cbRes.headers.get("set-cookie")].filter(Boolean)));
  if (!cookieJar.some((c) => /next-auth\.session-token=/.test(c))) {
    fail(`No session cookie set`);
  }
  ok(`session cookie issued by NextAuth memo provider`);

  console.log("\nALL CHECKS PASSED ✓");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
