import type { SendUtilityTemplateInput, SendUtilityTemplateResult, WhatsAppProviderAdapter } from './types';
import { redactWhatsAppError } from './redact';

const REQUEST_TIMEOUT_MS = 10_000;

// Permanent (do-not-retry) Meta error subcodes/codes: invalid recipient
// number, template not approved/mismatched, recipient has blocked the
// business number. Everything else (rate limit, transient 5xx, network
// timeout) is treated as temporary and eligible for retry.
const PERMANENT_ERROR_CODES = new Set([
  '131026', // message undeliverable (invalid number / not on WhatsApp)
  '131047', // re-engagement required outside template
  '132000', // template param count mismatch
  '132001', // template does not exist / not approved
  '133010', // number not registered on WhatsApp
]);

// Server-side only. Never imported by anything under public/ or any
// client-rendered component - reads token/WABA identifiers exclusively from
// process.env, matching lib/supabase.ts's own server-only pattern.
export class MetaCloudApiAdapter implements WhatsAppProviderAdapter {
  private readonly accessToken: string;
  private readonly phoneNumberId: string;
  private readonly apiVersion: string;

  constructor() {
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const apiVersion = process.env.WHATSAPP_API_VERSION || 'v21.0';
    if (!accessToken || !phoneNumberId) {
      throw new Error('WhatsApp Cloud API not configured: WHATSAPP_ACCESS_TOKEN/WHATSAPP_PHONE_NUMBER_ID missing');
    }
    this.accessToken = accessToken;
    this.phoneNumberId = phoneNumberId;
    this.apiVersion = apiVersion;
  }

  async sendUtilityTemplate(input: SendUtilityTemplateInput): Promise<SendUtilityTemplateResult> {
    const url = `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`;
    const body = {
      messaging_product: 'whatsapp',
      to: input.phoneE164,
      type: 'template',
      template: {
        name: input.templateName,
        language: { code: input.languageCode },
        components: [
          {
            type: 'body',
            parameters: input.parameters.map((text) => ({ type: 'text', text })),
          },
          {
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [{ type: 'text', text: input.deepLink }],
          },
        ],
      },
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const json: any = await res.json().catch(() => ({}));

      if (res.ok && json?.messages?.[0]?.id) {
        return { success: true, providerMessageId: json.messages[0].id, errorCode: null, errorRedacted: null, isPermanentError: false };
      }

      const errorCode = String(json?.error?.code ?? res.status);
      return {
        success: false,
        providerMessageId: null,
        errorCode,
        errorRedacted: redactWhatsAppError(json?.error ?? { status: res.status }),
        isPermanentError: PERMANENT_ERROR_CODES.has(errorCode) || (res.status >= 400 && res.status < 500 && res.status !== 429),
      };
    } catch (err) {
      const aborted = err instanceof Error && err.name === 'AbortError';
      return {
        success: false,
        providerMessageId: null,
        errorCode: aborted ? 'TIMEOUT' : 'NETWORK_ERROR',
        errorRedacted: redactWhatsAppError(err instanceof Error ? err.message : err),
        isPermanentError: false,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

// Test/preview-only adapter. Records every call it would have made and
// NEVER performs network I/O - used by the test suite and the preview
// script so "no real message sent" is structurally guaranteed, not just a
// runtime flag.
export class MockWhatsAppAdapter implements WhatsAppProviderAdapter {
  public readonly calls: SendUtilityTemplateInput[] = [];
  private readonly forcedResult: Partial<SendUtilityTemplateResult> | undefined;

  constructor(forcedResult?: Partial<SendUtilityTemplateResult>) {
    this.forcedResult = forcedResult;
  }

  async sendUtilityTemplate(input: SendUtilityTemplateInput): Promise<SendUtilityTemplateResult> {
    this.calls.push(input);
    return {
      success: true,
      providerMessageId: `mock-${this.calls.length}`,
      errorCode: null,
      errorRedacted: null,
      isPermanentError: false,
      ...this.forcedResult,
    };
  }
}

export function createWhatsAppAdapter(): WhatsAppProviderAdapter {
  const provider = process.env.WHATSAPP_PROVIDER || 'meta_cloud_api';
  if (provider !== 'meta_cloud_api') {
    throw new Error(`Unsupported WHATSAPP_PROVIDER: ${provider} (only meta_cloud_api is implemented)`);
  }
  return new MetaCloudApiAdapter();
}
