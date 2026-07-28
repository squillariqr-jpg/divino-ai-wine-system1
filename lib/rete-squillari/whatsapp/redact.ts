// Strips anything phone/token/credential-shaped out of an error message
// before it is ever persisted (last_error_redacted) or logged. Applied to
// every provider error path - never store or log a raw provider response
// body, which may echo back the request payload (including the phone
// number) or bearer-token-adjacent diagnostic fields.
export function redactWhatsAppError(raw: unknown): string {
  let text = typeof raw === 'string' ? raw : JSON.stringify(raw ?? {});
  text = text
    .replace(/\+[1-9][0-9]{6,14}/g, '[PHONE_REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [TOKEN_REDACTED]')
    .replace(/"?access_token"?\s*:\s*"[^"]*"/gi, 'access_token:"[TOKEN_REDACTED]"')
    .replace(/EAA[A-Za-z0-9]{20,}/g, '[TOKEN_REDACTED]');
  return text.slice(0, 500);
}
