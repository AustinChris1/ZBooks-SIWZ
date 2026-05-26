"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function AddKeyForm() {
  const [label, setLabel] = useState("");
  const [ufvk, setUfvk] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <form
      className="rounded-lg border border-black/10 dark:border-white/10 p-4 flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const res = await fetch("/api/keys", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ label, ufvk }),
          });
          if (!res.ok) {
            const j = await res.json().catch(() => ({}));
            setError(j.error ?? `Server returned ${res.status}`);
            return;
          }
          setLabel("");
          setUfvk("");
          router.refresh();
        });
      }}
    >
      <div className="text-sm font-semibold">Add a viewing key</div>
      <div className="grid sm:grid-cols-[200px_1fr] gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="opacity-70">Label</span>
          <input
            className="rounded-md border border-black/15 dark:border-white/15 bg-transparent px-2 py-1.5 font-sans text-sm"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Operations wallet"
            maxLength={60}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="opacity-70">UFVK</span>
          <textarea
            className="rounded-md border border-black/15 dark:border-white/15 bg-transparent px-2 py-1.5 font-mono text-xs min-h-[5rem]"
            value={ufvk}
            onChange={(e) => setUfvk(e.target.value)}
            placeholder="uview1…"
            spellCheck={false}
          />
        </label>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs opacity-60">
          Adding your first key seeds the demo with sample transactions so the
          UI is exercisable without a lightwalletd connection.
        </span>
        <button
          type="submit"
          className="rounded-md bg-zcash-yellow text-zcash-dark font-semibold px-3 py-1.5 text-sm disabled:opacity-50"
          disabled={isPending || !ufvk.trim()}
        >
          {isPending ? "Adding…" : "Add key"}
        </button>
      </div>
      {error && <div className="text-sm text-red-600">{error}</div>}
    </form>
  );
}
