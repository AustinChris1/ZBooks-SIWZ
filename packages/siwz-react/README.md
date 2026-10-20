# @siwz/react

[![npm](https://img.shields.io/npm/v/@siwz/react.svg)](https://www.npmjs.com/package/@siwz/react)

Drop-in React components, a headless hook, and MetaMask Zcash Snap helpers for **Sign in with Zcash**.

Docs and live demos: <https://siwz.vercel.app>

## Install

```bash
npm i @siwz/react @siwz/core
```

Peer-deps: `react >= 18`, `react-dom >= 18`. `qrcode` ships as a regular dependency, so `<MemoSignIn />` works without any extra install step.

## What ships

| Export | What it does | |
|---|---|---|
| `<MemoSignIn />` | Memo-challenge UI: renders a ZIP 321 QR, polls a server endpoint until the payment lands, surfaces the resolved identity. Works with every Zcash wallet. | Recommended |
| `<SignInWithZcash />` | Signed-message UI: address input, SIWZ challenge, paste-signature, verify. Optional one-click Snap path via `enableSnap` + `onSnapAuth`. | |
| `<SignOut />` | Matching sign-out button with idle / busy / optional-confirm states. Auth-layer agnostic; you pass an `onSignOut` handler. | |
| `useSiwz()` | Headless hook backing the signed-message state machine. Render whatever markup you like. | |
| `snapConnect`, `snapGetSeedFingerprint`, `snapGetViewingKey`, `detectSnapEnvironment`, ... | Low-level helpers for the ChainSafe MetaMask Zcash Snap. | |

## Quickstart: memo-challenge (recommended)

The memo-challenge flow asks the wallet to make a tiny ZEC payment with a server-chosen memo. The server matches the payment on chain and returns an identity. No signing primitives required from the wallet, so it works on transparent, sapling, and orchard accounts alike.

### Zero-config

Pair with a server that exposes `/api/auth/memo/issue` and `/api/auth/memo/poll` (the shape used by `apps/demo`, `apps/zecwall`, and the `@siwz/next-auth` reference handlers):

```tsx
import { MemoSignIn } from "@siwz/react";
import "@siwz/react/styles.css";
import { signIn } from "next-auth/react";

<MemoSignIn
  onSuccess={async ({ identity, envelope, txid }) => {
    await signIn("memo", { identity, envelope, redirect: false });
  }}
  onError={(msg) => console.error("[siwz]", msg)}
/>
```

### Custom endpoints and overrides

Point at non-default routes, forward a UFVK for shielded identity continuity, or replace the transport entirely:

```tsx
<MemoSignIn
  issueEndpoint="/api/zcash/issue"
  pollEndpoint="/api/zcash/poll"
  issueBody={{ ufvk, previousAnonId }}
  buttonLabel="Pay to sign in"
  initialPollMs={2000}
  pollMs={5000}
  timeoutMs={5 * 60_000}
  qrSize={288}
  classNames={{ root: "my-card", button: "my-btn", qr: "my-qr" }}
  // Full transport override; takes precedence over issueEndpoint / pollEndpoint.
  issueChallenge={async () => fetchMyChallenge()}
  pollSignIn={async (token) => fetchMyPoll(token)}
  onSuccess={({ identity, mode }) => {
    // mode is "transparent-amount" or "shielded-memo" depending on the server.
  }}
/>
```

Props supported by `MemoSignInProps`: `issueEndpoint`, `pollEndpoint`, `issueChallenge`, `pollSignIn`, `issueBody`, `onSuccess`, `onError`, `buttonLabel`, `initialPollMs`, `pollMs`, `timeoutMs`, `qrSize`, `classNames`.

### Server-side wire convention

`<MemoSignIn />` treats any non-2xx response from the poll endpoint as a transient network error and silently retries until its `timeoutMs`. Your poll route must therefore use:

- `200 { ok: true, identity, ... }` on match
- `202 { ok: false, retryable: true }` while still waiting
- `4xx { ok: false, error: "..." }` only for terminal failures (bad token, malformed body)

Returning `4xx` for "not yet matched" makes the component appear to hang instead of failing fast. [`@siwz/next-auth/memo`](https://www.npmjs.com/package/@siwz/next-auth)'s `pollMemoHandler` follows this convention out of the box.

## Signed-message flow

For wallets that can sign an arbitrary message, `<SignInWithZcash />` walks the user through address entry, SIWZ challenge, paste-signature, and verify:

```tsx
import { SignInWithZcash } from "@siwz/react";
import "@siwz/react/styles.css";
import { signIn } from "next-auth/react";

<SignInWithZcash
  domain={window.location.host}
  uri={window.location.origin}
  network="mainnet"
  statement="Sign in to MyApp."
  getNonce={async () => {
    const r = await fetch("/api/siwz/nonce", { cache: "no-store" });
    const { nonce, token } = await r.json();
    sessionStorage.setItem("siwz:token", token);
    return nonce;
  }}
  submit={async ({ message, signature }) => {
    const nonceToken = sessionStorage.getItem("siwz:token") ?? "";
    const result = await signIn("siwz", { message, signature, nonceToken, redirect: false });
    return result?.ok ? { ok: true } : { ok: false, error: result?.error ?? "rejected" };
  }}
/>
```

## Sign out

```tsx
import { SignOut } from "@siwz/react";
import "@siwz/react/styles.css";
import { signOut } from "next-auth/react";

<SignOut onSignOut={() => signOut({ callbackUrl: "/" })} />
```

`<SignOut />` is intentionally not coupled to next-auth; pass any handler. Optional confirm prompt and three visual variants:

```tsx
<SignOut
  onSignOut={async () => {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/";
  }}
  confirm
  confirmMessage="Sign out of MyApp?"
  variant="link"       // "primary" | "secondary" (default) | "link"
  buttonLabel="Sign out"
  busyLabel="Signing out…"
  onError={(msg) => console.warn("[signout]", msg)}
/>
```

Slots overridable via `classNames`: `root`, `button`, `confirm`, `confirmYes`, `confirmNo`.

## Headless: `useSiwz()`

```tsx
import { useSiwz } from "@siwz/react";

const s = useSiwz({ domain, uri, network, getNonce, submit });

s.status            // "addressEntry" | "fetchingNonce" | "awaitingSignature" | "verifying" | "success" | "error"
s.address; s.setAddress(addr);
s.isAddressValid    // boolean per parseAddress()
s.buildChallenge()  // validate + fetch nonce + build SIWZ message
s.message
s.signature; s.setSignature(sig);
s.submitSignature() // post to server
s.error
s.reset()
```

## Memo-challenge UI

`<MemoSignIn />` ships with the package and covers the common case end-to-end: issue, render QR, poll, surface identity. The protocol primitives (`issueMemoChallenge`, `verifyMemoChallenge`, the ZIP 321 URI builder) live in [`@siwz/core`](https://www.npmjs.com/package/@siwz/core) for apps that need a different UI shape.

Two inline reference implementations remain useful when you want to build your own component, both linked from <https://siwz.vercel.app>:

- `apps/demo`: a full memo flow with auto-reconciliation, dark-mode styling, and accessibility polish.
- `apps/zecwall`: the same flow with no extras, written to be readable end-to-end in a single file.

## MetaMask Zcash Snap

For accounts using ChainSafe's [Zcash Snap](https://snaps.metamask.io/snap/npm/chainsafe/webzjs-zcash-snap/).

**SIWZ never requests your viewing key.** A UFVK is a permanent, unrevocable read capability over the entire account, and receiving one proves nothing about key control, so it is the wrong credential for sign-in. `snapAuthenticate` instead tries the two paths that produce real, server-verifiable proof:

```ts
import { snapAuthenticate } from "@siwz/react";

const attempt = await snapAuthenticate({
  message: siwzChallenge,  // used if the Snap can sign messages
  zip321Uri: memoChallenge.uri, // used if the Snap can send
});

switch (attempt.kind) {
  case "signature": // SIWE parity. Verify attempt.signature server-side.
  case "payment":   // Memo challenge paid in-wallet. Verify on-chain.
  case "unsupported": // Fall back to the QR or paste flow.
}
```

1. **`signMessage`** gives exact SIWE parity: the Snap signs the challenge, your server verifies the signature against the address, and nothing is disclosed.
2. **A send method** lets the Snap pay the memo challenge (dust plus a nonce in the memo) so the user stays inside MetaMask instead of scanning a QR code. Your server still verifies the payment on-chain.

**Current status:** the published Snap exposes neither method, so `snapAuthenticate` returns `unsupported` and you should fall back to memo-challenge or paste. It also restricts RPC to `https://webzjs.chainsafe.dev` via `endowment:rpc.allowedOrigins`, so third-party origins are rejected regardless. Both are tracked in [ChainSafe/WebZjs#165](https://github.com/ChainSafe/WebZjs/issues/165). The probe caches negative results and needs no code change on your side when either method ships.

Treat Snap as a progressive enhancement. Memo-challenge works with every Zcash wallet today and has none of these constraints.

Helpers exported:

```ts
detectSnapEnvironment, requestSnapInstall
snapAuthenticate, snapSignMessage, snapPayMemoChallenge
snapConnect, snapGetSeedFingerprint
findMetaMaskProvider, DEFAULT_SNAP_ID, SnapInvokeError
type SnapStatus, type SnapIdentity, type SnapAuthAttempt
type SnapSignature, type SnapPayment, type SnapErrorCode
```

`snapGetViewingKey` is still exported but deprecated. `snapConnect` no longer calls it, and sign-in must not either.

## Styling

Default stylesheet uses CSS variables. Override the accent and you're done:

```css
.siwz-root {
  --siwz-accent: #f4b728;
  --siwz-accent-fg: #1a1a1a;
}
```

Or skip the stylesheet entirely and pass `classNames` to any component to wire your own Tailwind / CSS-in-JS classes per slot. `<SignInWithZcash />` slots: `root`, `button`, `addressInput`, `challenge`, `signatureInput`, `error`, `success`. `<MemoSignIn />` slots: `root`, `button`, `challenge`, `qr`, `details`, `pending`, `error`, `success`. `<SignOut />` slots: `root`, `button`, `confirm`, `confirmYes`, `confirmNo`.

## Related packages

- [`@siwz/core`](https://www.npmjs.com/package/@siwz/core): protocol primitives.
- [`@siwz/next-auth`](https://www.npmjs.com/package/@siwz/next-auth): NextAuth provider plus stateless HMAC nonces.

## License

MIT
