import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SIWZ_SEED_BYTES,
  SIWZ_SIGNING_PREFIX,
  SiwzMessage,
  decodeSiwzIdentity,
  deriveSiwzDomainKey,
  encodeSiwzIdentity,
  isSiwzIdentity,
  normalizeSiwzDomain,
  signSiwzMessage,
  verifyMessage,
  verifySiwzDomainSignature,
} from "../src/index.js";
import { FIXED_PRIV, deriveMainnetP2pkh } from "./helpers.js";

const SEED = new Uint8Array(64);
for (let i = 0; i < SEED.length; i++) SEED[i] = i;

function message(overrides: Partial<ConstructorParameters<typeof SiwzMessage>[0]> = {}) {
  return new SiwzMessage({
    domain: "example.com",
    address: deriveSiwzDomainKey(SEED, "example.com").identity,
    uri: "https://example.com/login",
    network: "mainnet",
    nonce: "abcdefgh12345678",
    issuedAt: "2026-10-20T00:00:00Z",
    ...overrides,
  });
}

describe("domain-scoped derivation", () => {
  it("is deterministic for the same seed and domain", () => {
    const a = deriveSiwzDomainKey(SEED, "example.com");
    const b = deriveSiwzDomainKey(SEED, "example.com");
    expect(a.identity).toBe(b.identity);
    expect(a.secretKey).toEqual(b.secretKey);
  });

  it("produces unlinkable identities across domains", () => {
    const a = deriveSiwzDomainKey(SEED, "example.com");
    const b = deriveSiwzDomainKey(SEED, "other.example");
    expect(a.identity).not.toBe(b.identity);
  });

  it("produces different identities for different seeds", () => {
    const other = new Uint8Array(64).fill(9);
    expect(deriveSiwzDomainKey(SEED, "example.com").identity).not.toBe(
      deriveSiwzDomainKey(other, "example.com").identity,
    );
  });

  it("accepts the authority forms a SIWZ message can carry", () => {
    expect(normalizeSiwzDomain("sub.example.co.uk")).toBe("sub.example.co.uk");
    expect(normalizeSiwzDomain("localhost")).toBe("localhost");
    expect(normalizeSiwzDomain("127.0.0.1:8080")).toBe("127.0.0.1:8080");
  });

  it("normalises host case and default ports", () => {
    expect(normalizeSiwzDomain("Example.COM")).toBe("example.com");
    expect(normalizeSiwzDomain("example.com:443")).toBe("example.com");
    expect(normalizeSiwzDomain("example.com:80")).toBe("example.com");
    expect(normalizeSiwzDomain("example.com.")).toBe("example.com");
    expect(normalizeSiwzDomain("localhost:3000")).toBe("localhost:3000");
  });

  it("derives the same key regardless of domain casing", () => {
    expect(deriveSiwzDomainKey(SEED, "EXAMPLE.com").identity).toBe(
      deriveSiwzDomainKey(SEED, "example.com").identity,
    );
  });

  it("requires exactly the 64-byte BIP 39 seed", () => {
    // A 32-byte ZIP 32 seed must be rejected rather than silently hashed:
    // accepting both lengths would let two correct wallets disagree.
    expect(() => deriveSiwzDomainKey(new Uint8Array(32), "example.com")).toThrow(/64 bytes/);
    expect(() => deriveSiwzDomainKey(new Uint8Array(16), "example.com")).toThrow(/64 bytes/);
    expect(() => deriveSiwzDomainKey(new Uint8Array(65), "example.com")).toThrow(/64 bytes/);
    expect(SIWZ_SEED_BYTES).toBe(64);
  });

  it("separates wallet accounts", () => {
    const a0 = deriveSiwzDomainKey(SEED, "example.com", 0);
    const a1 = deriveSiwzDomainKey(SEED, "example.com", 1);
    expect(a0.identity).not.toBe(a1.identity);
    expect(a0.account).toBe(0);
    expect(deriveSiwzDomainKey(SEED, "example.com").identity).toBe(a0.identity);
  });

  it("rejects an invalid account index", () => {
    expect(() => deriveSiwzDomainKey(SEED, "example.com", -1)).toThrow(/uint32/);
    expect(() => deriveSiwzDomainKey(SEED, "example.com", 1.5)).toThrow(/uint32/);
    expect(() => deriveSiwzDomainKey(SEED, "example.com", 0x1_0000_0000)).toThrow(/uint32/);
  });

  it("rejects a URL or anything that is not a bare authority", () => {
    for (const bad of [
      "https://example.com",
      "http://example.com",
      "example.com/login",
      "example.com:443/x",
      "user@example.com",
      "*.example.com",
      "example..com",
      "-example.com",
      "example.com:0",
      "example.com:99999",
      "example.com:abc",
    ]) {
      expect(() => normalizeSiwzDomain(bad), bad).toThrow();
    }
  });
});

describe("identity encoding", () => {
  it("round-trips a public key", () => {
    const { publicKey, identity } = deriveSiwzDomainKey(SEED, "example.com");
    expect(identity.startsWith("siwz1")).toBe(true);
    expect(decodeSiwzIdentity(identity)).toEqual(publicKey);
  });

  it("rejects a corrupted checksum", () => {
    const { identity } = deriveSiwzDomainKey(SEED, "example.com");
    const broken = identity.slice(0, -1) + (identity.endsWith("q") ? "p" : "q");
    expect(isSiwzIdentity(broken)).toBe(false);
  });

  it("rejects the wrong prefix and non-identities", () => {
    expect(isSiwzIdentity("u1abcdef")).toBe(false);
    expect(isSiwzIdentity(deriveMainnetP2pkh(FIXED_PRIV).address)).toBe(false);
    expect(isSiwzIdentity("")).toBe(false);
  });

  it("rejects a key of the wrong length", () => {
    expect(() => encodeSiwzIdentity(new Uint8Array(31))).toThrow(/32 bytes/);
  });
});

