# Divino AI Wine System — Hermes Orchestrator

## Obiettivo

Il funnel ora espone un layer di orchestrazione deterministico chiamato `Hermes Orchestrator`, che decide quale agente deve prendere in carico il lead dopo il quiz o la diagnosi business.

Il sistema non usa ancora LLM in produzione: la logica resta rule-based e leggibile, cosi possiamo far girare la v1 localmente e sostituire i nodi in seguito senza rompere i contratti.

## Struttura Hermes

File principali:

- `lib/hermes/orchestrator.ts`
- `lib/hermes/types.ts`
- `lib/hermes/memory.ts`
- `lib/hermes/agents/*`

Input dell'orchestratore:

- risposte quiz normalizzate
- segmento prodotto da `lib/recommendation.ts`
- contesto opzionale del flow
- eventuale payload del quiz business

Ordine decisionale attuale:

1. `segment_agent` capisce se l'utente e `appassionato`, `business` o `buyer`
2. `sommelier_agent` gestisce il percorso appassionato
3. `business_agent` gestisce la diagnosi business principale
4. `content_agent` interviene quando la leva critica sono contenuti e asset editoriali
5. `sales_agent` interviene quando la leva critica e conversione, CTA e follow-up
6. `buyer_agent` gestisce buyer e professionisti
7. `memory_agent` salva profilo, preferenze, storico e prossime azioni

## Responsabilita Agenti

### `segment_agent`

- classifica l'utente in uno dei 3 percorsi principali
- aggiunge una rationale esplicita che il resto del sistema puo usare

### `sommelier_agent`

- interpreta il profilo wine consumer
- produce sintesi stile vino
- propone contenuto consigliato
- restituisce 2 vini suggeriti
- imposta il next best action consumer

### `business_agent`

- lavora per enoteche, ristoranti, ecommerce e aziende vino
- riceve il risultato del quiz business
- classifica il sistema mancante:
  - Acquisition System
  - Retention System
  - Automation System
  - Content System
- produce diagnosi, sistema consigliato, benefici e follow-up copy

### `content_agent`

- genera newsletter, post, schede vino e QR card
- gestisce creator e builder digitali
- porta il lead verso un sistema contenuti e `Wine AI Mastery`

### `sales_agent`

- gestisce CTA, offerte, follow-up e lead conversion
- orienta verso diagnosi business e sistema di vendita

### `buyer_agent`

- orienta professionisti e buyer
- qualifica lead Academy
- genera next step, email subject/body e nota interna

### `memory_agent`

- salva profilo, preferenze, storico e prossime azioni
- prepara il funnel per future memorie persistenti in Supabase o CRM

## API Flow

### `POST /api/recommend`

- costruisce la recommendation base con `lib/recommendation.ts`
- passa risultato + contesto all'orchestratore Hermes
- restituisce:
  - `recommendation`
  - `agentDecision`

### `POST /api/lead`

- salva il lead nel placeholder backend
- conserva:
  - source
  - segment
  - agent name
  - next action
  - agentDecision completo
-  memoria sintetica del profilo
- prova poi a sincronizzare anche su Supabase in best-effort

## Admin Placeholder

Pagina: `app/admin/page.tsx`

Mostra:

- lead totali
- lead consumer
- lead business
- lead buyer
- ultime decisioni agenti
- lead starter/mock dal placeholder backend

Non c'e ancora autenticazione reale.

## Future Integrations

### Supabase

- persistenza reale di lead, profili e audit trail agenti
- dashboard e filtri lato admin
- auth per l'area `/admin`

### AgentMail

- invio email follow-up da `followUpEmailSubject` e `followUpEmailBody`
- tracciamento aperture, reply e stato del lead

### n8n

- orchestrazione webhook dopo `/api/lead`
- tagging lead e branch automation
- sync con CRM, mailer e fogli operativi

### OpenClaw / OpenAI / Anthropic / LangChain

- sostituzione dell'orchestratore deterministico con una policy piu adattiva
- generazione di follow-up piu personalizzati
- re-ranking di vini, contenuti e offerte

Nota:
per ora i file contengono TODO espliciti nei boundary giusti, cosi il passaggio a un layer agentico vero non richiede di riprogettare i payload.

### WBOS

- backoffice operativo per richieste commerciali premium
- gestione di task umani attivati dagli agenti
- supervisione dei lead ad alto valore
