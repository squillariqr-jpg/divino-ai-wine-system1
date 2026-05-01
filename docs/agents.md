# Divino AI Wine System — Agent Layer

## Obiettivo

Il funnel ora espone un layer di orchestrazione deterministico che decide quale agente deve prendere in carico il lead dopo il quiz o la diagnosi business.

Il sistema non usa ancora LLM in produzione: la logica resta rule-based e leggibile, cosi possiamo far girare la v1 localmente e sostituire i nodi in seguito senza rompere i contratti.

## Agent Router

File principale: `lib/agents/router.ts`

Input del router:

- risposte quiz normalizzate
- segmento prodotto da `lib/recommendation.ts`
- contesto opzionale del flow
- eventuale payload del quiz business

Ordine decisionale attuale:

1. se il flow e business, usa `business_agent`
2. se l'intento e buyer/professionale, usa `buyer_agent`
3. se il segmento e builder digitale con focus contenuti, usa `content_agent`
4. se il segmento e builder digitale con focus crescita commerciale, usa `sales_agent`
5. se il profilo e avanzato sul gusto, usa `sommelier_agent`
6. fallback su `consumer_agent`

## Responsabilita Agenti

### `consumer_agent`

- interpreta il profilo wine consumer
- produce sintesi stile vino
- propone contenuto consigliato
- restituisce 2 vini suggeriti
- imposta il next best action consumer

### `business_agent`

- riceve il risultato del quiz business
- classifica il sistema mancante:
  - Acquisition System
  - Retention System
  - Automation System
  - Content System
- produce diagnosi, sistema consigliato, benefici e follow-up copy

### `buyer_agent`

- gestisce intenti buyer e professionali
- qualifica lead Academy
- genera next step, email subject/body e nota interna

### `content_agent`

- gestisce creator e builder digitali
- porta il lead verso un sistema contenuti e `Wine AI Mastery`

### `sales_agent`

- gestisce esigenze di crescita e conversione
- orienta verso diagnosi business e sistema di vendita

### `sommelier_agent`

- gestisce profili piu evoluti lato gusto
- mantiene un tono piu selettivo e meno introduttivo

## API Flow

### `POST /api/recommend`

- costruisce la recommendation base con `lib/recommendation.ts`
- passa risultato + contesto al router
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

- sostituzione del router deterministico con una policy piu adattiva
- generazione di follow-up piu personalizzati
- re-ranking di vini, contenuti e offerte

Nota:
per ora i file contengono TODO espliciti nei boundary giusti, cosi il passaggio a un layer agentico vero non richiede di riprogettare i payload.

### WBOS

- backoffice operativo per richieste commerciali premium
- gestione di task umani attivati dagli agenti
- supervisione dei lead ad alto valore