describe("sign and verify", () => {
  it("verifies a signature it produced", () => {
    const key = deriveSiwzDomainKey(SEED, "example.com");
    const msg = message().toString();
    const sig = signSiwzMessage(msg, key.secretKey);
    expect(verifySiwzDomainSignature(msg, sig, key.identity)).toEqual({ valid: true });
  });

  it("rejects a signature from another domain's key", () => {
    const msg = message().toString();
    const other = deriveSiwzDomainKey(SEED, "other.example");
    const sig = signSiwzMessage(msg, other.secretKey);
    const res = verifySiwzDomainSignature(msg, sig, message().address);
    expect(res.valid).toBe(false);
  });

  it("rejects a tampered message", () => {
    const key = deriveSiwzDomainKey(SEED, "example.com");
    const sig = signSiwzMessage(message().toString(), key.secretKey);
    const tampered = message({ nonce: "zzzzzzzz87654321" }).toString();
    expect(verifySiwzDomainSignature(tampered, sig, key.identity).valid).toBe(false);
  });

  it("rejects a signature over the unprefixed message", () => {
    const key = deriveSiwzDomainKey(SEED, "example.com");
    const msg = message().toString();
    // Signing the raw message, without SIWZ_SIGNING_PREFIX, must not verify.
    const raw = signSiwzMessage(msg.slice(0), key.secretKey);
    expect(verifySiwzDomainSignature(SIWZ_SIGNING_PREFIX + msg, raw, key.identity).valid).toBe(false);
  });

  it("reports malformed signatures and identities distinctly", () => {
    const key = deriveSiwzDomainKey(SEED, "example.com");
    const msg = message().toString();
    const bad = verifySiwzDomainSignature(msg, "!!!not-base64!!!", key.identity);
    expect(bad.valid).toBe(false);
    if (!bad.valid) expect(bad.error).toBe("INVALID_SIGNATURE");

    const shortSig = verifySiwzDomainSignature(msg, "YWJj", key.identity);
    if (!shortSig.valid) expect(shortSig.errorMessage).toMatch(/64 bytes/);

    const badId = verifySiwzDomainSignature(msg, signSiwzMessage(msg, key.secretKey), "siwz1notreal");
    if (!badId.valid) expect(badId.error).toBe("INVALID_ADDRESS");
  });
});

describe("message integration", () => {
  it("accepts a SIWZ identity as the subject and round-trips", () => {
    const msg = message();
    expect(msg.subjectType).toBe("siwz-id");
    expect(SiwzMessage.parse(msg.toString()).toString()).toBe(msg.toString());
  });

  it("still reports a Zcash address subject as an address", () => {
    const { address } = deriveMainnetP2pkh(FIXED_PRIV);
    expect(message({ address }).subjectType).toBe("address");
  });

  it("does not network-check an identity subject", () => {
    expect(() => message({ network: "testnet" })).not.toThrow();
  });

  it("verifies end to end through verifyMessage", async () => {
    const key = deriveSiwzDomainKey(SEED, "example.com");
    const msg = message().toString();
    const res = await verifyMessage(msg, signSiwzMessage(msg, key.secretKey), {
      expectedDomain: "example.com",
      expectedNonce: "abcdefgh12345678",
      now: new Date("2026-10-20T00:01:00Z"),
    });
    expect(res.valid).toBe(true);
    expect(res.addressType).toBe("siwz-id");
    expect(res.address).toBe(key.identity);
  });

  it("rejects a domain mismatch before checking the signature", async () => {
    const key = deriveSiwzDomainKey(SEED, "example.com");
    const msg = message().toString();
    const res = await verifyMessage(msg, signSiwzMessage(msg, key.secretKey), {
      expectedDomain: "evil.example",
      now: new Date("2026-10-20T00:01:00Z"),
    });
    expect(res.valid).toBe(false);
    expect(res.error).toBe("DOMAIN_MISMATCH");
  });

  it("rejects an expired message", async () => {
    const key = deriveSiwzDomainKey(SEED, "example.com");
    const msg = message({ expirationTime: "2026-10-20T00:10:00Z" }).toString();
    const res = await verifyMessage(msg, signSiwzMessage(msg, key.secretKey), {
      now: new Date("2026-10-20T01:00:00Z"),
    });
    expect(res.valid).toBe(false);
    expect(res.error).toBe("EXPIRED");
  });
});

describe("published test vectors", () => {
  const vectors = JSON.parse(
    readFileSync(join(__dirname, "..", "vectors", "siwz-domain-key-v1.json"), "utf8"),
  ) as {
    seedHex: string;
    cases: {
      domain: string;
      account: number;
      identity: string;
      secretKeyHex: string;
      message: string;
      signatureBase64: string;
    }[];
  };

  const seed = Uint8Array.from(Buffer.from(vectors.seedHex, "hex"));

  it("pins the 64-byte seed", () => {
    expect(seed.length).toBe(SIWZ_SEED_BYTES);
  });

  it.each(vectors.cases)("reproduces the vector for $domain account $account", (c) => {
    const key = deriveSiwzDomainKey(seed, c.domain, c.account);
    expect(key.identity).toBe(c.identity);
    expect(Buffer.from(key.secretKey).toString("hex")).toBe(c.secretKeyHex);
    expect(signSiwzMessage(c.message, key.secretKey)).toBe(c.signatureBase64);
    expect(verifySiwzDomainSignature(c.message, c.signatureBase64, c.identity)).toEqual({
      valid: true,
    });
  });
});
