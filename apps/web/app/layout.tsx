import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "ShipLock — AI writes. Humans ship.",
  description: "Release control for agent-built pull requests.",
  icons: { icon: "/shiplock-mark.svg" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">
        <header className="border-b border-line/70 bg-midnight/70 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-4">
            <Link href="/" className="flex items-center gap-2.5">
              <img src="/shiplock-mark.svg" alt="" width={32} height={32} />
              <span className="text-lg font-bold tracking-tight">
                Ship<span className="text-brand">Lock</span>
              </span>
            </Link>
            <nav className="text-sm text-muted">
              <Link href="/" className="rounded-lg bg-panel-2 px-3 py-1.5 text-white">
                Pull requests
              </Link>
            </nav>
            <p className="ml-auto hidden text-sm text-muted sm:block">
              AI writes. <span className="text-approve">Humans ship.</span>
            </p>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
