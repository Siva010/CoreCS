"use client";
import { ThemeProvider } from "next-themes";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Manifest } from "@/lib/progress/mastery";
import { useHydrated, useProgress } from "@/lib/progress/store";

const ManifestContext = createContext<Manifest | null>(null);

export function useManifest(): Manifest {
  const m = useContext(ManifestContext);
  if (!m) throw new Error("useManifest must be used inside <Providers>");
  return m;
}

const UiContext = createContext<{ searchOpen: boolean; setSearchOpen: (v: boolean) => void; navOpen: boolean; setNavOpen: (v: boolean) => void }>({
  searchOpen: false,
  setSearchOpen: () => {},
  navOpen: false,
  setNavOpen: () => {},
});

export function useUi() {
  return useContext(UiContext);
}

function ProgressHydrator() {
  const setHydrated = useHydrated((s) => s.setHydrated);
  useEffect(() => {
    const done = () => setHydrated();
    const res = useProgress.persist.rehydrate();
    if (res && typeof (res as Promise<void>).then === "function") (res as Promise<void>).then(done, done);
    else done();
    // keep tabs in sync
    const onStorage = (e: StorageEvent) => {
      if (e.key === "ccia-progress-v1") useProgress.persist.rehydrate();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [setHydrated]);
  return null;
}

export function Providers({ manifest, children }: { manifest: Manifest; children: ReactNode }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <ManifestContext.Provider value={manifest}>
        <UiContext.Provider value={{ searchOpen, setSearchOpen, navOpen, setNavOpen }}>
          <ProgressHydrator />
          {children}
        </UiContext.Provider>
      </ManifestContext.Provider>
    </ThemeProvider>
  );
}
