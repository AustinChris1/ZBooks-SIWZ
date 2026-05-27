#!/usr/bin/env node
/**
 * Detect a running Zcash daemon and print the env vars ZBooks needs.
 *
 *   node scripts/find-zcash-rpc.mjs
 *
 * Walks common config / cookie / binary locations across zcashd, zallet,
 * and zaino. For each thing it finds, prints either:
 *   - the .env line to paste into apps/demo/.env.local, or
 *   - an instruction for what to add to the daemon config.
 *
 * No network calls — purely filesystem inspection. Safe to run any time.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir, platform } from "node:os";
import { join, resolve, sep } from "node:path";

const HOME = homedir();
const PLATFORM = platform();

const banner = (s) => console.log(`\n──── ${s} ────`);
const found = (k, v) => console.log(`  ✓ ${k.padEnd(20)} ${v}`);
const missing = (k) => console.log(`  · ${k}`);
const todo = (s) => console.log(`  → ${s}`);

// 1. Find a binary in PATH (or common install spots).
banner("zcash binary");
const CLI_NAMES = ["zcash-cli", "zcash-cli.exe", "zcash", "zcash.exe", "zaino-cli", "zallet"];
const COMMON_BINS = [
  // Linux package installs
  "/usr/bin", "/usr/local/bin", "/opt/zcash/bin",
  // macOS
  "/usr/local/opt/zcash/bin", "/opt/homebrew/bin",
  // ~/bin / ~/.local/bin
  join(HOME, "bin"), join(HOME, ".local/bin"),
  // Cargo install (common for zallet)
  join(HOME, ".cargo/bin"),
];
const foundBins = [];
for (const dir of COMMON_BINS) {
  for (const name of CLI_NAMES) {
    const p = join(dir, name);
    try {
      if (existsSync(p)) {
        foundBins.push(p);
        found(name, p);
      }
    } catch { /* ignore */ }
  }
}
// Try `which` / `where`
try {
  const cmd = PLATFORM === "win32" ? "where" : "which";
  for (const name of ["zcash-cli", "zcash"]) {
    try {
      const out = execFileSync(cmd, [name], { encoding: "utf8" }).trim().split(/\r?\n/)[0];
      if (out && !foundBins.includes(out)) {
        foundBins.push(out);
        found(`${name} (in PATH)`, out);
      }
    } catch { /* not found */ }
  }
} catch { /* no which/where */ }
if (foundBins.length === 0) {
  missing("no Zcash binary found in common locations");
  todo("Install or note your zcash-cli path manually, then set ZCASH_CLI_PATH=/path/to/zcash-cli");
}

// 2. Find config / cookie files.
banner("daemon config & cookie");
const CONFIG_PATHS = [
  // zcashd
  join(HOME, ".zcash/zcash.conf"),
  join(HOME, "AppData/Roaming/Zcash/zcash.conf"),  // Windows
  join(HOME, "Library/Application Support/Zcash/zcash.conf"),  // macOS
  // zallet — locations evolving; check common dotdirs
  join(HOME, ".zallet/zallet.toml"),
  join(HOME, ".config/zallet/zallet.toml"),
  join(HOME, ".local/share/zallet/config.toml"),
  // zaino
  join(HOME, ".zaino/zainod.toml"),
  join(HOME, ".config/zaino/zainod.toml"),
];
const COOKIE_PATHS = [
  join(HOME, ".zcash/.cookie"),
  join(HOME, "AppData/Roaming/Zcash/.cookie"),
  join(HOME, "Library/Application Support/Zcash/.cookie"),
];

let foundConfig = null;
for (const p of CONFIG_PATHS) {
  try {
    if (existsSync(p)) {
      const sz = statSync(p).size;
      found(`config`, `${p}  (${sz} bytes)`);
      foundConfig = p;
    }
  } catch { /* ignore */ }
}
if (!foundConfig) missing("no daemon config found");

