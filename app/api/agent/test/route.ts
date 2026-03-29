import { NextResponse } from "next/server";

import { classifyIntent } from "@/lib/emailAgent/classifier";
import { generateReply } from "@/lib/emailAgent/replyEngine";
import type { LeadContext } from "@/lib/emailAgent/types";
import type { SegmentId } from "@/lib/types";

// Test fixtures covering 8 typical inbound scenarios
const fixtures = [
  {
    id: "wine_beginner",
    from: "mario@test.it",
    subject: "Re: Il tuo profilo vino è pronto",
    text: "Ciao Luca, bevo di solito Lambrusco. Cosa mi consigli di provare dopo?",
    segment: "novizio-curioso" as SegmentId,
  },
  {
    id: "wine_enthusiast",
    from: "sara@test.it",
    subject: "Re: Il tuo profilo",
    text: "Sono appassionata di bianchi strutturati, soprattutto borgognoni. Cosa mi consigli per ampliare la cantina con qualcosa di italiano?",
    segment: "appassionato-pratico" as SegmentId,
  },
  {
    id: "wine_creator",
    from: "giulio@test.it",
    subject: "Re: Profilo AI Wine Creator",
    text: "Cerco vini che abbiano una storia forte da raccontare nei miei contenuti. Hai idee per vini visivi e narrativi?",
    segment: "builder-digitale" as SegmentId,
  },
  {
    id: "fit_check_mastery",
    from: "anna@test.it",
    subject: "Re: Wine AI Mastery",
    text: "Non sono sicura che Wine AI Mastery faccia per me. Ho un blog sul vino ma non so se il mio progetto è abbastanza strutturato.",
    segment: "builder-digitale" as SegmentId,
  },
  {
    id: "fit_check_beginner",
    from: "marco@test.it",
    subject: "Re: Corso",
    text: "Ha senso comprare il corso se conosco già qualche denominazione di base?",
    segment: "novizio-curioso" as SegmentId,
  },
  {
    id: "price_objection_corso",
    from: "lucia@test.it",
    subject: "Re: Vale €79",
    text: "Mi sembra un po' caro €79 per un corso online. Non c'è qualcosa di più economico per iniziare?",
    segment: "novizio-curioso" as SegmentId,
  },
  {
    id: "price_objection_academy",
    from: "roberto@test.it",
    subject: "Re: Wine Buyer Academy",
    text: "€1490 è davvero tanto. Non posso spendere così tanto adesso.",
    segment: "buyer-professionale" as SegmentId,
  },
  {
    id: "human_help",
    from: "elena@test.it",
    subject: "Voglio parlare con qualcuno",
    text: "Salve, vorrei parlare con una persona prima di decidere. È possibile fare una chiamata?",
    segment: "appassionato-pratico" as SegmentId,
  },
];

export async function GET(request: Request) {
  const url = new URL(request.url);
  const fixtureId = url.searchParams.get("fixture");
  const dryRun = url.searchParams.get("dry") === "1";

  const fixture = fixtureId
    ? fixtures.find((f) => f.id === fixtureId)
    : fixtures[0];

  if (!fixture) {
    return NextResponse.json(
      { error: "fixture not found", available: fixtures.map((f) => f.id) },
      { status: 404 }
    );
  }

  const intent = classifyIntent(fixture.text);

  const lead: LeadContext = {
    name: fixture.from.split("@")[0],
    segment: fixture.segment,
    productName: "Corso Introduttivo in 5 Lezioni",
    emailsSent: 1,
  };

  const mockMessage = {
    inbox_id: "test",
    thread_id: `thread_${fixture.id}`,
    message_id: `msg_${fixture.id}`,
    from: fixture.from,
    to: ["ai@divinomarket.it"],
    subject: fixture.subject,
    text: fixture.text,
    timestamp: new Date().toISOString(),
  };

  if (dryRun) {
    return NextResponse.json({ fixture: fixture.id, intent, lead });
  }

  const reply = await generateReply({
    inboundMessage: mockMessage,
    intent,
    lead,
  });

  return NextResponse.json({
    fixture: fixture.id,
    intent,
    reply: {
      subject: reply.subject,
      text: reply.text,
      approved: reply.approved,
      safetyCheck: reply.safetyCheck,
    },
  });
}

export async function GET_ALL() {
  return NextResponse.json({ fixtures: fixtures.map((f) => f.id) });
}
