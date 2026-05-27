"use client";

import { useEffect, useRef, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

/**
 * Memo-challenge sign-in. The Zcash-native sign-in flow:
 *   1. App asks the server for a challenge (no input needed by default).
 *   2. UI renders a QR + clickable `zcash:` deep link with a tiny
 *      unique amount.
 *   3. User scans/taps → wallet opens pre-filled → confirms send.
 *   4. App auto-polls the block explorer for a matching incoming tx.
 *   5. As soon as a match is detected, the user is signed in.
 *
 * Identity model:
 *   - **Anonymous by default.** Each fresh sign-in mints an opaque
 *     server-generated id (`anon:<random>`). The id is persisted to
 *     `localStorage` so a returning anonymous user on the same device
 *     gets the SAME anon session restored — equivalent to a "remember
 *     me" cookie. The anon id leaks nothing about the user.
 *   - **UFVK-bound on opt-in.** If the user pastes their UFVK in the
 *     "Returning user?" field, the session is bound to that UFVK and is
 *     stable across browsers / devices. UFVKs are NEVER stored client-
 *     side because they leak the wallet's full transaction history;
 *     the user is expected to keep their UFVK in a password manager and
 *     paste it when they want cross-device recognition. NextAuth's
 *     session cookie keeps them signed in until they explicitly sign
 *     out (so paste-once-per-month rather than per-visit).
 *
 * Why this split: a UFVK is read-only but powerful — anyone who holds
 * one can see every payment your account has ever made. Storing it in
 * localStorage would expose it to XSS, browser extensions, and anyone
 * with brief device access. An opaque anon id has none of that risk —
 * it's just a session handle the server itself generated and reissued.
 */
// LocalStorage key holds an OPAQUE anon session id ONLY. Never a UFVK.
const ANON_STORAGE_KEY = "siwz.zbooks.previous_anon_id";

/**
 * Re-auth bundle: { identity, envelope } the server issued the last
 * time this device completed the memo ceremony. Replaying it lets the
 * user sign back in with one click — no QR scan, no dust payment.
 *
 * Threat model: equivalent to a long-lived "remember me" cookie. Anyone
 * with browser access can sign in as this identity without a wallet.
 * The envelope is HMAC-signed by NEXTAUTH_SECRET, so rotating that
 * secret invalidates every stored bundle. We never store the UFVK.
 */
const REAUTH_STORAGE_KEY = "siwz.zbooks.reauth";
interface ReauthBundle {
  identity: string;
  envelope: string;
  savedAt: number;
}

export function MemoSignIn() {
  const router = useRouter();
  const [challenge, setChallenge] = useState<MemoChallengeData | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [polling, setPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [showFallback, setShowFallback] = useState(false);
  const [manualTxid, setManualTxid] = useState("");
  const [manualBusy, setManualBusy] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [returningUfvk, setReturningUfvk] = useState("");
  const [showReturning, setShowReturning] = useState(false);
  const [persistedAnonId, setPersistedAnonId] = useState<string | null>(null);
  const [reauthBundle, setReauthBundle] = useState<ReauthBundle | null>(null);
  const [reauthBusy, setReauthBusy] = useState(false);
  // Show the full memo-ceremony UI even when a re-auth bundle is
  // present (e.g. "Use a different account" → reveal QR flow).
  const [forceFreshSignin, setForceFreshSignin] = useState(false);

  // On mount, restore any previously-persisted ANON id + reauth bundle.
  // The bundle is the killer feature: a returning user clicks "Continue
  // as …" and skips the memo ceremony entirely.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const saved = window.localStorage.getItem(ANON_STORAGE_KEY);
      if (saved && /^anon:[0-9a-f]+$/i.test(saved)) {
        setPersistedAnonId(saved);
      }
    } catch {
      /* localStorage may be disabled in private mode; just skip the nicety */
    }
    try {
      const raw = window.localStorage.getItem(REAUTH_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<ReauthBundle>;
        if (
          typeof parsed.identity === "string" &&
          typeof parsed.envelope === "string" &&
          typeof parsed.savedAt === "number"
        ) {
          setReauthBundle(parsed as ReauthBundle);
        }
      }
    } catch {
      /* malformed bundle — ignore */
    }
  }, []);

  const clearPersistedAnonId = () => {
    try {
      window.localStorage.removeItem(ANON_STORAGE_KEY);
      window.localStorage.removeItem(REAUTH_STORAGE_KEY);
    } catch { /* noop */ }
    setPersistedAnonId(null);
    setReauthBundle(null);
  };

  /**
   * One-click re-auth using the stored envelope from a previous
   * successful memo ceremony. Skips the QR / dust-payment / poll dance
   * entirely. On HMAC mismatch (e.g. NEXTAUTH_SECRET rotated) we wipe
   * the bundle and fall back to the regular flow.
   */
  const quickReauth = async () => {
    if (!reauthBundle) return;
    setError(null);
    setReauthBusy(true);
    try {
      const result = await signIn("memo", {
        identity: reauthBundle.identity,
        envelope: reauthBundle.envelope,
        redirect: false,
      });
      if (result?.error || !result?.ok) {
        // Server rejected the stored envelope. Clear it so the user
        // sees the regular sign-in flow next time.
        try { window.localStorage.removeItem(REAUTH_STORAGE_KEY); } catch { /* noop */ }
        setReauthBundle(null);
        setError("Stored sign-in expired. Please sign in again.");
        return;
      }
      router.refresh();
      router.push("/keys");
    } finally {
      setReauthBusy(false);
    }
  };

  const beginChallenge = async () => {
    setError(null);
    setIssuing(true);
    try {
      const ufvk = returningUfvk.trim();
      // Prefer UFVK if user provided one. Otherwise, send the persisted
      // anon id (if any) so the server can re-bind to the same anonymous
      // session — keeps the user "logged in as the same anon" on this
      // device across sign-outs/expirations.
      const body: { ufvk?: string; previousAnonId?: string } = {};
      if (ufvk) body.ufvk = ufvk;
      else if (persistedAnonId) body.previousAnonId = persistedAnonId;
      const res = await fetch("/api/auth/memo/issue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `Server returned ${res.status}`);
      }
      const data = (await res.json()) as MemoChallengeData;
      // Defensive: if we're in DEMO mode the user's actual on-chain tx
      // (if any) will NEVER be detected — the explorer is a mock. Make
      // that loud in the UI so nobody accidentally sends real ZEC.
      setChallenge(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIssuing(false);
    }
  };

  // Auto-poll the explorer once a challenge is active. Stops on success,
  // on error, or when the user cancels.
  const pollingRef = useRef(false);
  useEffect(() => {
    if (!challenge || signedIn) return;
    pollingRef.current = true;
    setPolling(true);
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (!pollingRef.current) return;
      try {
        const res = await fetch("/api/auth/memo/poll", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: challenge.token }),
        });
        if (res.status === 200) {
          const data = (await res.json()) as { identity: string; envelope: string };
          await finishSignIn(data.identity, data.envelope);
          return;
        }
        if (res.status >= 400 && res.status !== 404 && res.status !== 202) {
          const j = await res.json().catch(() => ({}));
          setError(j.error ?? `Poll returned ${res.status}`);
          pollingRef.current = false;
          setPolling(false);
          return;
        }
      } catch (err) {
        // Network blip — keep going.
        console.warn("[memo] poll failed:", err);
      }
      if (pollingRef.current) timer = setTimeout(tick, 6_000);
    };
    // Kick first poll quickly so DEMO-mode matches return near-instantly.
    timer = setTimeout(tick, 1_500);

    return () => {
      pollingRef.current = false;
      setPolling(false);
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challenge, signedIn]);

  const finishSignIn = async (identity: string, envelope: string) => {
    pollingRef.current = false;
    setPolling(false);
    setSignedIn(true);
    // Forward the UFVK the user pasted in the "Returning user?" box so
    // the server can auto-attach it to /keys. The server validates that
    // sha256(ufvk).slice(0,32) matches the identity before trusting it.
    const ufvkToForward = returningUfvk.trim() || undefined;
    const result = await signIn("memo", {
      identity,
      envelope,
      ufvk: ufvkToForward,
      redirect: false,
    });
    if (result?.error || !result?.ok) {
      setError(result?.error ?? "Sign-in rejected by server");
      setSignedIn(false);
      return;
    }
    // Persist the ANON id so the issue endpoint can rebind the user to
    // the same anon session on next sign-in (used when there's no
    // reauth bundle, e.g. first run on a new device).
    if (identity && /^anon:[0-9a-f]+$/i.test(identity)) {
      try {
        window.localStorage.setItem(ANON_STORAGE_KEY, identity);
        setPersistedAnonId(identity);
      } catch { /* private mode / quota — no-op */ }
    }
    // Persist the (identity, envelope) bundle so a returning user can
    // skip the whole memo ceremony next time and just click "Continue
    // as …". The envelope is an HMAC the server can re-verify without
    // any new on-chain payment.
    try {
      const bundle: ReauthBundle = { identity, envelope, savedAt: Date.now() };
      window.localStorage.setItem(REAUTH_STORAGE_KEY, JSON.stringify(bundle));
      setReauthBundle(bundle);
    } catch { /* private mode / quota — no-op */ }
    router.refresh();
    router.push("/keys");
  };

  const tryManualTxid = async () => {
    if (!challenge || !manualTxid.trim()) return;
    setError(null);
    setManualBusy(true);
    try {
      const res = await fetch("/api/auth/memo/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: challenge.token, txid: manualTxid.trim() }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) {
        setError(j.error ?? `Server returned ${res.status}`);
        return;
      }
      await finishSignIn(j.identity, j.envelope);
    } finally {
      setManualBusy(false);
    }
  };

  // Returning-user fast path: if we have a stored re-auth bundle and
  // the user hasn't explicitly asked for the regular flow, surface a
  // single "Continue as …" button.
  if (reauthBundle && !forceFreshSignin && !challenge) {
    return (
      <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/40 p-5 flex flex-col gap-4">
        <div>
          <div className="text-base font-semibold tracking-tight">Welcome back</div>
          <p className="text-xs text-neutral-500 mt-1 max-w-md">
            This device is recognised from a previous sign-in. Click
            below to continue without another wallet payment.
          </p>
        </div>
        <div className="flex items-center gap-3 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50/60 dark:bg-neutral-900/40 px-3 py-2.5">
          <div className="h-8 w-8 rounded-full bg-zcash-yellow/20 text-zcash-dark dark:text-zcash-yellow grid place-items-center text-xs font-bold">
            {reauthBundle.identity.slice(5, 7).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">Returning user</div>
            <code className="font-mono text-[11px] text-neutral-500 truncate block">
              {reauthBundle.identity}
            </code>
          </div>
        </div>
        <button
          onClick={quickReauth}
          disabled={reauthBusy}
          className="rounded-md bg-zcash-yellow text-zcash-dark font-semibold px-4 py-2 text-sm self-start hover:bg-yellow-400 transition-colors disabled:opacity-60"
        >
          {reauthBusy ? "Signing in…" : `Continue as ${shortenIdentity(reauthBundle.identity)}`}
        </button>
        <div className="flex gap-3 text-xs text-neutral-500">
          <button
            type="button"
            onClick={() => setForceFreshSignin(true)}
            className="underline hover:text-neutral-800 dark:hover:text-neutral-200"
          >
            Use a different account
          </button>
          <button
            type="button"
            onClick={clearPersistedAnonId}
            className="underline hover:text-neutral-800 dark:hover:text-neutral-200"
          >
            Forget this device
          </button>
        </div>
        {error && (
          <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 rounded-md px-3 py-2">
            {error}
          </div>
        )}
      </div>
    );
  }

  if (!challenge) {
    return (
      <div className="rounded-lg border border-black/10 dark:border-white/10 p-5 flex flex-col gap-3">
        <div>
          <div className="text-base font-semibold">Send a tiny ZEC payment to sign in</div>
          <p className="text-xs opacity-70 mt-1 max-w-md">
            Works with every shielded Zcash wallet (Zashi, Zingo, YWallet, Zodl,
            eZcash, Zenith, Cake, Brave, …). The amount is a few cents and
            uniquely identifies your sign-in attempt, so no message-signing
            support is required from your wallet.
          </p>
        </div>

        {/* Returning-user UFVK input. Sign-ins WITH a UFVK are bound to
            that identity and recognised across browsers / devices. Sign-ins
            WITHOUT a UFVK are anonymous but device-persistent (an opaque
            anon id is stored in localStorage so the same browser gets the
            same anon session back next time). */}
        {persistedAnonId && !showReturning && (
          <div className="text-xs flex flex-wrap items-center gap-2 rounded-md border border-black/10 dark:border-white/15 bg-black/[0.03] dark:bg-white/[0.03] px-3 py-2">
            <span className="opacity-70">
              ↻ This browser is recognised as the same anonymous user as
              your last sign-in. Click below to continue, or expand
              "Returning user?" to bind to a UFVK instead.
            </span>
            <button
              type="button"
              onClick={clearPersistedAnonId}
              className="text-[11px] underline opacity-70 hover:opacity-100"
            >
              Forget this device
            </button>
          </div>
        )}

        <details
          open={showReturning}
          onToggle={(e) => setShowReturning((e.target as HTMLDetailsElement).open)}
          className="text-xs"
        >
          <summary className="cursor-pointer opacity-70 hover:opacity-100 select-none">
            Returning user? Bind this sign-in to your UFVK
          </summary>
          <div className="flex flex-col gap-2 mt-3">
            <textarea
              className="font-mono text-[11px] rounded-md border border-black/15 dark:border-white/15 bg-transparent px-2 py-1.5 min-h-[4rem]"
              value={returningUfvk}
              onChange={(e) => setReturningUfvk(e.target.value)}
              placeholder="uview1…  (paste your Unified Full Viewing Key)"
              spellCheck={false}
            />
            <p className="opacity-60 leading-relaxed">
              Optional. UFVK-bound sign-ins are recognised as the same user
              across browsers and devices. Leave blank for an anonymous
              sign-in (still remembered on THIS device via a non-sensitive
              session id). <strong>Your UFVK is never stored client-side.</strong>
              It's used for this one sign-in only and never persisted to
              localStorage or cookies. Keep your UFVK in a password manager
              and paste it when you want cross-device recognition.
            </p>
          </div>
        </details>

        <button
          onClick={beginChallenge}
          disabled={issuing}
          className="rounded-md bg-zcash-yellow text-zcash-dark font-semibold px-4 py-2 text-sm self-start disabled:opacity-60"
        >
          {issuing ? "Preparing…" : "Sign in with Zcash"}
        </button>
        {error && <div className="text-sm text-red-600">{error}</div>}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-black/10 dark:border-white/10 p-5 flex flex-col gap-4">
      <div className="grid sm:grid-cols-[200px_1fr] gap-5 items-start">
        <div className="flex flex-col items-center gap-2">
          <img
            src={`/api/auth/memo/qr?uri=${encodeURIComponent(challenge.uri)}`}
            width={200}
            height={200}
            alt="Zcash payment QR code"
            className="rounded-md border border-black/10 dark:border-white/10 bg-white"
          />
          <a href={challenge.uri} className="text-xs underline opacity-80">
            Open in wallet →
          </a>
        </div>

        <div className="flex flex-col gap-3 text-sm">
          <div className="text-[11px] font-semibold uppercase opacity-60 tracking-wide">
            {challenge.mode === "shielded-memo"
              ? `Shielded memo-challenge (${challenge.serviceAddressType})`
              : "Transparent amount-challenge (t-addr)"}
          </div>
          <Detail
            label={challenge.mode === "shielded-memo" ? "Amount" : "Send exactly"}
            value={challenge.amountZec}
            suffix="ZEC"
            mono
            onCopy={() => copy(challenge.amountZec, setCopied)}
            copiedKey="amount"
            copied={copied}
          />
          <Detail
            label="To"
            value={challenge.serviceAddress}
            mono
            onCopy={() => copy(challenge.serviceAddress, setCopied)}
            copiedKey="address"
            copied={copied}
          />
          {challenge.mode === "shielded-memo" && challenge.memo && (
            <Detail
              label="Memo (your wallet pre-fills this from the QR)"
              value={challenge.memo}
              mono
              onCopy={() => copy(challenge.memo!, setCopied)}
              copiedKey="memo"
              copied={copied}
            />
          )}
          <Detail
            label="Expires"
            value={new Date(challenge.expiresAt).toLocaleTimeString()}
          />

          {polling && !signedIn && !challenge.demoMode && (
            <div className="flex items-center gap-2 text-sm">
              <Spinner />
              <span>
                Waiting for your payment on-chain…
                <span className="opacity-60"> (typical ~75s after wallet send)</span>
              </span>
            </div>
          )}
          {polling && !signedIn && challenge.demoMode && (
            <div className="text-xs opacity-60 flex items-center gap-2">
              <Spinner />
              <span>polling explorer for matching payment…</span>
            </div>
          )}
          {signedIn && (
            <div className="text-sm text-emerald-700 dark:text-emerald-400">
              Payment detected. Signing you in…
            </div>
          )}

          {challenge.demoMode && !signedIn && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs flex flex-col gap-2">
              <div className="font-semibold">DEMO MODE. Do not send real ZEC.</div>
              <p className="opacity-80">
                <code>SIWZ_DEMO=1</code> is set in <code>.env.local</code>, so
                the server is using an in-memory mock explorer. <strong>Any real
                mainnet tx you send to that address will never be detected here</strong>,
                and the address itself is probably a placeholder you don't control.
                Click the button below to simulate a matching payment; or set
                <code> SIWZ_DEMO=0</code> + a real service address you own to
                use the live chain.
              </p>
              <button
                type="button"
                onClick={async () => {
                  setError(null);
                  try {
                    const r = await fetch("/api/auth/memo/demo-simulate", {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ token: challenge.token }),
                    });
                    if (!r.ok) {
                      const j = await r.json().catch(() => ({}));
                      throw new Error(j.error ?? `Server returned ${r.status}`);
                    }
                  } catch (err) {
                    setError(`Demo simulate failed: ${(err as Error).message}`);
                  }
                }}
                className="rounded-md border border-amber-600/40 bg-amber-500/20 text-amber-900 dark:text-amber-200 font-semibold px-3 py-1.5 text-sm self-start"
              >
                Simulate payment (demo)
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-black/10 dark:border-white/10 pt-3 flex flex-col gap-2">
        {challenge.mode === "shielded-memo" ? (
          <p className="text-xs opacity-60">
            Shielded payments use the memo to bind your sign-in, not the
            amount. Anyone can see that a payment landed at the service
            address (if they have its IVK), but only the recipient daemon
            can decrypt the memo to prove it's *your* sign-in.
          </p>
        ) : (
          <button
            type="button"
            className="text-xs underline opacity-70 self-start"
            onClick={() => setShowFallback((s) => !s)}
          >
            {showFallback ? "Hide fallback" : "Trouble detecting? Paste your txid manually"}
          </button>
        )}
        {showFallback && (
          <div className="flex flex-col gap-2">
            <input
              className="rounded-md border border-black/15 dark:border-white/15 bg-transparent px-2 py-1.5 font-mono text-xs"
              placeholder="64-char hex txid"
              value={manualTxid}
              onChange={(e) => setManualTxid(e.target.value)}
              spellCheck={false}
            />
            <button
              type="button"
              onClick={tryManualTxid}
              disabled={!/^[0-9a-fA-F]{64}$/.test(manualTxid.trim()) || manualBusy}
              className="text-xs rounded-md border border-black/15 dark:border-white/15 px-2 py-1 self-start disabled:opacity-50"
            >
              {manualBusy ? "Verifying…" : "Verify this txid"}
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={() => {
            setChallenge(null);
            setError(null);
            setShowFallback(false);
          }}
          className="text-xs opacity-60 underline self-start"
        >
          Cancel and start over
        </button>
      </div>

      {error && <div className="text-sm text-red-600">{error}</div>}
    </div>
  );
}

interface MemoChallengeData {
  mode: "transparent-amount" | "shielded-memo";
  uri: string;
  amountZec: string;
  amountZatoshi: string;
  memo?: string;
  serviceAddress: string;
  serviceAddressType: string;
  token: string;
  expiresAt: string;
  demoMode?: boolean;
}

function Detail({
  label,
  value,
  suffix,
  mono,
  onCopy,
  copiedKey,
  copied,
}: {
  label: string;
  value: string;
  /**
   * Optional unit (e.g. "ZEC") rendered alongside the value but kept
   * out of the copied string. Some wallets reject pasted amounts that
   * include a unit suffix, so the user gets a clean number.
   */
  suffix?: string;
  mono?: boolean;
  onCopy?: () => void;
  copiedKey?: string;
  copied?: string | null;
}) {
  const isCopied = copiedKey != null && copied === copiedKey;
  return (
    <div className="flex flex-col gap-0.5">
      <div className="text-xs opacity-60">{label}</div>
      <div className="flex items-center gap-2 flex-wrap">
        <code className={`text-xs break-all ${mono ? "font-mono" : ""}`}>{value}</code>
        {suffix && (
          <span className="text-[10px] uppercase tracking-wider text-neutral-500">
            {suffix}
          </span>
        )}
        {onCopy && (
          <button
            type="button"
            onClick={onCopy}
            className="text-[10px] rounded border border-neutral-300 dark:border-neutral-700 px-1.5 py-0.5 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            {isCopied ? "copied" : "copy"}
          </button>
        )}
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block h-3 w-3 rounded-full border-2 border-current border-r-transparent animate-spin"
    />
  );
}

async function copy(value: string, setCopied: (k: string | null) => void) {
  await navigator.clipboard.writeText(value);
  setCopied(value.length > 15 ? "address" : "amount");
  setTimeout(() => setCopied(null), 1200);
}

function shortenIdentity(id: string): string {
  if (id.length <= 14) return id;
  return `${id.slice(0, 10)}…${id.slice(-4)}`;
}
