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
// lib/emailAgent/*). No new provider dependency was added for this gate;
// per Phase 9 this is reported rather than silently assumed. The outbound
// send() call below has not been exercised against the live AgentMail API
// this session (no network calls are made in this gate) - verify the
// exact SDK method before the first real send.
export class AgentMailEmailAdapter implements EmailProviderAdapter {
  private readonly apiKey: string;
  private readonly inboxId: string;
  private readonly fromName: string;

  constructor() {
    const apiKey = process.env.AGENTMAIL_API_KEY;
    const inboxId = process.env.AGENTMAIL_INBOX_ID;
    if (!apiKey || !inboxId) {
      throw new Error('AgentMail not configured: AGENTMAIL_API_KEY/AGENTMAIL_INBOX_ID missing');
    }
    this.apiKey = apiKey;
    this.inboxId = inboxId;
    this.fromName = process.env.AGENT_FROM_NAME || 'Rete Squillari';
  }

  async send(input: EmailSendInput): Promise<EmailSendResult> {
    const { AgentMailClient } = await import('agentmail');
    const client = new AgentMailClient({ apiKey: this.apiKey });
    try {
      const res: any = await (client as any).inboxes.messages.send(this.inboxId, {
        to: [input.to],
        subject: input.subject,
        text: input.text,
        html: input.html,
        fromName: this.fromName,
      });
      return { success: true, providerMessageId: res?.message_id ?? res?.id ?? null, errorCode: null };
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
