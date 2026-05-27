import { execFile } from "node:child_process";
import { promisify } from "node:util";

/**
 * Minimal JSON-RPC client for the Zcash daemon family (zcashd / zaino /
 * zallet). Two transports, picked in this order:
 *
 *   1. HTTP JSON-RPC — when ZCASH_RPC_URL is set. Production-shaped:
 *      works across machines, doesn't need the binary on the Node host.
 *      Uses Basic auth (ZCASH_RPC_USER + ZCASH_RPC_PASS) or a cookie
 *      string (ZCASH_RPC_COOKIE) if provided.
 *   2. zcash-cli shell-out — when ZCASH_CLI_PATH points to the binary
 *      (or it's discoverable as `zcash-cli` in PATH). Uses the daemon's
 *      cookie auth implicitly. Useful for local dev when the daemon
 *      and Node server are on the same machine.
 *
 * Failure modes that matter to the caller (so they can surface friendly
 * messages) are tagged via `ZcashRpcError.code`:
 *
 *   - "not-configured"   neither transport was selected (no env vars set)
 *   - "transport"        network/process error talking to the daemon
 *   - "auth"             401 / cookie mismatch
 *   - "rpc"              the daemon returned a JSON-RPC error object
 *   - "method-not-found" the daemon doesn't implement this RPC (we use
 *                        this to fall back from z_listreceivedbyaddress
 *                        to z_listunspent + per-tx decode)
 */

export type ZcashRpcErrorCode =
  | "not-configured"
  | "transport"
  | "auth"
  | "rpc"
  | "method-not-found";

export class ZcashRpcError extends Error {
  readonly code: ZcashRpcErrorCode;
  readonly rpcCode?: number;
  constructor(code: ZcashRpcErrorCode, message: string, rpcCode?: number) {
    super(message);
    this.name = "ZcashRpcError";
    this.code = code;
    this.rpcCode = rpcCode;
  }
}

export interface ZcashRpcConfig {
  url?: string;
  user?: string;
  pass?: string;
  /** Optional cookie body — used if user/pass not provided. */
  cookie?: string;
  /** Optional override for the CLI path. Default: "zcash-cli" in PATH. */
  cliPath?: string;
}

const exec = promisify(execFile);

export class ZcashRpcClient {
  private readonly transport: "http" | "cli" | "none";

  constructor(private readonly cfg: ZcashRpcConfig) {
    if (cfg.url) this.transport = "http";
    else if (cfg.cliPath || hasCliInPath()) this.transport = "cli";
    else this.transport = "none";
  }

  static fromEnv(): ZcashRpcClient {
    return new ZcashRpcClient({
      url: process.env.ZCASH_RPC_URL,
      user: process.env.ZCASH_RPC_USER,
      pass: process.env.ZCASH_RPC_PASS,
      cookie: process.env.ZCASH_RPC_COOKIE,
      cliPath: process.env.ZCASH_CLI_PATH,
    });
  }

  get isConfigured(): boolean {
    return this.transport !== "none";
  }

  describe(): string {
    if (this.transport === "http") return `HTTP RPC @ ${this.cfg.url}`;
    if (this.transport === "cli") return `zcash-cli @ ${this.cfg.cliPath ?? "PATH"}`;
    return "not configured (set ZCASH_RPC_URL or install zcash-cli)";
  }

