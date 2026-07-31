import crypto from 'crypto';
import type { NotificationEventType } from './types';
import { maskEmailAddress } from './redact';

export type DigestSection = 'DA_PREPARARE' | 'TRASFERIMENTI' | 'ARRIVI_A_TRASTA' | 'ECCEDENZE' | 'RICHIESTE_ANCORA_APERTE' | 'ECCEZIONI';

export const DIGEST_SECTION_LABELS: Record<DigestSection, string> = {
  DA_PREPARARE: 'DA PREPARARE',
  TRASFERIMENTI: 'TRASFERIMENTI',
  ARRIVI_A_TRASTA: 'ARRIVI A TRASTA',
  ECCEDENZE: 'ECCEDENZE',
  RICHIESTE_ANCORA_APERTE: 'RICHIESTE ANCORA APERTE',
  ECCEZIONI: 'ECCEZIONI',
};

const SECTION_BY_EVENT_TYPE: Record<NotificationEventType, DigestSection> = {
  GOODS_TO_PREPARE: 'DA_PREPARARE',
  EXCESS_GOODS_TO_PREPARE: 'DA_PREPARARE',
  GOODS_READY: 'TRASFERIMENTI',
  TRANSFER_STARTED: 'TRASFERIMENTI',
  TRANSFER_RECEIVED: 'TRASFERIMENTI',
  EXCESS_TRANSFER_STARTED: 'TRASFERIMENTI',
  EXCESS_TRANSFER_RECEIVED: 'TRASFERIMENTI',
  TRASTA_PARTIAL_ARRIVAL: 'ARRIVI_A_TRASTA',
  TRASTA_FULL_ARRIVAL: 'ARRIVI_A_TRASTA',
  EXCESS_STOCK_PUBLISHED: 'ECCEDENZE',
  EXCESS_STOCK_RESERVED: 'ECCEDENZE',
  EXCESS_STOCK_PARTIALLY_RESERVED: 'ECCEDENZE',
  EXCESS_STOCK_FULLY_RESERVED: 'ECCEDENZE',
  EXCESS_STOCK_EXPIRED: 'ECCEDENZE',
  EXCESS_STOCK_WITHDRAWN: 'ECCEDENZE',
  OFFER_RECEIVED: 'RICHIESTE_ANCORA_APERTE',
  OFFER_AUTO_ACCEPTED: 'RICHIESTE_ANCORA_APERTE',
  REQUEST_CANCELLED: 'RICHIESTE_ANCORA_APERTE',
  SYSTEM_EXCEPTION: 'ECCEZIONI',
};

export interface DigestEntryInput {
  notificationId: string;
  eventType: NotificationEventType;
  title: string;
  body: string;
  deepLink: string;
  createdAt: string;
}

export interface DigestGroup {
  section: DigestSection;
  label: string;
  entries: DigestEntryInput[];
}

export function groupDigestEntries(entries: DigestEntryInput[]): DigestGroup[] {
  const bySection = new Map<DigestSection, DigestEntryInput[]>();
  for (const entry of entries) {
    const section = SECTION_BY_EVENT_TYPE[entry.eventType];
    if (!bySection.has(section)) bySection.set(section, []);
    bySection.get(section)!.push(entry);
  }
  const order: DigestSection[] = ['DA_PREPARARE', 'TRASFERIMENTI', 'ARRIVI_A_TRASTA', 'ECCEDENZE', 'RICHIESTE_ANCORA_APERTE', 'ECCEZIONI'];
  return order
    .filter((section) => bySection.has(section))
    .map((section) => ({ section, label: DIGEST_SECTION_LABELS[section], entries: bySection.get(section)! }));
}

export const DIGEST_SUBJECT = 'Rete Squillari - riepilogo operativo del giorno';

export interface RenderedDigest {
  subject: string;
  textBody: string;
  htmlBody: string;
  groups: DigestGroup[];
  notificationIds: string[];
}

export function renderDigest(storeName: string, dateISO: string, entries: DigestEntryInput[], appBaseUrl: string): RenderedDigest {
  const groups = groupDigestEntries(entries);
  const lines: string[] = [];
  lines.push(DIGEST_SUBJECT);
  lines.push(storeName + ' - ' + dateISO);
  lines.push('');
  if (groups.length === 0) {
    lines.push('Nessuna novita da segnalare oggi.');
  }
  for (const group of groups) {
    lines.push(group.label);
    for (const entry of group.entries) {
      lines.push('- ' + entry.body + ' (' + appBaseUrl + entry.deepLink + ')');
    }
    lines.push('');
  }
  const textBody = lines.join('\n').trim();

  const htmlGroups = groups
    .map((group) => {
      const items = group.entries
        .map((entry) => '<li>' + escapeHtml(entry.body) + ' - <a href="' + escapeHtml(appBaseUrl + entry.deepLink) + '">Apri</a></li>')
        .join('');
      return '<h3>' + escapeHtml(group.label) + '</h3><ul>' + items + '</ul>';
    })
    .join('');
  const htmlBody = '<div><h2>' + escapeHtml(DIGEST_SUBJECT) + '</h2><p>' + escapeHtml(storeName) + ' - ' + escapeHtml(dateISO) + '</p>' + (htmlGroups || '<p>Nessuna novita da segnalare oggi.</p>') + '</div>';

  return { subject: DIGEST_SUBJECT, textBody, htmlBody, groups, notificationIds: entries.map((e) => e.notificationId) };
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function computeDigestHash(locationCode: string, dateISO: string, notificationIds: string[], subject: string): string {
  const sorted = [...notificationIds].sort();
  const material = locationCode + '|' + dateISO + '|' + subject + '|' + sorted.join(',');
  return crypto.createHash('sha256').update(material).digest('hex');
}

export function maskedDestination(email: string | null): string {
  if (!email) return 'NOT_CONFIGURED';
  return maskEmailAddress(email);
}
