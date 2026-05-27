"use client";

import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";
import { ThemeProvider } from "@/components/ThemeToggle";
import { ConfirmProvider } from "@/components/ConfirmDialog";
import { BackgroundSync } from "@/components/BackgroundSync";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <ThemeProvider>
        <ConfirmProvider>
          {children}
          <BackgroundSync />
        </ConfirmProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}