  async call<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
    if (this.transport === "http") return this.callHttp<T>(method, params);
    if (this.transport === "cli") return this.callCli<T>(method, params);
    throw new ZcashRpcError(
      "not-configured",
      "Zcash RPC is not configured. Set ZCASH_RPC_URL (HTTP) or ZCASH_CLI_PATH / install zcash-cli (shell-out).",
    );
  }

  private async callHttp<T>(method: string, params: unknown[]): Promise<T> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.cfg.user || this.cfg.pass) {
      const auth = Buffer.from(`${this.cfg.user ?? ""}:${this.cfg.pass ?? ""}`).toString("base64");
      headers["authorization"] = `Basic ${auth}`;
    } else if (this.cfg.cookie) {
      // Cookie auth: zcashd writes "__cookie__:<random>" to ~/.zcash/.cookie
      const auth = Buffer.from(this.cfg.cookie).toString("base64");
      headers["authorization"] = `Basic ${auth}`;
    }

    let res;
    try {
      res = await fetch(this.cfg.url!, {
        method: "POST",
        headers,
        body: JSON.stringify({ jsonrpc: "1.0", id: "siwz", method, params }),
      });
    } catch (err) {
      throw new ZcashRpcError("transport", `HTTP request failed: ${(err as Error).message}`);
    }

    if (res.status === 401 || res.status === 403) {
      throw new ZcashRpcError("auth", `daemon returned ${res.status} — check ZCASH_RPC_USER/PASS or COOKIE`);
    }
    let json: { result?: T; error?: { code: number; message: string } };
    try {
      json = await res.json();
    } catch (err) {
      throw new ZcashRpcError("transport", `non-JSON response (status ${res.status}): ${(err as Error).message}`);
    }
    if (json.error) {
      const isMethodNotFound = json.error.code === -32601 || /method not found|unknown command/i.test(json.error.message);
      throw new ZcashRpcError(
        isMethodNotFound ? "method-not-found" : "rpc",
        `${method}: ${json.error.message}`,
        json.error.code,
      );
    }
    return json.result as T;
  }

  private async callCli<T>(method: string, params: unknown[]): Promise<T> {
    const cli = this.cfg.cliPath ?? "zcash-cli";
    // Stringify each param. JSON values (objects, arrays, numbers, booleans)
    // must be JSON-encoded; string params are passed as-is.
    const args = [method, ...params.map((p) => (typeof p === "string" ? p : JSON.stringify(p)))];
    let stdout: string;
    try {
      const r = await exec(cli, args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
      stdout = r.stdout;
    } catch (err) {
      const e = err as { stderr?: string; message?: string; code?: string };
      const msg = (e.stderr ?? e.message ?? "").trim();
      if (/method not found|unknown command|help: zcash-cli/i.test(msg)) {
        throw new ZcashRpcError("method-not-found", `${method}: ${msg}`);
      }
      if (/cookie|authorization/i.test(msg)) {
        throw new ZcashRpcError("auth", msg);
      }
      throw new ZcashRpcError("transport", `${cli} ${method} failed: ${msg}`);
    }
    const trimmed = stdout.trim();
    if (!trimmed) return undefined as T;
    try {
      return JSON.parse(trimmed) as T;
    } catch {
      // Some RPCs return bare strings/numbers — pass through.
      return trimmed as unknown as T;
    }
  }
}

function hasCliInPath(): boolean {
  // We can't really check PATH synchronously without spawning, and we
  // don't want to do that in a constructor. Use ZCASH_CLI_PATH as the
  // explicit opt-in for CLI mode. Returning false here means HTTP must
  // be configured OR ZCASH_CLI_PATH must be set explicitly.
  return Boolean(process.env.ZCASH_CLI_PATH);
}

/**
 * Decode a hex-encoded Zcash memo as the daemon returns it from
 * z_listreceivedbyaddress / z_viewtransaction.
 *
 * Memos are 512 bytes wide, padded with 0xf6 (and zero bytes) trailing
 * the actual content. We strip the trailing 0xf6 / 0x00 run, then try
 * UTF-8 decoding. Returns null for "empty memo" (all 0xf6 / 0x00).
 */
export function decodeMemoHex(hex: string): string | null {
  if (!hex) return null;
  const clean = hex.replace(/^0x/i, "").toLowerCase();
  if (!/^[0-9a-f]*$/.test(clean) || clean.length === 0) return null;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  // Strip trailing 0xf6/0x00 padding.
  let end = bytes.length;
  while (end > 0 && (bytes[end - 1] === 0xf6 || bytes[end - 1] === 0x00)) end--;
  if (end === 0) return null;
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, end));
  } catch {
    return null;
  }
}
