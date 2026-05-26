"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Category, Transaction } from "@/lib/db";

export function TxRow({
  t,
  keyLabel,
  editable,
  categories,
}: {
  t: Transaction;
  keyLabel: string;
  editable: boolean;
  categories: { value: string; label: string }[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [tag, setTag] = useState<string>(t.tag ?? "");
  const [notes, setNotes] = useState<string>(t.notes ?? "");
  const [savedHint, setSavedHint] = useState(false);

  const submit = (partial: { tag?: Category | ""; notes?: string }) => {
    startTransition(async () => {
      const payload: Record<string, string | undefined> = {};
      if (partial.tag !== undefined) payload.tag = partial.tag === "" ? undefined : partial.tag;
      if (partial.notes !== undefined) payload.notes = partial.notes;
      const res = await fetch(`/api/transactions/${t.id}/tag`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setSavedHint(true);
        setTimeout(() => setSavedHint(false), 900);
        router.refresh();
      }
    });
  };

  return (
    <tr className="border-t border-black/5 dark:border-white/10 align-top">
      <td className="py-2 pr-3 whitespace-nowrap text-xs opacity-70">
        {new Date(t.timestamp).toLocaleDateString()}
      </td>
      <td className="py-2 pr-3">
        <span
          className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
            t.direction === "in"
              ? "bg-green-500/20 text-green-700 dark:text-green-300"
              : "bg-red-500/20 text-red-700 dark:text-red-300"
          }`}
        >
          {t.direction === "in" ? "IN" : "OUT"}
        </span>
      </td>
      <td
        className={`py-2 pr-3 text-right font-mono ${
          t.amount_zec >= 0 ? "text-green-700 dark:text-green-300" : "text-red-700 dark:text-red-300"
        }`}
      >
        {t.amount_zec >= 0 ? "+" : ""}
        {t.amount_zec.toLocaleString(undefined, { maximumFractionDigits: 8 })}
      </td>
      <td className="py-2 pr-3 max-w-[20rem]">
        <div className="line-clamp-2 text-sm">{t.memo ?? <span className="opacity-50">—</span>}</div>
        {t.counterparty && (
          <div className="font-mono text-[11px] opacity-50 truncate">{t.counterparty}</div>
        )}
      </td>
      <td className="py-2 pr-3 text-xs opacity-70">{keyLabel}</td>
      <td className="py-2 pr-3">
        {editable ? (
          <select
            className="bg-transparent border border-black/15 dark:border-white/15 rounded px-1.5 py-1 text-xs"
            value={tag}
            disabled={isPending}
            onChange={(e) => {
              setTag(e.target.value);
              submit({ tag: e.target.value as Category | "" });
            }}
          >
            <option value="">— untagged —</option>
            {categories.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        ) : (
          <span className="text-xs opacity-70">{t.tag ?? "—"}</span>
        )}
      </td>
      <td className="py-2 pr-3">
        {editable ? (
          <input
            className="bg-transparent border border-black/10 dark:border-white/15 rounded px-1.5 py-1 text-xs w-40"
            placeholder="add a note…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => {
              if (notes !== (t.notes ?? "")) submit({ notes });
            }}
          />
        ) : (
          <span className="text-xs opacity-70">{t.notes ?? "—"}</span>
        )}
        {savedHint && <span className="ml-2 text-[10px] text-green-600">saved</span>}
      </td>
    </tr>
  );
}
