// Redaction helpers for anything logged by the web-push / email workers.
// Never log a raw push endpoint or email address - only a masked form
// (enough to eyeball in an ops log, not enough to reconstruct or reuse).

export function maskPushEndpoint(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    const tail = url.pathname.slice(-6).replace(/[^a-zA-Z0-9]/g, '');
    return `${url.host}/…${tail}`;
  } catch {
    return 'push-endpoint:invalid';
  }
}

export function maskEmailAddress(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const visible = local.length <= 2 ? local[0] ?? '*' : local.slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(local.length - visible.length, 1))}@${domain}`;
}

export function redactPushError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err ?? 'unknown error');
  return message
    .replace(/https?:\/\/\S+/g, '[endpoint redacted]')
    .replace(/[A-Za-z0-9_-]{40,}/g, '[key redacted]')
    .slice(0, 300);
}
