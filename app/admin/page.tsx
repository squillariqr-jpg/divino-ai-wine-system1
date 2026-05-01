import { getPlaceholderAdminSnapshot } from "@/lib/placeholder-backend";

export const dynamic = "force-dynamic";

const statCards = [
  {
    key: "totalLeads",
    label: "Lead totali"
  },
  {
    key: "consumerLeads",
    label: "Lead consumer"
  },
  {
    key: "businessLeads",
    label: "Lead business"
  },
  {
    key: "buyerLeads",
    label: "Lead buyer"
  }
] as const;

export default function AdminPage() {
  const snapshot = getPlaceholderAdminSnapshot();

  return (
    <main className="bg-gradient-to-b from-cream via-cream to-white">
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="rounded-[32px] bg-ink px-6 py-8 text-cream shadow-soft sm:px-10">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-gold/85">
            Admin placeholder
          </p>
          <h1 className="mt-3 text-4xl sm:text-5xl">
            Dashboard agentica Divino AI Wine System
          </h1>
          <p className="mt-4 max-w-3xl leading-8 text-cream/82">
            Area demo per leggere lead, segmenti e ultime decisioni degli agenti.
            Nessuna autenticazione reale e ancora attiva: questa pagina resta un
            placeholder protetto da collegare piu avanti a Supabase Auth o al tuo
            layer interno.
          </p>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {statCards.map((card) => (
            <article
              key={card.key}
              className="rounded-[28px] border border-burgundy/10 bg-white/80 p-6 shadow-soft"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-burgundy/70">
                {card.label}
              </p>
              <p className="mt-4 text-4xl font-bold text-ink">
                {snapshot[card.key]}
              </p>
            </article>
          ))}
        </div>

        <div className="mt-10 grid gap-8 xl:grid-cols-[1.15fr_0.85fr]">
          <section className="rounded-[28px] border border-burgundy/10 bg-white/80 p-6 shadow-soft sm:p-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="section-eyebrow">Starter leads</p>
                <h2 className="mt-2 text-3xl text-ink">Lead recenti nel backend placeholder</h2>
              </div>
              <span className="rounded-full bg-burgundy/8 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-burgundy">
                Demo data
              </span>
            </div>

            <div className="mt-6 overflow-hidden rounded-[24px] border border-burgundy/10">
              <table className="min-w-full divide-y divide-burgundy/10 text-left text-sm">
                <thead className="bg-cream/70 text-burgundy/80">
                  <tr>
                    <th className="px-4 py-4 font-semibold">Lead</th>
                    <th className="px-4 py-4 font-semibold">Source</th>
                    <th className="px-4 py-4 font-semibold">Segmento</th>
                    <th className="px-4 py-4 font-semibold">Agente</th>
                    <th className="px-4 py-4 font-semibold">Next action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-burgundy/10 bg-white/85 text-ink/80">
                  {snapshot.leads.map((lead) => (
                    <tr key={lead.leadId}>
                      <td className="px-4 py-4 align-top">
                        <p className="font-semibold text-ink">
                          {lead.payload.name ?? "Lead anonimo"}
                        </p>
                        <p className="mt-1 text-xs text-ink/55">{lead.payload.email}</p>
                      </td>
                      <td className="px-4 py-4 align-top">{lead.source}</td>
                      <td className="px-4 py-4 align-top">
                        {lead.segment ?? "n.d."}
                      </td>
                      <td className="px-4 py-4 align-top">
                        {lead.agentName ?? "n.d."}
                      </td>
                      <td className="px-4 py-4 align-top">{lead.nextStep}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-6">
            <div className="rounded-[28px] border border-bottle/12 bg-white/80 p-6 shadow-soft sm:p-8">
              <p className="section-eyebrow">Ultime decisioni agenti</p>
              <div className="mt-5 space-y-4">
                {snapshot.lastAgentDecisions.map((lead) => (
                  <article
                    key={`${lead.leadId}-decision`}
                    className="rounded-[22px] border border-bottle/10 bg-bottle/5 p-4"
                  >
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-bottle/80">
                      {lead.agentName}
                    </p>
                    <h3 className="mt-2 text-lg text-ink">
                      {lead.agentDecision?.profileLabel ?? "Decisione agente"}
                    </h3>
                    <p className="mt-2 leading-7 text-ink/75">
                      {lead.agentDecision?.diagnosis ?? lead.nextStep}
                    </p>
                    <p className="mt-3 text-sm font-semibold text-burgundy">
                      {lead.nextStep}
                    </p>
                  </article>
                ))}
              </div>
            </div>

            <div className="rounded-[28px] bg-burgundy p-6 text-cream shadow-soft sm:p-8">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gold/85">
                TODO integrazioni
              </p>
              <ul className="mt-4 space-y-3 leading-7 text-cream/85">
                <li>Supabase come archivio persistente di lead e profili.</li>
                <li>n8n per follow-up, tagging e orchestrazione commerciale.</li>
                <li>OpenClaw o altro agent layer per raccomandazioni adattive.</li>
                <li>Notion o WBOS come backoffice editoriale e operativo.</li>
              </ul>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
