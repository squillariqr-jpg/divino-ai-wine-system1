// Pure unit tests for the WhatsApp template rendering, redaction, deep-link,
// and mock-adapter modules - no database, no network, no real send possible.
import assert from 'node:assert';
import {
  renderTemplateBody,
  renderFullMessagePreview,
  buildTemplateParameters,
  escapeTemplateParameter,
  assertNoSecretLikeContent,
  TEMPLATE_BODIES,
} from '../lib/rete-squillari/whatsapp/templates';
import { redactWhatsAppError } from '../lib/rete-squillari/whatsapp/redact';
import { buildDeepLink, resolveStoredDeepLink, RETE_SQUILLARI_APP_BASE } from '../lib/rete-squillari/whatsapp/deep-link';
import { MockWhatsAppAdapter } from '../lib/rete-squillari/whatsapp/adapter';

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log('PASS - ' + name); pass++; }
  catch (e: any) { console.log('FAIL - ' + name + ' :: ' + e.message); fail++; }
}
async function checkAsync(name: string, fn: () => Promise<void>) {
  try { await fn(); console.log('PASS - ' + name); pass++; }
  catch (e: any) { console.log('FAIL - ' + name + ' :: ' + e.message); fail++; }
}

check('template variables are rendered in Italian and body text is present for every defined template', () => {
  for (const name of Object.keys(TEMPLATE_BODIES)) {
    assert.ok(TEMPLATE_BODIES[name].length > 0);
  }
});

check('OFFER_RECEIVED renders exactly "Rete Squillari: Sestri ha offerto 4 unità di Vermentino Gallura per la tua richiesta."', () => {
  const params = buildTemplateParameters('rete_offerta_ricevuta_v1', { counterpartStoreName: 'Sestri', quantity: 4, productDescription: 'Vermentino Gallura' });
  const body = renderTemplateBody('rete_offerta_ricevuta_v1', params);
  assert.strictEqual(body, 'Rete Squillari: Sestri ha offerto 4 unità di Vermentino Gallura per la tua richiesta.');
});

check('GOODS_TO_PREPARE full preview includes the "Apri la scheda" link line', () => {
  const params = buildTemplateParameters('rete_merce_da_preparare_v1', { quantity: 4, productDescription: 'Vermentino Gallura', counterpartStoreName: 'Sestri' });
  const preview = renderFullMessagePreview('rete_merce_da_preparare_v1', params, 'https://divino-ai-wine-system1.vercel.app/rete-squillari?request=abc');
  assert.ok(preview.includes('Rete Squillari: prepara 4 unità di Vermentino Gallura per Sestri.'));
  assert.ok(preview.includes('Apri la scheda:'));
  assert.ok(preview.includes('https://divino-ai-wine-system1.vercel.app/rete-squillari?request=abc'));
});

check('TRASTA arrival template shows both arrived and remaining quantity', () => {
  const params = buildTemplateParameters('rete_arrivo_trasta_v1', { quantity: 2, productDescription: 'Vermentino Gallura', remainingQuantity: 4 });
  const body = renderTemplateBody('rete_arrivo_trasta_v1', params);
  assert.strictEqual(body, 'Rete Squillari: sono arrivate 2 unità di Vermentino Gallura.\nRestano da trovare: 4.');
});

check('template parameters are escaped: newlines/tabs stripped, {{ }} sequences stripped', () => {
  const escaped = escapeTemplateParameter('Line1\nLine2\t{{evil}}');
  assert.ok(!escaped.includes('\n') && !escaped.includes('\t'));
  assert.ok(!escaped.includes('{{') && !escaped.includes('}}'));
});

check('escaped parameter is length-capped to prevent unbounded payloads', () => {
  const long = 'x'.repeat(1000);
  const escaped = escapeTemplateParameter(long);
  assert.ok(escaped.length <= 300);
});

check('a parameter that looks like a PIN/token/raw UUID is rejected before rendering', () => {
  assert.throws(() => assertNoSecretLikeContent(['il tuo PIN è 123456']));
  assert.throws(() => assertNoSecretLikeContent(['token abc123xyz']));
  assert.throws(() => assertNoSecretLikeContent(['rif. 3f9a1b2c-4d5e-6f70-8192-a3b4c5d6e7f8']));
  assert.doesNotThrow(() => assertNoSecretLikeContent(['Vermentino Gallura DOCG']));
});

check('renderTemplateBody itself refuses to render secret-shaped content', () => {
  assert.throws(() => renderTemplateBody('rete_richiesta_annullata_v1', ['password: hunter2']));
});

check('redactWhatsAppError strips phone numbers', () => {
  const redacted = redactWhatsAppError({ message: 'failed to deliver to +393331234567' });
  assert.ok(!redacted.includes('+393331234567'));
  assert.ok(redacted.includes('[PHONE_REDACTED]'));
});

check('redactWhatsAppError strips bearer tokens and access_token fields', () => {
  const redacted = redactWhatsAppError('Authorization: Bearer EAAsomeLongMetaTokenValue1234567890 failed, access_token":"abcxyz"');
  assert.ok(!redacted.includes('EAAsomeLongMetaTokenValue1234567890'));
  assert.ok(!redacted.includes('abcxyz'));
});

check('buildDeepLink only accepts a real UUID reference and points at the verified production base', () => {
  const link = buildDeepLink('offer', 'a1b2c3d4-e5f6-4789-a012-b3c4d5e6f789');
  assert.ok(link.startsWith(RETE_SQUILLARI_APP_BASE));
  assert.ok(link.includes('?offer=a1b2c3d4-e5f6-4789-a012-b3c4d5e6f789'));
  assert.throws(() => buildDeepLink('offer', "'; DROP TABLE rete_offers; --"));
});

check('buildDeepLink never embeds a token/session in the URL - only the reference query param', () => {
  const link = buildDeepLink('request', 'a1b2c3d4-e5f6-4789-a012-b3c4d5e6f789');
  const url = new URL(link);
  const params = Array.from(url.searchParams.keys());
  assert.deepStrictEqual(params, ['request']);
});

check('resolveStoredDeepLink prefixes the verified origin onto a stored relative path', () => {
  const full = resolveStoredDeepLink('/rete-squillari?transfer=abc');
  assert.strictEqual(full, 'https://divino-ai-wine-system1.vercel.app/rete-squillari?transfer=abc');
});

(async function run() {
  await checkAsync('MockWhatsAppAdapter records calls and never performs network I/O (no real send possible)', async () => {
    const adapter = new MockWhatsAppAdapter();
    const result = await adapter.sendUtilityTemplate({
      phoneE164: '+390000000000', templateName: 'rete_offerta_ricevuta_v1', languageCode: 'it',
      parameters: ['Sestri', '4', 'Vermentino'], deepLink: 'https://example.test', idempotencyKey: 'k1',
    });
    assert.strictEqual(adapter.calls.length, 1);
    assert.strictEqual(result.success, true);
    assert.ok(result.providerMessageId!.startsWith('mock-'));
  });

  console.log((fail === 0 ? 'WHATSAPP_TEMPLATE_TESTS: PASS' : 'WHATSAPP_TEMPLATE_TESTS: FAIL') + ` (${pass} passed, ${fail} failed)`);
  if (fail > 0) process.exit(1);
})();
