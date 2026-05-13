/**
 * Fire-and-forget event tracker. Sends to /api/track → Supabase events table.
 * Never throws — tracking must never break the UI.
 */
export function track(
  event: string,
  properties: Record<string, unknown> = {}
): void {
  fetch("/api/track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event, properties }),
  }).catch(() => {});
}
