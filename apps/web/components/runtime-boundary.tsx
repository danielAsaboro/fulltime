"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { PwaRegister } from "@/components/pwa-register";
import { DataProvider } from "@/lib/data";

export function RuntimeBoundary({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  if (pathname === "/") return children;

  return (
    <DataProvider>
      {children}
      <PwaRegister />
    </DataProvider>
  );
}
