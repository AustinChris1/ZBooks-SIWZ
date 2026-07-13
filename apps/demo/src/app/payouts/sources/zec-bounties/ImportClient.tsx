"use client";

import { useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useRouter } from "next/navigation";
import {
  resolveAssignee,
  type BountyBlockReason,
  type BountyImportCandidate,
} from "@/lib/zec-bounties";

interface Props {
  payable: BountyImportCandidate[];
  pickable: BountyImportCandidate[];
  blocked: BountyImportCandidate[];
  zbooksNetwork: string;
  draftRuns: { id: string; title: string }[];
  keys: { id: string; label: string }[];
}

type TargetMode = "new" | "existing";
type Tone = "green" | "amber" | "sky" | "neutral" | "red";

const REASON_ORDER: BountyBlockReason[] = [
  "in_progress",
  "not_approved",
  "already_paid",
  "multi_assignee",
  "no_assignee",
  "no_address",
  "amount_zero",
  "network_mismatch",
  "address_unknown",
  "cancelled",
];

const REASON_HEADING: Record<BountyBlockReason, string> = {
  payable: "Ready to pay",
  needs_assignee_pick: "Pick a payee",
  in_progress: "Work in progress",
  not_approved: "Not yet approved",
  already_paid: "Already paid upstream",
  multi_assignee: "Multiple assignees, none with a usable address",
  no_assignee: "No assignee set",
  no_address: "Assignee has no address on file",
  amount_zero: "Amount is zero",
  network_mismatch: "Wrong network",
  address_unknown: "Unrecognised address format",
  cancelled: "Cancelled upstream",
};

const REASON_TONE: Record<BountyBlockReason, Tone> = {
  payable: "green",
  needs_assignee_pick: "amber",
  in_progress: "neutral",
  not_approved: "amber",
  already_paid: "green",
  multi_assignee: "amber",
  no_assignee: "amber",
  no_address: "amber",
  amount_zero: "red",
  network_mismatch: "amber",
  address_unknown: "red",
  cancelled: "neutral",
};

const STATUS_STYLE: Record<string, string> = {
  DONE: "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900/50",
  IN_REVIEW: "bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900/50",
  IN_PROGRESS: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900/50",
  TO_DO: "bg-neutral-100 text-neutral-500 border-neutral-200 dark:bg-neutral-800 dark:text-neutral-400 dark:border-neutral-700",
  CANCELLED: "bg-neutral-100 text-neutral-400 border-neutral-200 dark:bg-neutral-800/50 dark:text-neutral-500 dark:border-neutral-800",
};

const TONE_DOT: Record<Tone, string> = {
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  sky: "bg-sky-500",
  neutral: "bg-neutral-400 dark:bg-neutral-500",
  red: "bg-red-500",
};

const TONE_ACCENT: Record<Tone, string> = {
  green: "before:bg-emerald-500",
  amber: "before:bg-amber-500",
  sky: "before:bg-sky-500",
  neutral: "before:bg-neutral-400 dark:before:bg-neutral-600",
  red: "before:bg-red-500",
};

function displayAssignee(c: BountyImportCandidate): { name: string; address?: string } {
  const auto = resolveAssignee(c.bounty);
  if (auto && auto !== "multi") {
    return {
      name: auto.name ?? "(no name)",
      address: c.payoutAddress ?? auto.UA_address ?? auto.z_address ?? undefined,
    };
  }
  return { name: c.bounty.assigneeUser?.name ?? "(unassigned)" };
}

const zec = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 8 });

