import type { ReactNode } from "react";
import type { Metadata } from "next";
import type { Route } from "next";
import Link from "next/link";
import "./globals.css";

import { AgeGate } from "@/components/AgeGate";
import { Footer } from "@/components/Footer";

export const metadata: Metadata = {
  title: "Divino AI Wine System",
  description:
    "Ecosistema premium dedicato a educazione enologica, AI commerce e raccomandazioni vino personalizzate."
};

const navigation: { href: Route; label: string }[] = [
  { href: "/", label: "Home" },
  { href: "/quiz", label: "Quiz" },
  { href: "/academy", label: "Academy" },
  { href: "/wine-ai-mastery", label: "Wine AI Mastery" }
];

export default function RootLayout({
  children
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="it">
      <body>
        <AgeGate />
        <div className="min-h-screen">
          <header className="sticky top-0 z-30 border-b border-burgundy/10 bg-cream/85 backdrop-blur">
            <div className="container-shell flex items-center justify-between gap-4 py-4">
              <Link href="/" className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-burgundy text-sm font-semibold tracking-[0.2em] text-cream">
                  DA
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.25em] text-burgundy/75">
                    Divino AI
                  </p>
                  <p className="text-base font-semibold text-ink">
                    Wine System
                  </p>
                </div>
              </Link>
              <nav className="hidden gap-6 text-sm text-ink/80 md:flex">
                {navigation.map((item) => (
                  <Link key={item.href} href={item.href} className="transition hover:text-burgundy">
                    {item.label}
                  </Link>
                ))}
              </nav>
            </div>
          </header>
          <main>{children}</main>
          <Footer />
        </div>
      </body>
    </html>
  );
}
