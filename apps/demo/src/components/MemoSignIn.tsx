"use client";

import { useEffect, useRef, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

/**
 * Memo-challenge sign-in. The Zcash-native sign-in flow:
 *   1. App asks the server for a challenge (no input needed).
 *   2. UI renders a QR + clickable `zcash:` deep link with a tiny
 *      unique amount.
 *   3. User scans/taps → wallet opens pre-filled → confirms send.
 *   4. App auto-polls the block explorer for a matching incoming tx.
 *   5. As soon as a match is detected, the user is signed in.
 *
 * No UFVK upfront, no txid paste — the user can optionally attach a UFVK
 * later on /keys if they want ZBooks to import their transactions.
 *
 * "Trouble detecting?" reveals a manual txid-paste fallback for users
 * whose explorer indexing is slow or unavailable.
 */
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

  const beginChallenge = async () => {
    setError(null);
    setIssuing(true);
    try {
      const res = await fetch("/api/auth/memo/issue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
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
    const result = await signIn("memo", { identity, envelope, redirect: false });
    if (result?.error || !result?.ok) {
      setError(result?.error ?? "Sign-in rejected by server");
      setSignedIn(false);
      return;
    }
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

  if (!challenge) {
    return (
      <div className="rounded-lg border border-black/10 dark:border-white/10 p-5 flex flex-col gap-3">
        <div>
          <div className="text-base font-semibold">Send a tiny ZEC payment to sign in</div>
          <p className="text-xs opacity-70 mt-1 max-w-md">
            Works with every shielded Zcash wallet (Zashi, Zingo, YWallet, Zodl,
            eZcash, Zenith, Cake, Brave, …). The amount is a few cents and
            uniquely identifies your sign-in attempt — no message-signing
            support required from your wallet.
          </p>
        </div>
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
          <Detail
            label="Send exactly"
            value={`${challenge.amountZec} ZEC`}
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
            <div className="text-sm text-green-700">
              ✓ Payment detected — signing you in…
            </div>
          )}

          {challenge.demoMode && !signedIn && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs flex flex-col gap-2">
              <div className="font-semibold">DEMO MODE — DO NOT send real ZEC</div>
              <p className="opacity-80">
                <code>SIWZ_DEMO=1</code> is set in <code>.env.local</code>, so
                the server is using an in-memory mock explorer. <strong>Any real
                mainnet tx you send to that address will NEVER be detected here</strong> —
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
        <button
          type="button"
          className="text-xs underline opacity-70 self-start"
          onClick={() => setShowFallback((s) => !s)}
        >
          {showFallback ? "Hide fallback" : "Trouble detecting? Paste your txid manually"}
        </button>
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
  uri: string;
  amountZec: string;
  amountZatoshi: string;
  serviceAddress: string;
  token: string;
  expiresAt: string;
  demoMode?: boolean;
}

function Detail({
  label,
  value,
  mono,
  onCopy,
  copiedKey,
  copied,
}: {
  label: string;
  value: string;
  mono?: boolean;
  onCopy?: () => void;
  copiedKey?: string;
  copied?: string | null;
}) {
  const isCopied = copiedKey != null && copied === copiedKey;
  return (
    <div className="flex flex-col gap-0.5">
      <div className="text-xs opacity-60">{label}</div>
      <div className="flex items-center gap-2">
        <code className={`text-xs break-all ${mono ? "font-mono" : ""}`}>{value}</code>
        {onCopy && (
          <button
            type="button"
            onClick={onCopy}
            className="text-[10px] rounded border border-black/15 dark:border-white/15 px-1.5 py-0.5"
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
