"use client";
import Link from "next/link";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { Menu, Search, X } from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";
import { SidebarNav } from "./Sidebar";
import { useUi } from "@/components/providers/Providers";
import { GithubMark, REPO_URL } from "@/components/ui/GithubMark";
import { cn } from "@/lib/utils";

const SUBJECT_NAV = [
  { href: "/os", label: "OS" },
  { href: "/networks", label: "Networks" },
  { href: "/databases", label: "Databases" },
  { href: "/connections", label: "Connections" },
];

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2 text-sm font-semibold tracking-tight">
      <span aria-hidden className="grid size-6 place-items-center rounded bg-fg text-2xs font-bold text-bg">
        CS
      </span>
      <span className="hidden sm:inline">Core CS Academy</span>
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
      <header className="sticky top-0 z-40 border-b border-border bg-bg/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-3 px-4 lg:px-6">
          <button
            type="button"
            className="grid size-8 place-items-center rounded-md border border-border text-muted lg:hidden"
            aria-label="Open navigation"
            onClick={() => setNavOpen(true)}
          >
            <Menu className="size-4" />
          </button>
          <Logo />
          <span className="hidden text-subtle md:inline">/</span>
          <nav aria-label="Subjects" className="hidden items-center gap-1 md:flex">
            {SUBJECT_NAV.map((s) => {
              const active = pathname === s.href || pathname.startsWith(s.href + "/");
              return (
                <Link
                  key={s.href}
                  href={s.href}
                  aria-current={active ? "page" : undefined}
                  className={cn("rounded-md px-2 py-1 text-sm transition-colors", active ? "bg-surface-2 text-fg" : "text-subtle hover:text-fg")}
                >
                  {s.label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="flex h-8 items-center gap-2 rounded-md border border-border px-2.5 text-xs text-subtle transition-colors hover:border-border-strong hover:text-muted"
              aria-label="Search"
            >
              <Search className="size-3.5" />
              <span className="hidden sm:inline">Search</span>
              <kbd className="hidden rounded border border-border bg-surface-2 px-1.5 py-0.5 font-sans text-2xs text-subtle sm:inline">Ctrl K</kbd>
            </button>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Source on GitHub"
              title="Source on GitHub"
              className="hidden size-8 place-items-center rounded-md border border-border text-muted transition-colors hover:border-border-strong hover:text-fg sm:grid"
            >
              <GithubMark className="size-4" />
            </a>
            <ThemeToggle />
          </div>
        </div>
      </header>

      {navOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-black/40" onClick={() => setNavOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-[85%] max-w-xs overflow-y-auto border-r border-border bg-bg px-3 py-4 thin-scroll">
            <div className="mb-4 flex items-center justify-between px-1">
              <Logo />
              <button type="button" aria-label="Close navigation" onClick={() => setNavOpen(false)} className="grid size-8 place-items-center rounded-md border border-border">
                <X className="size-4" />
              </button>
            </div>
            <SidebarNav />
          </div>
        </div>
      )}
    </>
  );
}
