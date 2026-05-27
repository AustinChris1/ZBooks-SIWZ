"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";

/**
 * Inline labeller. Shows the existing label if one is set, otherwise a
 * shortened address with a "+ label" affordance. Clicking it expands an
 * inline input — saving on Enter / blur persists to /api/counterparties
 * and triggers a router refresh so every other row that references the
 * same address updates too.
 */
export function CounterpartyLabel({
  address,
  label,
  editable,
}: {
  address: string;
  label?: string;
  editable: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label ?? "");
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  // Keep draft in sync if the saved label updates (e.g. another row
  // labelled the same address and triggered a refresh).
  useEffect(() => {
    setDraft(label ?? "");
  }, [label]);

  const save = () => {
    if (draft === (label ?? "")) {
      setEditing(false);
      return;
    }
    startTransition(async () => {
      await fetch("/api/counterparties", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address, label: draft }),
      });
      setEditing(false);
      router.refresh();
    });
  };

  const cancel = () => {
    setDraft(label ?? "");
    setEditing(false);
  };

  if (editing && editable) {
    return (
      <span className="inline-flex items-center gap-1">
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") cancel();
          }}
          placeholder="e.g. ZecHub Treasury"
          maxLength={80}
          disabled={isPending}
          className="text-xs rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-1.5 py-0.5 w-44 focus:outline-none focus:ring-1 focus:ring-zcash-yellow"
        />
      </span>
    );
  }

  return (
    <AnimatePresence mode="wait" initial={false}>
      {label ? (
        <motion.span
          key="labelled"
          layout
          initial={{ opacity: 0.6 }}
          animate={{ opacity: 1 }}
          className="inline-flex items-center gap-1.5"
          title={address}
        >
          <span className="text-sm font-medium">{label}</span>
          {editable && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-[10px] text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
              aria-label="Edit label"
            >
              edit
            </button>
          )}
        </motion.span>
      ) : (
        <motion.span
          key="raw"
          layout
          initial={{ opacity: 0.6 }}
          animate={{ opacity: 1 }}
          className="inline-flex items-center gap-1.5"
        >
          <code className="font-mono text-[11px] text-neutral-500 truncate max-w-[14rem]">
            {shortenAddr(address)}
          </code>
          {editable && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-[10px] text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200 underline decoration-dotted"
            >
              + label
            </button>
          )}
        </motion.span>
      )}
    </AnimatePresence>
  );
}

function shortenAddr(a: string): string {
  if (a.length <= 18) return a;
  return `${a.slice(0, 10)}…${a.slice(-6)}`;
}
