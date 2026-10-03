"use client";
import Link from "next/link";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { Menu, Search, X } from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";
import { SidebarNav } from "./Sidebar";
import { useUi } from "@/components/providers/Providers";

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-tight">
      <span aria-hidden className="grid h-7 w-7 place-items-center rounded-lg bg-fg font-mono text-[11px] font-bold text-bg">
        CS
      </span>
      <span className="hidden text-[15px] sm:inline">
        Core CS <span className="text-muted">Interview Academy</span>
      </span>
    </Link>
  );
}

export function SiteHeader() {
  const { setSearchOpen, navOpen, setNavOpen } = useUi();
  const pathname = usePathname();

  useEffect(() => {
    setNavOpen(false);
  }, [pathname, setNavOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !(e.target as HTMLElement)?.closest("input,textarea,[contenteditable]"))) {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setSearchOpen]);

  return (
    <>
      <header className="sticky top-0 z-40 h-14 border-b border-border bg-bg/85 backdrop-blur supports-[backdrop-filter]:bg-bg/70">
        <div className="mx-auto flex h-full max-w-[1600px] items-center gap-3 px-4">
          <button
            type="button"
            className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-fg lg:hidden"
            aria-label="Open navigation"
            onClick={() => setNavOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </button>
          <Logo />
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="flex h-8 items-center gap-2 rounded-lg border border-border bg-surface px-2.5 text-sm text-subtle hover:border-border-strong hover:text-muted sm:w-72"
          >
            <Search className="h-4 w-4" />
            <span className="hidden sm:inline">Search concepts, questions…</span>
            <kbd className="ml-auto hidden rounded border border-border bg-surface-2 px-1.5 font-mono text-[10px] sm:inline">Ctrl K</kbd>
          </button>
          <ThemeToggle />
        </div>
      </header>

      {navOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-black/40" onClick={() => setNavOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-[85%] max-w-xs overflow-y-auto border-r border-border bg-bg px-3 py-4 thin-scroll">
            <div className="mb-4 flex items-center justify-between px-1">
              <Logo />
              <button type="button" aria-label="Close navigation" onClick={() => setNavOpen(false)} className="grid h-8 w-8 place-items-center rounded-md hover:bg-surface-2">
                <X className="h-5 w-5" />
              </button>
            </div>
            <SidebarNav />
          </div>
        </div>
      )}
    </>
  );
}
