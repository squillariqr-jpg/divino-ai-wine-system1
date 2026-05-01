import type { ReactNode } from "react";
import type { Metadata } from "next";
import type { Route } from "next";
import Link from "next/link";
import "./globals.css";

import { AgeGate } from "@/components/AgeGate";
import { Footer } from "@/components/Footer";

export const metadata: Metadata = {
  title: "Affari Divini",
  description:
    "Usa l'intelligenza artificiale per capire, scegliere e vendere vino meglio della media."
};

const navigation: { href: Route; label: string }[] = [
  { href: "/", label: "Home" },
  { href: "/quiz", label: "Quiz Vino" },
  { href: "/quiz-business", label: "Quiz Business" },
  { href: "/agenti" as Route, label: "Agenti AI" },
  { href: "/prompt-generator" as Route, label: "Prompt Engine" },
  { href: "/abbonamenti" as Route, label: "Abbonamenti" },
  { href: "/academy", label: "Academy" }
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
                  AD
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.25em] text-burgundy/75">
                    Affari
                  </p>
                  <p className="text-base font-semibold text-ink">
                    Divini
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
              <Link
                href="/quiz"
                className="hidden rounded-full bg-burgundy px-5 py-2.5 text-xs font-semibold text-cream transition hover:bg-burgundy/90 md:inline-block"
              >
                Fai il Quiz
              </Link>
            </div>
          </header>
          <main>{children}</main>
          <Footer />
        </div>
      </body>
    </html>
  );
}
