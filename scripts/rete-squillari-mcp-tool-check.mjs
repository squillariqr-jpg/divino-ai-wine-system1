// One-off verification script for Phase 5 of the MCP product-cards gate.
// Not part of the shipped application. Reads RETE_MCP_BASE_URL/TOKEN from
// the environment, calls every allowed tool once, and reports status.
import { readFileSync } from 'fs';

const envFile = readFileSync('.env.local', 'utf8');
const env = Object.fromEntries(
  envFile.split('\n').filter((l) => l.includes('=')).map((l) => {
    const idx = l.indexOf('=');
    return [l.slice(0, idx), l.slice(idx + 1)];
  })
);
const BASE = env.RETE_MCP_BASE_URL;
const TOKEN = env.RETE_MCP_TOKEN;

const TOOLS = [
  ['rete_get_health', {}],
  ['rete_get_pilot_status', {}],
  ['rete_list_locations', {}],
  ['rete_list_pending_confirmations', {}],
  ['rete_list_open_requests', {}],
  ['rete_get_request', { request_id: '00000000-0000-0000-0000-000000000000' }],
  ['rete_list_offers', {}],
  ['rete_list_transfers', {}],
  ['rete_list_receipt_discrepancies', {}],
  ['rete_get_request_audit', { request_id: '00000000-0000-0000-0000-000000000000' }],
];

let id = 1;
for (const [tool, args] of TOOLS) {
  const start = Date.now();
  let httpStatus = null, jsonRpcStatus = null, authStatus = 'N/A', resultCount = null, error = null;
  try {
    const res = await fetch(`${BASE}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: id++, method: 'tools/call', params: { name: tool, arguments: args } }),
    });
    httpStatus = res.status;
    const body = await res.json();
    if (body.error) {
      jsonRpcStatus = 'error';
      error = body.error.data?.reason_code || body.error.message;
      authStatus = error === 'AUTHORIZATION_DENIED' ? 'DENIED' : 'OK';
    } else {
      jsonRpcStatus = 'ok';
      authStatus = 'OK';
      const sc = body.result?.structuredContent || {};
      const arrKey = Object.keys(sc).find((k) => Array.isArray(sc[k]));
      resultCount = arrKey ? sc[arrKey].length : (typeof sc === 'object' ? Object.keys(sc).length : null);
    }
  } catch (e) {
    error = String(e);
  }
  const duration = Date.now() - start;
  console.log(JSON.stringify({ tool, httpStatus, jsonRpcStatus, authStatus, resultCount, durationMs: duration, error }));
}
