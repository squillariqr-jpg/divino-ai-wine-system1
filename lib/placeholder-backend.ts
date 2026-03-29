import type { LeadCapturePayload, SegmentId } from "@/lib/types";

type PlaceholderLeadRecord = {
  leadId: string;
  storedAt: string;
  destination: string;
  payload: LeadCapturePayload;
  nextStep: string;
};

function resolveNextStep(segment?: SegmentId, interest?: string) {
  if (segment === "buyer-professionale") {
    return "Inviare briefing premium e proporre una call per la Wine Buyer Academy.";
  }

  if (segment === "builder-digitale") {
    return "Inviare il lead magnet AI e aprire il follow-up verso Wine AI Mastery.";
  }

  if (interest?.includes("Corso")) {
    return "Inviare il materiale gratuito e attivare la sequenza verso il corso in 5 lezioni.";
  }

  return "Inviare l'asset gratuito e nutrire il contatto con il funnel iniziale.";
}

export async function submitLeadToPlaceholderBackend(
  payload: LeadCapturePayload
): Promise<PlaceholderLeadRecord> {
  // Placeholder only:
  // replace this function with a real repository adapter when Supabase is introduced.
  // n8n can also be triggered from this boundary after persistence succeeds.
  await new Promise((resolve) => {
    setTimeout(resolve, 120);
  });

  return {
    leadId: `lead_${crypto.randomUUID().slice(0, 8)}`,
    storedAt: new Date().toISOString(),
    destination: "placeholder-crm",
    payload,
    nextStep: resolveNextStep(payload.segment, payload.interest)
  };
}
