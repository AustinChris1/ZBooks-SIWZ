"use client";

import { AnimatePresence } from "framer-motion";
import type { Ufvk } from "@/lib/types";
import { KeyRow } from "./KeyRow";

/**
 * Thin client wrapper so the list can use AnimatePresence for enter/exit
 * transitions when keys are added or removed. Keeping it tiny means the
 * server component (page.tsx) still does all the data work.
 */
export function KeyList({ keys, canEdit }: { keys: Ufvk[]; canEdit: boolean }) {
  return (
    <ul className="flex flex-col gap-2">
      <AnimatePresence initial={false}>
        {keys.map((k) => (
          <KeyRow key={k.id} k={k} canEdit={canEdit} />
        ))}
      </AnimatePresence>
    </ul>
  );
}
