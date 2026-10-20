# SIWZ domain-key signatures (v1)

Status: draft. Implemented in `@siwz/core`. Test vectors at
`packages/siwz-core/tests/vectors/siwz-domain-key-v1.json`.

This specifies an off-chain sign-in signature for Zcash wallets. It needs no
consensus change, no proving circuit, and no new ZIP before a wallet can ship
it. A wallet implementation is roughly fifty lines.

## Why not an address signature

Sign-in with Ethereum works because every wallet already had `personal_sign`.
Zcash has no deployed equivalent:

- [ZIP 322](https://zips.z.cash/zip-0322) "Generic Signed Message Format" is
  **Reserved** with no specification body. Its discussion thread,
  [zcash/zips#429](https://github.com/zcash/zips/issues/429), has been open
  since December 2020 with effectively one comment.
- [ZIP 304](https://zips.z.cash/zip-0304) is Draft, Sapling-only, and not
  implemented by shipping wallets. It is also linkable by construction: the
  signature spends a fake note with fixed value, randomness and tree position,
  so the nullifier is constant per payment address. The ZIP says so plainly,
  that "the first 32 bytes of each signature will be identical" and that "all
  signatures for a specific payment address are linkable without knowing the
  payment address". Adopting it for sign-in would make every login correlatable
  even though the address is never shown.
- [zcash/zips#1154](https://github.com/zcash/zips/pull/1154) "Orchard Address
  Signatures" was closed unmerged on 2026-01-25.
- Transparent `signmessage` exists, but only for `t1…` addresses, and the
  wallets exposing it do so over a loopback RPC a website cannot reach.

Waiting for an address-bound scheme means waiting indefinitely. Worse, an
address-bound scheme is the wrong thing for sign-in even once it exists: putting
a unified address in a signed message publishes a **payment address** into every
login log, access record and backup that message touches, and makes every login
across every site linkable to one identifier.

So SIWZ does not sign with a Zcash address. It signs with a key derived from the
seed the wallet already holds, scoped to one verifier's domain.

## Properties

| | SIWE (`personal_sign`) | SIWZ domain keys |
|---|---|---|
| Discloses a payment address | yes, the account address | no |
| Linkable across sites | yes, one address everywhere | no, independent key per domain |
| Survives device loss | yes, from seed | yes, from seed |
| Proves control of funds | yes | no, use the memo challenge |
| New wallet code to review | no, `personal_sign` already shipped | yes, a new key tree from the seed |

### What a verifier actually learns

Only that the signer holds the Ed25519 key named by the `siwz1…` subject, for
this domain and this nonce. Verification does **not** prove the key was derived
from a Zcash seed, or from any seed: `verifySiwzDomainSignature` checks a
signature against the public key embedded in the identity, and any page can
generate such a keypair.

So the Zcash part of this is a wallet property, not a verifier guarantee. What
the user gets is that one seed reproduces their identity at every site, on every
device, forever, with nothing to back up. What the verifier gets is a stable
pseudonym. This is the same bargain as a passkey.

When a verifier needs proof that the user controls funds at a specific Zcash
address, that is a different question, and SIWZ answers it with the
[memo challenge](./memo-challenge.md).

## Derivation

`seed` MUST be the **64-byte BIP 39 binary seed**, the PBKDF2 output over the
wallet's mnemonic. Any other length MUST be rejected.

That is pinned deliberately. A BIP 39 seed is 64 bytes and a ZIP 32 seed may be
32, so a rule like "at least 32 bytes" would let two correct wallets derive
different identities from one mnemonic. A wallet holding only a spending key,
with no mnemonic, cannot derive SIWZ domain keys.

`account` is the wallet's account index, a uint32, default 0, so that two
accounts in one wallet present different identities to the same site.

```
normalized = normalize(domain)              // host[:port], see below
root       = BLAKE2b-256(seed,              personal = "SIWZ_Root_v1____")
secretKey  = BLAKE2b-256(BE32(account) || utf8(normalized),
                         key = root,        personal = "SIWZ_Domain_v1__")
publicKey  = Ed25519-public(secretKey)
identity   = bech32m("siwz", publicKey)
```

`BE32` is a four-byte big-endian encoding. Both personalisation strings are
exactly 16 bytes, the BLAKE2b limit that ZIP 32 also works within.

This is a BLAKE2b tree of its own, **not** a ZIP 32 hardened path. It borrows
ZIP 32's technique of personalising BLAKE2b per key type, which is what makes
this tree independent of every other key derived from the same seed: a SIWZ key
cannot be used to derive, or be derived from, a spending key.

`normalize(domain)` takes a **bare authority**, `host` or `host:port`, the same
grammar as the `domain` field of a SIWZ message. It lower-cases the host,
removes a trailing dot, and strips an explicit `:80` or `:443`. A non-default
port is retained, so `localhost:3000` and `localhost:5173` are distinct
identities.

Anything else MUST be rejected, not cleaned up. A scheme, path, userinfo or
wildcard is an error, because normalising `https://example.com` instead of
rejecting it is how one site ends up with two identities. Normalisation is
mandatory for the same reason.

The domain is the verifier's authority as the wallet displays it, and it MUST
match the `domain` field of the message being signed.

## Identity encoding

`identity` is the bech32m encoding of the 32-byte Ed25519 public key under the
human-readable prefix `siwz`, for example:

```
siwz1wvml5jn7xfnepcxvdcdk6u3x4mpcxfh3smk7pxzfxljty4eve8qshrsy7f
```

The identity carries no network, because it is not an on-chain object. The same
seed yields the same identity on mainnet and testnet. The public key is carried
in full, so a verifier needs no registry, no lookup and no second field: the
identity *is* the verification key.

## Message

The SIWZ message is the EIP-4361 layout with `Network:` in place of
`Chain ID:`, and the subject line on line 2 holds the identity instead of an
address:

```
example.com wants you to sign in with your Zcash account:
siwz1wvml5jn7xfnepcxvdcdk6u3x4mpcxfh3smk7pxzfxljty4eve8qshrsy7f

Sign in to Example. This does not move funds.

URI: https://example.com/login
Version: 1
Network: mainnet
Nonce: abcdefgh12345678
Issued At: 2026-10-20T00:00:00Z
```

`SiwzMessage` accepts either subject form and reports which via
`subjectType: "address" | "siwz-id"`. Parsing round-trips exactly.

## Signing

The signed payload is the message bytes prefixed with a fixed domain separator:

```
payload   = utf8("SIWZ-domain-key-v1:\n" + message)
signature = Ed25519-sign(payload, secretKey)
```

The signature is transported base64-encoded, 64 bytes decoded.

The prefix exists so that a SIWZ signature can never be valid in another
context, and so that no other signature a wallet produces can be replayed as a
sign-in. A wallet MUST NOT sign a payload that lacks it.

A wallet MUST display, before signing: the domain, the statement if present, and
the fact that no funds move. A wallet SHOULD show that the identity is unique to
this site.

## Verification

```ts
import { verifyMessage } from "@siwz/core";

const res = await verifyMessage(message, signatureBase64, {
  expectedDomain: "example.com",
  expectedNonce: storedNonce,
});
// res.valid, res.address (the identity), res.addressType === "siwz-id"
```

The verifier checks, in order: the message parses, the domain matches, the nonce
matches the one it issued, the message is within its validity window, and the
signature verifies against the identity on the subject line. The session subject
is the identity.

## Security considerations

**Domain binding is what prevents cross-site replay.** The domain is inside the
signed bytes, so a signature produced for `a.example` fails verification at
`b.example`. The verifier MUST pass `expectedDomain`.

**Nonce replay is the verifier's responsibility.** A nonce MUST be
server-issued, single-use, and recorded as consumed on first successful
verification. The library checks that the nonce in the message matches the one
supplied; it cannot know whether that nonce was already spent.

**Unlinkability is enforced by the wallet, not the verifier.** A verifier cannot
tell whether the key it received was really derived for its own domain. A wallet
that reuses one key across sites produces valid signatures and forfeits only its
own user's unlinkability. This is acceptable: the property protects the user, and
the user chooses the wallet.

**This is not proof of funds, reserves, or address ownership.** A SIWZ identity
says nothing about any balance or any address. Do not use it to authorise
payouts, prove reserves, or bind an invoice to a payer.

**Derivation inputs are frozen as of this draft.** The seed length, the account
encoding and the domain grammar are the three places where two correct
implementations could silently disagree, so they are pinned above and covered by
the vectors. Any change to them is a new version string, not a patch.

**Seed compromise is identity compromise**, as with any seed-derived key. There
is no per-domain revocation in v1. A user who needs to drop an identity must
move to a new seed, or the verifier must support rebinding to a new identity
through its own account recovery.

**Ed25519 is not used for Zcash consensus keys**, so a SIWZ key cannot be
confused with, or substituted for, a spending or viewing key.

## Wallet implementation checklist

1. Normalise the requesting origin to `host[:port]`, and reject anything else.
2. Derive `secretKey` with the two personalised BLAKE2b steps above, using the
   64-byte BIP 39 seed and the account index.
3. Reproduce every case in
   `packages/siwz-core/tests/vectors/siwz-domain-key-v1.json`. The vectors fix
   the seed, so `identity`, `secretKeyHex` and `signatureBase64` must match byte
   for byte.
4. Show the domain and statement, and make clear that signing moves no funds.
5. Sign the prefixed payload and return `{ signature, identity }`.
6. Never return the secret key, the seed, or a viewing key.

## Relationship to ZIP 322

This is not a competing proposal. ZIP 322 is the right home for a general Zcash
signed-message format, and if it specifies something that subsumes this, SIWZ
should adopt it and keep domain-key signatures as the no-new-crypto path for
wallets that have not implemented it.

The argument worth carrying into that discussion is the one above: for sign-in,
the signed subject should not be a payment address.
