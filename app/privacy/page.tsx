/* eslint-disable react/no-unescaped-entities */
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — Divino AI",
  description: "Informativa sul trattamento dei dati personali ai sensi del GDPR."
};

export default function PrivacyPage() {
  return (
    <div className="container-shell py-16">
      <div className="mx-auto max-w-3xl">
        <p className="section-eyebrow">Informativa</p>
        <h1 className="mt-3 text-4xl font-bold text-ink">Privacy Policy</h1>
        <p className="mt-4 text-sm text-ink/50">
          Ultimo aggiornamento: marzo 2025
        </p>

        <div className="prose prose-stone mt-10 max-w-none leading-7 text-ink/80">

          <h2 className="mt-8 text-xl font-semibold text-ink">1. Titolare del trattamento</h2>
          <p>
            Il titolare del trattamento è <strong>Luca Toesca – Divino Market, L'Outlet del Vino</strong>,
            email:{" "}
            <a href="mailto:luca@divinomarket.it" className="text-burgundy underline">
              luca@divinomarket.it
            </a>
            . Per qualsiasi richiesta relativa alla privacy scrivi a questo indirizzo.
          </p>

          <h2 className="mt-8 text-xl font-semibold text-ink">2. Dati personali raccolti</h2>
          <ul className="mt-2 list-disc pl-5 space-y-1">
            <li>nome (facoltativo);</li>
            <li>indirizzo email;</li>
            <li>risposte al quiz e preferenze relative al vino;</li>
            <li>dati tecnici strettamente necessari al funzionamento del sito;</li>
            <li>contenuti dei messaggi inviati volontariamente dall'utente.</li>
          </ul>

          <h2 className="mt-8 text-xl font-semibold text-ink">3. Finalità del trattamento</h2>
          <ul className="mt-2 list-disc pl-5 space-y-1">
            <li>fornire il risultato del quiz e il percorso personalizzato richiesto;</li>
            <li>
              inviare comunicazioni <strong>informative, educative e promozionali</strong> relative
              ai contenuti e ai prodotti del progetto Divino AI (email marketing), previo consenso
              dell'utente;
            </li>
            <li>gestire richieste di contatto, supporto o risposta personalizzata;</li>
            <li>migliorare i contenuti, i prodotti e l'esperienza utente del sito;</li>
            <li>adempiere a obblighi di legge o richieste delle autorità competenti.</li>
          </ul>

          <h2 className="mt-8 text-xl font-semibold text-ink">4. Base giuridica</h2>
          <p>
            Il trattamento si basa sul consenso espresso dell'utente e/o sull'esecuzione di misure
            precontrattuali richieste dall'utente, come l'invio di un percorso personalizzato o di
            informazioni su contenuti e prodotti di interesse.
          </p>

          <h2 className="mt-8 text-xl font-semibold text-ink">5. Conservazione dei dati</h2>
          <p>
            I dati sono conservati per il tempo strettamente necessario alle finalità per cui sono
            raccolti, salvo obblighi di legge. I dati usati per comunicazioni email resteranno trattati
            fino a revoca del consenso o richiesta di cancellazione.
          </p>

          <h2 className="mt-8 text-xl font-semibold text-ink">6. Destinatari e fornitori tecnici</h2>
          <p>
            I dati potranno essere trattati dai seguenti fornitori tecnici, coinvolti nell'erogazione
            del servizio e nominati se necessario responsabili del trattamento:
          </p>
          <ul className="mt-2 list-disc pl-5 space-y-1">
            <li><strong>Vercel Inc.</strong> — hosting e deployment del sito (USA, standard contractual clauses);</li>
            <li><strong>Supabase Inc.</strong> — database e storage dei dati lead (USA, standard contractual clauses);</li>
            <li><strong>AgentMail</strong> — infrastruttura email agentica per l'invio e la ricezione delle comunicazioni;</li>
            <li><strong>Anthropic PBC</strong> — elaborazione linguistica per la generazione di risposte personalizzate (USA, standard contractual clauses).</li>
          </ul>
          <p className="mt-2">
            Non cediamo dati a terzi per finalità di marketing esterno.
          </p>

          <h2 className="mt-8 text-xl font-semibold text-ink">7. Trasferimenti extra UE</h2>
          <p>
            Alcuni fornitori tecnici potrebbero trattare dati al di fuori dello Spazio Economico Europeo.
            In tali casi il trattamento avviene nel rispetto delle garanzie previste dal GDPR.
          </p>

          <h2 className="mt-8 text-xl font-semibold text-ink">8. Diritti dell'interessato</h2>
          <p>
            Puoi in qualsiasi momento richiedere accesso, rettifica, cancellazione, limitazione,
            opposizione al trattamento e portabilità dei dati, scrivendo a{" "}
            <a href="mailto:luca@divinomarket.it" className="text-burgundy underline">
              luca@divinomarket.it
            </a>.
            Hai inoltre il diritto di proporre reclamo al Garante per la protezione dei dati personali.
          </p>

          <h2 className="mt-8 text-xl font-semibold text-ink">9. Minori</h2>
          <p>
            Il sito, i contenuti e i prodotti relativi al vino sono destinati esclusivamente a utenti
            maggiorenni (18 anni o più). Non raccogliamo consapevolmente dati di minori.
          </p>

          <h2 className="mt-8 text-xl font-semibold text-ink">10. Cookie</h2>
          <p>
            Il sito utilizza cookie tecnici strettamente necessari al funzionamento (ad esempio per
            ricordare la verifica dell'età). Non utilizziamo, allo stato attuale, cookie di profilazione
            o analytics non tecnici. Qualora venissero introdotti strumenti di tracciamento ulteriori,
            questa informativa sarà aggiornata e sarà richiesto il consenso appropriato.
          </p>

        </div>
      </div>
    </div>
  );
}
