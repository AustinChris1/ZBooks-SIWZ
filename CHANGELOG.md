# Changelog

All three packages are versioned together.

## 0.3.0

### Sign-in no longer touches a viewing key

**Breaking (`@siwz/react`).** `snapConnect` no longer fetches a Unified Full
Viewing Key, and `SnapIdentity.ufvk` is now optional and absent by default. Pass
`{ includeViewingKey: true }` only if an app genuinely needs to scan a ledger
with explicit user consent. `snapGetViewingKey` is still exported but
deprecated.

A UFVK is permanent, unrevocable read access to an entire account in both
directions, and receiving one proves nothing about key control. It was the wrong
credential for authentication. Snap sign-in now sends `anon:<fingerprint>` as
the subject.

`onSnapAuth` receives a second argument, the `SnapAuthAttempt`, describing what
proof the Snap could actually produce. On `kind: "unsupported"` the only
credential is MetaMask's own attestation of a seed fingerprint, which is not
cryptographic proof of key control. Reject it if your app needs a verifiable
session. The first argument is unchanged, so existing handlers keep compiling.

New: `snapAuthenticate`, `snapSignMessage` and `snapPayMemoChallenge` probe for
a signing or send RPC and fail cleanly with `method-unavailable` so callers fall
back to the QR or paste flow. The published ChainSafe Snap exposes neither yet,
so these light up with no code change when it does.

### Domain-key signatures (draft)

New in `@siwz/core`: `deriveSiwzDomainKey`, `signSiwzMessage`,
`verifySiwzDomainSignature`, `encodeSiwzIdentity`, `decodeSiwzIdentity`,
`isSiwzIdentity`, `normalizeSiwzDomain`, `siwzSigningPayload`,
`SIWZ_SEED_BYTES`, `SIWZ_ID_HRP`, `SIWZ_SIGNING_PREFIX`.

The wallet derives an Ed25519 keypair from the BIP 39 seed, scoped to the
verifier's domain and account, and signs a prefixed SIWZ message. The identity
is the per-domain public key as `siwz1…`, so no payment address is disclosed and
logins are unlinkable across sites.

`SiwzMessage` accepts either a Zcash address or a SIWZ identity on the subject
line and reports which via `subjectType`. `verifyMessage` dispatches `siwz-id`
without address parsing. `AddressType` gains `"siwz-id"`.

This is a draft. No shipping wallet derives these keys yet, so nothing in
production should depend on it. Spec and test vectors:
`docs/siwz/domain-keys.md` and
`packages/siwz-core/vectors/siwz-domain-key-v1.json`.

Derivation inputs are pinned so two correct implementations cannot disagree: the
seed must be exactly 64 bytes (the BIP 39 binary seed), the account index is
folded in as four big-endian bytes, and the domain must be a bare `host[:port]`
rather than a URL to normalise. Any change to these will be a new version
string.
