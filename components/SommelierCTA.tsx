"use client";

import { track } from "@/lib/track";

const SOMMELIER_HREF =
  "mailto:sommelier@agentmail.to?subject=Consiglio vino&body=Ti descrivo cosa cerco:";

type SommelierCTAProps = {
  source: string;
  className?: string;
  label?: string;
};

export function SommelierCTA({
  source,
  className,
  label = "💬 Chiedi al Sommelier AI",
}: SommelierCTAProps) {
  return (
    <a
      href={SOMMELIER_HREF}
      className={className}
      onClick={() => track("sommelier_cta_click", { source })}
    >
      {label}
    </a>
  );
}
