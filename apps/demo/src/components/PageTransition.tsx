"use client";

import { usePathname } from "next/navigation";
import { motion } from "framer-motion";

/**
 * Light enter-only page transition. Keyed on pathname so each route
 * gets a clean fade-in. We deliberately do NOT use AnimatePresence here
 * — its `mode="wait"` holds the old page's exit animation BEFORE
 * rendering the new one, which produces a blank flash whenever the new
 * server component takes any time to stream in. Without it, Next.js
 * swaps content as soon as it's ready and we just animate the entry.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <motion.div
      key={pathname}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: [0.4, 0.0, 0.2, 1] }}
    >
      {children}
    </motion.div>
  );
}
