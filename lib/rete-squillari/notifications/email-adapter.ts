export interface EmailSendInput {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailSendResult {
  success: boolean;
  providerMessageId: string | null;
  errorCode: string | null;
}

export interface EmailProviderAdapter {
  send(input: EmailSendInput): Promise<EmailSendResult>;
}

// Real adapter, built on AgentMail - the email provider this repo already
// depends on ("agentmail" in package.json) and already uses for inbound
// Rete Squillari shortage-email ingestion (app/api/agentmail/webhook/route.ts,
// lib/emailAgent/*). No new provider dependency was added for this gate.
// Verified against the installed SDK's own type declarations
// (node_modules/agentmail@0.4.13, dist/cjs/api/resources/messages/types):
// the real method is `client.inboxes.messages.send(inboxId, request)`,
// `SendMessageRequest` has no `fromName` field (the sender display name is
// configured once on the inbox itself, e.g. via `client.inboxes.update()`,
// not per message - so it is intentionally not sent here), and
// `SendMessageResponse` is `{ messageId, threadId }` (camelCase - not
// `message_id`/`id`, which this adapter previously read and which would
// have always produced a null providerMessageId even on a successful
// send). Still never exercised against the live network this session.
export class AgentMailEmailAdapter implements EmailProviderAdapter {
  private readonly apiKey: string;
  private readonly inboxId: string;

  constructor() {
    const apiKey = process.env.AGENTMAIL_API_KEY;
    const inboxId = process.env.AGENTMAIL_INBOX_ID;
    if (!apiKey || !inboxId) {
      throw new Error('AgentMail not configured: AGENTMAIL_API_KEY/AGENTMAIL_INBOX_ID missing');
    }
    this.apiKey = apiKey;
    this.inboxId = inboxId;
  }

  async send(input: EmailSendInput): Promise<EmailSendResult> {
    const { AgentMailClient } = await import('agentmail');
    const client = new AgentMailClient({ apiKey: this.apiKey });
    try {
      const res = await client.inboxes.messages.send(this.inboxId, {
        to: [input.to],
        subject: input.subject,
        text: input.text,
        html: input.html,
      });
      return { success: true, providerMessageId: res?.messageId ?? null, errorCode: null };
    } catch (err) {
      return { success: false, providerMessageId: null, errorCode: err instanceof Error ? err.message.slice(0, 200) : 'UNKNOWN_ERROR' };
    }
  }
}

// Test/preview-only adapter. Records every call it would have made and
// NEVER performs network I/O.
export class MockEmailAdapter implements EmailProviderAdapter {
  public readonly calls: EmailSendInput[] = [];
  private readonly forcedResult: Partial<EmailSendResult> | undefined;

  constructor(forcedResult?: Partial<EmailSendResult>) {
    this.forcedResult = forcedResult;
  }

  async send(input: EmailSendInput): Promise<EmailSendResult> {
    this.calls.push(input);
    return { success: true, providerMessageId: `mock-${this.calls.length}`, errorCode: null, ...this.forcedResult };
  }
}

export function createEmailAdapter(): EmailProviderAdapter {
  return new AgentMailEmailAdapter();
}
