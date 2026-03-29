"use client";

import { useEffect, useState } from "react";

export function AgeGate() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const verified = window.localStorage.getItem("age_verified") === "true";
    if (!verified) setOpen(true);
  }, []);

  function confirmAge() {
    window.localStorage.setItem("age_verified", "true");
    setOpen(false);
  }

  function rejectAge() {
    window.location.href = "https://www.google.com";
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-6 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-[28px] bg-cream p-8 shadow-2xl">
        <p className="section-eyebrow text-burgundy/70">Accesso riservato</p>
        <h2 className="mt-3 text-3xl font-semibold text-ink">
          Hai almeno 18 anni?
        </h2>
        <p className="mt-4 leading-7 text-ink/70">
          Devi avere almeno 18 anni per accedere a questo sito. Contenuti,
          prodotti e comunicazioni sono destinati esclusivamente a utenti
          maggiorenni.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <button
            onClick={confirmAge}
            className="rounded-full bg-burgundy px-6 py-3 text-sm font-semibold text-cream transition hover:bg-burgundy/85"
          >
            Ho almeno 18 anni
          </button>
          <button
            onClick={rejectAge}
            className="rounded-full border border-burgundy/15 px-6 py-3 text-sm font-semibold text-ink transition hover:border-burgundy/30"
          >
            No, esci
          </button>
        </div>
      </div>
    </div>
  );
}