let foundCookie = null;
for (const p of COOKIE_PATHS) {
  try {
    if (existsSync(p)) {
      const body = readFileSync(p, "utf8").trim();
      found(`cookie`, `${p}`);
      foundCookie = body;
    }
  } catch { /* ignore */ }
}
if (!foundCookie) missing("no cookie file (daemon may not be running, or uses rpcuser/rpcpassword instead)");

// 3. Parse zcash.conf for RPC settings.
banner("HTTP RPC config");
let rpcUser, rpcPass, rpcPort = "8232", rpcAllow;
if (foundConfig && foundConfig.endsWith("zcash.conf")) {
  const text = readFileSync(foundConfig, "utf8");
  const grab = (key) => {
    const m = text.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+?)\\s*$`, "m"));
    return m ? m[1] : null;
  };
  rpcUser = grab("rpcuser");
  rpcPass = grab("rpcpassword");
  rpcPort = grab("rpcport") ?? rpcPort;
  rpcAllow = grab("rpcallowip");
  const server = grab("server");
  if (server) found("server", server);
  if (rpcAllow) found("rpcallowip", rpcAllow);
  if (rpcPort) found("rpcport", rpcPort);
  if (rpcUser) found("rpcuser", rpcUser);
  if (rpcPass) found("rpcpassword", "<set>");
  if (!server || server !== "1") {
    todo(`zcash.conf is missing "server=1" — the daemon won't accept RPC. Add it then restart.`);
  }
} else if (foundConfig) {
  console.log(`  config is at ${foundConfig} but auto-parsing toml not implemented;`);
  console.log(`  open it and look for an [rpc] section with bind / username / password fields.`);
}

// 4. Print ZBooks env vars.
banner("Suggested apps/demo/.env.local additions");
console.log();
if (rpcUser && rpcPass) {
  console.log(`# HTTP RPC with user/pass (recommended)`);
  console.log(`ZCASH_RPC_URL=http://127.0.0.1:${rpcPort}`);
  console.log(`ZCASH_RPC_USER=${rpcUser}`);
  console.log(`ZCASH_RPC_PASS=${rpcPass}`);
} else if (foundCookie) {
  console.log(`# HTTP RPC with cookie auth`);
  console.log(`ZCASH_RPC_URL=http://127.0.0.1:${rpcPort}`);
  console.log(`ZCASH_RPC_COOKIE=${foundCookie}`);
  console.log(`# (the cookie rotates every daemon restart; rerun this script if RPC stops working)`);
} else if (foundBins.length > 0) {
  console.log(`# CLI shell-out (simplest, no config edits needed)`);
  const cli = foundBins.find((b) => b.endsWith("zcash-cli") || b.endsWith("zcash-cli.exe")) ?? foundBins[0];
  console.log(`ZCASH_CLI_PATH=${cli}`);
} else {
  console.log(`# No transport detected. Either:`);
  console.log(`# 1. Start zcashd/zallet (it should write a .cookie file we can use), or`);
  console.log(`# 2. Edit ~/.zcash/zcash.conf to add:`);
  console.log(`#      server=1`);
  console.log(`#      rpcuser=zbooks`);
  console.log(`#      rpcpassword=<long-random-password>`);
  console.log(`#      rpcallowip=127.0.0.1`);
  console.log(`#    Then restart the daemon.`);
}

// 5. Sanity-test against a running daemon if we have transport details.
banner("Test the connection");
if (foundBins.length > 0) {
  const cli = foundBins.find((b) => b.includes("zcash-cli")) ?? foundBins[0];
  try {
    const out = execFileSync(cli, ["getblockchaininfo"], { encoding: "utf8", timeout: 5_000 });
    const info = JSON.parse(out);
    found("blocks", info.blocks);
    found("chain", info.chain);
    found("status", "daemon is up and reachable via CLI ✓");
  } catch (err) {
    console.log(`  ✗ Could not query the daemon via ${cli}:`);
    console.log(`    ${(err.stderr ?? err.message ?? "").toString().split("\n")[0]}`);
    console.log(`  → Make sure the daemon is running. For zcashd:  zcashd -daemon`);
  }
}

console.log();
console.log("Done. Paste the env vars above into apps/demo/.env.local and restart `pnpm dev:zbooks`.\n");