export function ImportClient({ payable, pickable, blocked, zbooksNetwork, draftRuns, keys }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [targetMode, setTargetMode] = useState<TargetMode>("new");
  const [newTitle, setNewTitle] = useState(`ZecBounties · ${new Date().toISOString().slice(0, 10)}`);
  const [sourceUfvkId, setSourceUfvkId] = useState<string>(keys[0]?.id ?? "");
  const [existingRunId, setExistingRunId] = useState<string>(draftRuns[0]?.id ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === payable.length) setSelected(new Set());
    else setSelected(new Set(payable.map((c) => c.bounty.id)));
  };

  const setPick = (bountyId: string, userId: string) => {
    setPicks((prev) => ({ ...prev, [bountyId]: userId }));
    if (!userId) {
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(bountyId);
        return next;
      });
    }
  };

  const total = useMemo(() => {
    let sum = 0;
    for (const c of payable) if (selected.has(c.bounty.id)) sum += c.bounty.bountyAmount;
    for (const c of pickable) {
      if (selected.has(c.bounty.id) && picks[c.bounty.id]) sum += c.bounty.bountyAmount;
    }
    return sum;
  }, [payable, pickable, selected, picks]);

  const grouped = useMemo(() => {
    const map = new Map<BountyBlockReason, BountyImportCandidate[]>();
    for (const c of blocked) {
      const arr = map.get(c.reason) ?? [];
      arr.push(c);
      map.set(c.reason, arr);
    }
    return REASON_ORDER.filter((r) => map.has(r)).map((r) => ({
      reason: r,
      items: map.get(r)!,
    }));
  }, [blocked]);

  const scrollToImport = () => {
    document.getElementById("import-target")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const submit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const target =
        targetMode === "existing" && existingRunId
          ? { type: "existing" as const, runId: existingRunId }
          : { type: "new" as const, title: newTitle, sourceUfvkId: sourceUfvkId || undefined };
      const assigneeOverrides: Record<string, string> = {};
      for (const id of selected) if (picks[id]) assigneeOverrides[id] = picks[id]!;
      const res = await fetch("/api/payouts/import-zec-bounties", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          bountyIds: Array.from(selected),
          assigneeOverrides,
          target,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        runId?: string;
        added?: number;
        skipped?: { id: string; reason: string }[];
      };
      if (!res.ok) {
        setError(json.error ?? `HTTP ${res.status}`);
        return;
      }
      router.push(`/payouts/${json.runId}`);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-8 pb-28">
      <StatsHeader
        payable={payable.length}
        pickable={pickable.length}
        blocked={blocked.length}
        network={zbooksNetwork}
      />

      <section className="flex flex-col gap-3">
        <SectionHeader tone="green" title="Ready to pay" count={payable.length}>
          {payable.length > 0 && (
            <button
              type="button"
              onClick={toggleAll}
              className="text-xs rounded-md border border-neutral-200 dark:border-neutral-800 hover:border-zcash-yellow/60 px-2.5 py-1 text-neutral-600 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-white transition-colors"
            >
              {selected.size === payable.length ? "Deselect all" : "Select all"}
            </button>
          )}
        </SectionHeader>

        {payable.length === 0 ? (
          <EmptyState
            title="Nothing ready to pay right now"
            body={
              <>
                Looking for bounties with status <StatusChip status="IN_PROGRESS" />{" "}
                <StatusChip status="IN_REVIEW" /> <StatusChip status="DONE" />, not yet paid, with
                a single assignee reachable on <NetChip network={zbooksNetwork} />.
                {pickable.length > 0 && (
                  <div className="pt-2 text-xs text-neutral-500">
                    {pickable.length} multi-assignee bount{pickable.length === 1 ? "y is" : "ies are"} still resolvable below.
                  </div>
                )}
              </>
            }
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {payable.map((c, i) => (
              <motion.li
                key={c.bounty.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: Math.min(i * 0.025, 0.35) }}
              >
                <PayableCard
                  candidate={c}
                  checked={selected.has(c.bounty.id)}
                  onToggle={() => toggle(c.bounty.id)}
                />
              </motion.li>
            ))}
          </ul>
        )}
      </section>

      {pickable.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionHeader tone="amber" title="Pick a payee" count={pickable.length} />
          <p className="text-xs text-neutral-500 -mt-1 leading-relaxed max-w-2xl">
            These bounties have multiple assignees. Choose one payee per bounty and check the box
            to include it. The full amount goes to the picked address.
          </p>
          <ul className="flex flex-col gap-2">
            {pickable.map((c, i) => (
              <motion.li
                key={c.bounty.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: Math.min(i * 0.025, 0.35) }}
              >
                <PickableCard
                  candidate={c}
                  checked={selected.has(c.bounty.id)}
                  chosen={picks[c.bounty.id] ?? ""}
                  onToggle={() => toggle(c.bounty.id)}
                  onPick={(uid) => setPick(c.bounty.id, uid)}
                />
              </motion.li>
            ))}
          </ul>
        </section>
      )}

      <AnimatePresence>
        {selected.size > 0 && (
          <motion.div
            id="import-target"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.3 }}
            className="relative rounded-2xl border border-zcash-yellow/40 bg-gradient-to-br from-white to-zcash-yellow/[0.04] dark:from-neutral-950 dark:to-zcash-yellow/[0.05] shadow-[0_20px_60px_-30px_rgba(244,183,40,0.4)] dark:shadow-[0_20px_60px_-20px_rgba(244,183,40,0.25)] p-5 flex flex-col gap-4"
          >
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-baseline gap-4">
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-neutral-500">
                    Selected
                  </div>
                  <div className="text-2xl font-semibold tabular-nums">{selected.size}</div>
                </div>
                <div className="h-8 w-px bg-neutral-200 dark:bg-neutral-800" />
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-neutral-500">
                    Total
                  </div>
                  <motion.div
                    key={total}
                    initial={{ scale: 1.05, color: "#f4b728" }}
                    animate={{ scale: 1, color: "" }}
                    transition={{ duration: 0.3 }}
                    className="text-2xl font-semibold font-mono tabular-nums"
                  >
                    {zec(total)}{" "}
                    <span className="text-sm text-neutral-500 font-sans">ZEC</span>
                  </motion.div>
                </div>
              </div>
            </div>

            <fieldset className="grid gap-3 sm:grid-cols-2 pt-3 border-t border-neutral-100 dark:border-neutral-800/70">
              <TargetOption
                selected={targetMode === "new"}
                onSelect={() => setTargetMode("new")}
                label="New payout run"
              >
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  disabled={targetMode !== "new"}
                  placeholder="Run title"
                  className="rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 py-1.5 text-sm disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-zcash-yellow/40"
                />
                {keys.length > 0 && (
                  <select
                    value={sourceUfvkId}
                    onChange={(e) => setSourceUfvkId(e.target.value)}
                    disabled={targetMode !== "new"}
                    className="rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 py-1.5 text-sm disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-zcash-yellow/40"
                  >
                    <option value="">No treasury (pick later)</option>
                    {keys.map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.label}
                      </option>
                    ))}
                  </select>
                )}
              </TargetOption>

              {draftRuns.length > 0 ? (
                <TargetOption
                  selected={targetMode === "existing"}
                  onSelect={() => setTargetMode("existing")}
                  label="Append to draft run"
                >
                  <select
                    value={existingRunId}
                    onChange={(e) => setExistingRunId(e.target.value)}
                    disabled={targetMode !== "existing"}
                    className="rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 py-1.5 text-sm disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-zcash-yellow/40"
                  >
                    {draftRuns.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.title}
                      </option>
                    ))}
                  </select>
                </TargetOption>
              ) : (
                <div className="rounded-xl border border-dashed border-neutral-200 dark:border-neutral-800 p-3 text-xs text-neutral-500 flex items-center justify-center text-center">
                  No draft runs yet. A new run will be created.
                </div>
              )}
            </fieldset>

            {error && (
              <div className="text-sm text-red-600 dark:text-red-400 rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 px-3 py-2 flex items-start gap-2">
                <span className="mt-0.5">✕</span>
                <span>{error}</span>
              </div>
            )}

            <div className="flex gap-2 justify-end pt-1">
              <button
                type="button"
                onClick={() => router.push("/payouts")}
                className="rounded-md border border-neutral-200 dark:border-neutral-800 hover:border-neutral-300 dark:hover:border-neutral-700 px-4 py-2 text-sm transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={submitting || selected.size === 0}
                className="rounded-md bg-zcash-yellow text-zcash-dark font-semibold px-4 py-2 text-sm hover:bg-yellow-400 disabled:opacity-60 transition-colors shadow-[0_8px_20px_-8px_rgba(244,183,40,0.6)]"
              >
                {submitting
                  ? "Importing…"
                  : `Import ${selected.size} bount${selected.size === 1 ? "y" : "ies"} →`}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {blocked.length > 0 && (
        <section className="flex flex-col gap-3 pt-2">
          <SectionHeader tone="neutral" title="Other bounties" count={blocked.length} />
          <p className="text-xs text-neutral-500 -mt-1 max-w-2xl">
            These exist upstream but aren&apos;t selectable right now. Grouped by reason.
          </p>

          <div className="flex flex-col gap-2">
            {grouped.map(({ reason, items }) => (
              <details
                key={reason}
                className="group rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/40 dark:bg-neutral-900/20 overflow-hidden"
              >
                <summary className="cursor-pointer select-none px-4 py-3 text-sm flex items-center gap-3 hover:bg-neutral-100/60 dark:hover:bg-neutral-900/40 transition-colors">
                  <span className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[REASON_TONE[reason]]}`} />
                  <span className="font-medium text-neutral-800 dark:text-neutral-200">
                    {REASON_HEADING[reason]}
                  </span>
                  <span className="text-neutral-500">({items.length})</span>
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    className="ml-auto text-neutral-400 transition-transform group-open:rotate-180"
                    aria-hidden
                  >
                    <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </summary>
                <ul className="flex flex-col gap-1 px-2 pb-2">
                  {items.map(({ bounty, network, reasonLabel }) => (
                    <li
                      key={bounty.id}
                      className="rounded-lg bg-white dark:bg-neutral-900/30 border border-neutral-100 dark:border-neutral-800/60 p-3 opacity-80"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium tracking-tight truncate">
                              {bounty.title}
                            </span>
                            <StatusChip status={bounty.status} />
                          </div>
                          <div className="text-[11px] text-neutral-500 pt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                            <span>{bounty.assigneeUser?.name ?? "(unassigned)"}</span>
                            {bounty.categoryId && (
                              <span className="text-neutral-400">{bounty.categoryId}</span>
                            )}
                            <span className="font-mono">{network}</span>
                          </div>
                        </div>
                        <div className="font-mono text-xs tabular-nums whitespace-nowrap text-neutral-500">
                          {zec(bounty.bountyAmount)} ZEC
                        </div>
                      </div>
                      <div className="text-[11px] text-amber-700 dark:text-amber-400/90 pt-1.5">
                        {reasonLabel}
                      </div>
                      {(bounty.assigneeUser?.UA_address || bounty.assigneeUser?.z_address) && (
                        <div className="font-mono text-[10px] text-neutral-400 truncate pt-1">
                          {bounty.assigneeUser?.UA_address || bounty.assigneeUser?.z_address}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
        </section>
      )}

      <AnimatePresence>
        {selected.size > 0 && (
          <motion.button
            type="button"
            onClick={scrollToImport}
            initial={{ y: 60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 60, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="fixed bottom-5 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 rounded-full border border-zcash-yellow/60 bg-white/95 dark:bg-neutral-950/95 backdrop-blur-xl shadow-[0_16px_40px_-12px_rgba(0,0,0,0.35)] dark:shadow-[0_16px_40px_-8px_rgba(0,0,0,0.6)] px-5 py-2.5 text-sm"
          >
            <span className="font-semibold">{selected.size}</span>
            <span className="text-neutral-500">selected</span>
            <span className="h-4 w-px bg-neutral-200 dark:bg-neutral-800" />
            <span className="font-mono tabular-nums">{zec(total)}</span>
            <span className="text-neutral-500 text-xs">ZEC</span>
            <span className="text-zcash-yellow font-semibold">Review ↓</span>
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ─────────────────  Sub-components  ───────────────── */

function StatsHeader({
  payable,
  pickable,
  blocked,
  network,
}: {
  payable: number;
  pickable: number;
  blocked: number;
  network: string;
}) {
  return (
    <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-gradient-to-br from-white to-neutral-50/60 dark:from-neutral-900/60 dark:to-neutral-950/40 p-4 sm:p-5 flex items-center justify-between gap-4 flex-wrap">
      <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
        <StatChip label="Ready" value={payable} tone="green" />
        {pickable > 0 && <StatChip label="Pickable" value={pickable} tone="amber" />}
        <StatChip label="Blocked" value={blocked} tone="neutral" />
      </div>
      <NetChip network={network} />
    </div>
  );
}

function StatChip({ label, value, tone }: { label: string; value: number; tone: Tone }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/50 px-3 py-1.5">
      <span className={`h-2 w-2 rounded-full ${TONE_DOT[tone]}`} />
      <span className="text-sm font-semibold tabular-nums">{value}</span>
      <span className="text-xs text-neutral-500">{label}</span>
    </div>
  );
}

function NetChip({ network }: { network: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-2.5 py-1 text-[11px] font-mono">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
      {network}
    </span>
  );
}

function SectionHeader({
  tone,
  title,
  count,
  children,
}: {
  tone: Tone;
  title: string;
  count: number;
  children?: ReactNode;
}) {
  return (
    <div
      className={`relative pl-4 flex items-baseline justify-between gap-3 flex-wrap
        before:content-[''] before:absolute before:left-0 before:top-0.5 before:bottom-0.5 before:w-1 before:rounded-full ${TONE_ACCENT[tone]}`}
    >
      <h2 className="text-lg font-semibold tracking-tight">
        {title}{" "}
        <span className="font-normal text-neutral-500 text-base">({count})</span>
      </h2>
      {children}
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-neutral-300 dark:border-neutral-700 p-6 bg-neutral-50/30 dark:bg-neutral-900/20 flex flex-col gap-2 text-sm">
      <div className="font-medium text-neutral-700 dark:text-neutral-200">{title}</div>
      <div className="text-neutral-500 leading-relaxed">{body}</div>
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  const style =
    STATUS_STYLE[status] ??
    "bg-neutral-100 text-neutral-500 border-neutral-200 dark:bg-neutral-800 dark:text-neutral-400 dark:border-neutral-700";
  return (
    <span
      className={`text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 border font-medium ${style}`}
    >
      {status}
    </span>
  );
}

function CategoryChip({ category }: { category: string }) {
  return (
    <span className="text-[10px] uppercase tracking-wide rounded-full border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/40 text-neutral-600 dark:text-neutral-400 px-2 py-0.5">
      {category}
    </span>
  );
}

/* ─────────────────  Cards  ───────────────── */

function PayableCard({
  candidate,
  checked,
  onToggle,
}: {
  candidate: BountyImportCandidate;
  checked: boolean;
  onToggle: () => void;
}) {
  const c = candidate;
  const who = displayAssignee(c);
  return (
    <label
      className={`group block rounded-xl border p-4 cursor-pointer transition-all duration-200 ${
        checked
          ? "border-zcash-yellow bg-zcash-yellow/[0.06] shadow-[0_8px_24px_-12px_rgba(244,183,40,0.35)]"
          : "border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/40 hover:border-neutral-300 dark:hover:border-neutral-700 hover:shadow-[0_6px_20px_-14px_rgba(0,0,0,0.3)]"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="relative mt-1 shrink-0">
          <input
            type="checkbox"
            checked={checked}
            onChange={onToggle}
            className="peer h-4 w-4 accent-zcash-yellow cursor-pointer"
          />
        </div>
        <div className="flex-1 min-w-0 flex flex-col gap-1.5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <span className="font-semibold tracking-tight">{c.bounty.title}</span>
              <StatusChip status={c.bounty.status} />
              {c.bounty.categoryId && <CategoryChip category={c.bounty.categoryId} />}
            </div>
            <div className="font-mono text-sm tabular-nums whitespace-nowrap font-semibold">
              {zec(c.bounty.bountyAmount)}{" "}
              <span className="text-neutral-500 font-sans font-normal">ZEC</span>
            </div>
          </div>
          <div className="text-xs text-neutral-500 flex flex-wrap gap-x-3 gap-y-0.5">
            <span className="inline-flex items-center gap-1.5">
              <Avatar name={who.name} /> {who.name}
            </span>
            <span>created {new Date(c.bounty.dateCreated).toLocaleDateString()}</span>
          </div>
          {who.address && (
            <div className="font-mono text-[10px] text-neutral-400 truncate">{who.address}</div>
          )}
        </div>
      </div>
    </label>
  );
}

function PickableCard({
  candidate,
  checked,
  chosen,
  onToggle,
  onPick,
}: {
  candidate: BountyImportCandidate;
  checked: boolean;
  chosen: string;
  onToggle: () => void;
  onPick: (uid: string) => void;
}) {
  const c = candidate;
  const picksList = c.pickableAssignees ?? [];
  const canCheck = !!chosen;
  const chosenAddr = picksList.find((p) => p.userId === chosen)?.z_address;
  return (
    <div
      className={`rounded-xl border p-4 transition-all duration-200 ${
        checked
          ? "border-zcash-yellow bg-zcash-yellow/[0.06] shadow-[0_8px_24px_-12px_rgba(244,183,40,0.35)]"
          : "border-amber-200 dark:border-amber-900/40 bg-amber-50/30 dark:bg-amber-950/10"
      }`}
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={checked}
          disabled={!canCheck}
          onChange={onToggle}
          className="mt-1 h-4 w-4 accent-zcash-yellow disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
        />
        <div className="flex-1 min-w-0 flex flex-col gap-2">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <span className="font-semibold tracking-tight">{c.bounty.title}</span>
              <StatusChip status={c.bounty.status} />
              {c.bounty.categoryId && <CategoryChip category={c.bounty.categoryId} />}
            </div>
            <div className="font-mono text-sm tabular-nums whitespace-nowrap font-semibold">
              {zec(c.bounty.bountyAmount)}{" "}
              <span className="text-neutral-500 font-sans font-normal">ZEC</span>
            </div>
          </div>
          <div className="text-xs text-neutral-500 flex flex-wrap gap-x-3 gap-y-0.5">
            <span>{c.bounty.assignees?.length ?? picksList.length} assignees</span>
            <span>created {new Date(c.bounty.dateCreated).toLocaleDateString()}</span>
          </div>
          <label className="flex items-center gap-2 text-xs pt-1">
            <span className="text-neutral-500 shrink-0">Pay to:</span>
            <select
              value={chosen}
              onChange={(e) => onPick(e.target.value)}
              className="flex-1 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-zcash-yellow/40"
            >
              <option value="">Choose a payee</option>
              {picksList.map((p) => (
                <option key={p.userId} value={p.userId}>
                  {p.name} ({p.z_address.slice(0, 12)}...{p.z_address.slice(-6)})
                </option>
              ))}
            </select>
          </label>
          {chosenAddr && (
            <div className="font-mono text-[10px] text-neutral-400 truncate">{chosenAddr}</div>
          )}
        </div>
      </div>
    </div>
  );
}

function TargetOption({
  selected,
  onSelect,
  label,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  label: string;
  children: ReactNode;
}) {
  return (
    <label
      className={`flex flex-col gap-2 rounded-xl border p-3 cursor-pointer transition-colors ${
        selected
          ? "border-zcash-yellow bg-zcash-yellow/[0.05]"
          : "border-neutral-200 dark:border-neutral-800 hover:border-neutral-300 dark:hover:border-neutral-700"
      }`}
    >
      <div className="flex items-center gap-2">
        <input
          type="radio"
          checked={selected}
          onChange={onSelect}
          className="accent-zcash-yellow"
        />
        <span className="text-sm font-medium">{label}</span>
      </div>
      <div className="flex flex-col gap-2 pl-6">{children}</div>
    </label>
  );
}

function Avatar({ name }: { name: string }) {
  const letter = name.trim().slice(0, 1).toUpperCase() || "?";
  return (
    <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-gradient-to-br from-zcash-yellow/30 to-amber-500/20 text-[9px] font-semibold text-neutral-700 dark:text-neutral-200">
      {letter}
    </span>
  );
}
