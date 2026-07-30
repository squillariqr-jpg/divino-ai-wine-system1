#!/usr/bin/env node
// In-app delivery reconciliation worker. IN_APP deliveries are created
// READY transactionally by the business RPCs themselves (via
// rete_notification_enqueue_event -> rete_notification_route_deliveries) -
// they are already visible through rete_notifications_list the instant
// the business transaction commits. This worker only promotes READY ->
// DELIVERED for bookkeeping/metrics; it changes no user-visible behavior.
// NOT scheduled by this file - no cron, no setInterval, no timer.
//
// Usage: npx tsx scripts/rete-squillari-notifications-in-app-worker.ts [--dry-run] [--limit N]
import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY must be set');
  return createClient(url, key);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const limitArg = args.find((a) => a.startsWith('--limit'));
  const limit = limitArg ? Number(limitArg.split('=')[1] || args[args.indexOf(limitArg) + 1]) : 100;

  const supabase = getSupabase();
  const { data: rows, error: selectErr } = await supabase
    .from('rete_notification_deliveries')
    .select('id')
    .eq('channel', 'IN_APP')
    .eq('status', 'READY')
    .limit(limit);
  if (selectErr) throw new Error('select failed: ' + selectErr.message);

  const ids = (rows || []).map((r: { id: string }) => r.id);
  console.log(JSON.stringify({ WORKER_RUN: true, DRY_RUN: dryRun, CLAIMED_COUNT: ids.length }));

  if (dryRun || ids.length === 0) return;

  const { error: updateErr } = await supabase
    .from('rete_notification_deliveries')
    .update({ status: 'DELIVERED', sent_at: new Date().toISOString() })
    .in('id', ids);
  if (updateErr) throw new Error('update failed: ' + updateErr.message);

  console.log(JSON.stringify({ WORKER_DONE: true, RECONCILED_COUNT: ids.length }));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
