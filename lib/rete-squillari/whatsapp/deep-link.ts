// Deep links point at the verified production Rete Squillari app. The link
// itself carries no authority - opening it still requires the normal
// authenticated store/central session (see docs/rete-squillari-whatsapp-pilot.md
// for the verification of this property against the real app).
export const RETE_SQUILLARI_APP_BASE = 'https://divino-ai-wine-system1.vercel.app/rete-squillari';

export type DeepLinkReferenceType = 'request' | 'offer' | 'transfer';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function buildDeepLink(referenceType: DeepLinkReferenceType, referenceId: string): string {
  if (!UUID_RE.test(referenceId)) {
    throw new Error(`Refusing to build a deep link from a non-UUID reference: ${referenceType}`);
  }
  return `${RETE_SQUILLARI_APP_BASE}?${referenceType}=${referenceId}`;
}

// The outbox stores a relative path (e.g. "/rete-squillari?offer=<uuid>")
// so the base host is never baked into the database - resolved here at
// send/preview time against the single verified constant above.
export function resolveStoredDeepLink(storedPath: string): string {
  if (storedPath.startsWith('http://') || storedPath.startsWith('https://')) return storedPath;
  const origin = new URL(RETE_SQUILLARI_APP_BASE).origin;
  return `${origin}${storedPath}`;
}
