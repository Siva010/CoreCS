import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { Providers } from "@/components/providers/Providers";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { Sidebar } from "@/components/layout/Sidebar";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { getManifest } from "@/lib/content/manifest";

const sans = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  title: {
    default: "Core CS Interview Academy — Understand the machine. Master the interview.",
    template: "%s · Core CS Interview Academy",
  },
  description:
    "A structured, mechanism-first curriculum for Operating Systems, Computer Networks, Databases and SQL — from beginner to senior-touch depth, with labs, visualizations, case studies and an interview question bank.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#08080a" },
  ],
};

function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-3 px-6 py-6 text-xs text-subtle sm:flex-row sm:items-center sm:justify-between">
        <p>
          <span className="font-medium text-muted">Core CS Academy</span> — learn the mechanisms; the answers follow.
        </p>
        <nav className="flex flex-wrap gap-x-5 gap-y-1">
          <Link href="/path" className="hover:text-fg">Learning Path</Link>
          <Link href="/interview" className="hover:text-fg">Interview Mode</Link>
          <Link href="/labs" className="hover:text-fg">Labs</Link>
          <Link href="/progress" className="hover:text-fg">Progress</Link>
          <Link href="/about" className="hover:text-fg">About & sources</Link>
        </nav>
      </div>
    </footer>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const manifest = getManifest();
  return (
    <html lang="en" suppressHydrationWarning className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-screen font-sans antialiased">
        <Providers manifest={manifest}>
          <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[70] focus:rounded focus:bg-surface focus:px-3 focus:py-2">
            Skip to content
          </a>
          <SiteHeader />
          <div className="mx-auto flex max-w-[1600px]">
            <Sidebar />
            <main id="main" className="min-w-0 flex-1">
              {children}
            </main>
          </div>
          <SiteFooter />
          <CommandPalette />
        </Providers>
      </body>
    </html>
  );
}
