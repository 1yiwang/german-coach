import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "German Coach",
  description: "AI 德语私教 — PDF 精读、对话教练、间隔复习",
};

const navItems = [
  { href: "/", label: "首页" },
  { href: "/learn", label: "精读" },
  { href: "/chat", label: "对话" },
  { href: "/review", label: "复习" },
];

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="zh"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <header className="border-b border-border/60 sticky top-0 z-10 bg-background/80 backdrop-blur">
          <div className="mx-auto max-w-4xl w-full flex items-center gap-6 px-6 py-3">
            <Link
              href="/"
              className="font-heading text-base font-semibold tracking-tight"
            >
              German Coach
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                v0.2.5
              </span>
            </Link>
            <nav className="flex items-center gap-1 text-sm">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="px-3 py-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="flex-1 mx-auto max-w-4xl w-full px-6 py-8">
          {children}
        </main>
        <footer className="border-t border-border/60 text-xs text-muted-foreground">
          <div className="mx-auto max-w-4xl w-full px-6 py-4 flex justify-between">
            <span>German Coach · 你的 AI 德语私教</span>
            <span className="font-mono">v0.2.5 · DeepSeek + Supabase</span>
          </div>
        </footer>
        <Toaster position="bottom-right" richColors closeButton />
      </body>
    </html>
  );
}
