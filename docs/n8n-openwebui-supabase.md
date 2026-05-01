# Divino AI Wine System — n8n + OpenWebUI + Supabase

## Obiettivo

Questo kit collega il funnel Divino a un workflow AI-operated:

- il sito salva il lead
- `Hermes` interpreta il contesto
- `n8n` orchestra l'evento
- `OpenWebUI` genera contenuti
- `Supabase` conserva memoria e storico

La UX del sito non dipende da `n8n`: se il webhook e offline, il lead resta comunque salvato localmente e il form risponde correttamente.

## Workflow Structure

Flusso consigliato:

1. `Next.js` riceve il lead su `POST /api/lead`
2. il lead viene salvato nel placeholder backend
3. se configurato, il sito inoltra i lead business a `DIVINO_N8N_WEBHOOK_URL`
4. `n8n` decide il ramo operativo
5. `OpenWebUI` genera email o contenuti
6. `Supabase` salva il record strutturato
7. `AgentMail` o un nodo email invia il follow-up

Payload inoltrato dal sito a `n8n`:

```json
{
  "name": "",
  "email": "",
  "businessType": "",
  "problem": "",
  "goal": "",
  "recommendedSystem": "",
  "quizResult": ""
}
```

## Required Env Variables

Da configurare nel sito o in `n8n`:

```env
DIVINO_N8N_WEBHOOK_URL=http://localhost:5678/webhook/divino-lead
OPENWEBUI_URL=http://localhost:3001
OPENWEBUI_API_KEY=your_openwebui_key
OPENWEBUI_MODEL=qwen
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

## n8n Workflow

Nome consigliato:

`Divino AI Wine System - Lead Orchestration`

Struttura:

1. `Webhook`
2. `Function` o `Code`
3. `HTTP Request` verso OpenWebUI
4. `HTTP Request` verso Supabase REST
5. `Email` o `AgentMail` placeholder
6. `Respond to Webhook`

Prompt rapido da dare a n8n o a un builder assistito:

```text
Create an n8n workflow called "Divino AI Wine System - Lead Orchestration".

Trigger:
POST webhook path: divino-lead

Expected payload:
{
  "name": "",
  "email": "",
  "businessType": "",
  "problem": "",
  "goal": "",
  "recommendedSystem": "",
  "quizResult": ""
}

Nodes:
1. Webhook node
2. Function node: decide Hermes action
3. HTTP Request node to OpenWebUI:
   POST {{OPENWEBUI_URL}}/api/chat/completions
   Headers:
   Authorization: Bearer {{OPENWEBUI_API_KEY}}
   Content-Type: application/json
4. HTTP Request node to Supabase REST API:
   POST {{SUPABASE_URL}}/rest/v1/divino_leads
   Headers:
   apikey: {{SUPABASE_SERVICE_ROLE_KEY}}
   Authorization: Bearer {{SUPABASE_SERVICE_ROLE_KEY}}
   Content-Type: application/json
   Prefer: return=representation
5. Email placeholder node or AgentMail HTTP node
6. Respond to Webhook node

Function logic:
- if problem includes "pochi clienti" => action = acquisition
- if problem includes "fidelizzare" => action = retention
- if problem includes "tempo" or "manuale" => action = automation
- if problem includes "schede" or "contenuti" => action = content
- otherwise action = business_pro

OpenWebUI prompt:
Generate a short premium Italian follow-up email for the business lead.
Return JSON with:
{
  "subject": "",
  "body": "",
  "internal_note": "",
  "next_action": ""
}

Test the workflow with sample payload.
```

## OpenWebUI Prompt Template

Collection consigliata:

`Divino Business Agent`

System prompt:

```text
Sei Divino Business Agent, un consulente AI specializzato nel settore vino.

Aiuti enoteche, ristoranti, ecommerce vino e piccole aziende vinicole a vendere meglio usando AI, contenuti, quiz, sommelier virtuale, email marketing e automazione.

Tono:
- premium ma accessibile
- concreto
- commerciale ma non aggressivo
- italiano naturale

Obiettivo:
trasformare un risultato quiz in una proposta chiara, utile e orientata alla vendita.

Rispondi sempre in JSON valido con:
{
  "subject": "",
  "body": "",
  "internal_note": "",
  "next_action": ""
}
```

User prompt template:

```text
Dati lead:
Nome: {{name}}
Email: {{email}}
Tipo attività: {{businessType}}
Problema principale: {{problem}}
Obiettivo: {{goal}}
Sistema consigliato: {{recommendedSystem}}
Risultato quiz: {{quizResult}}

Crea una email di follow-up breve e professionale.
La mail deve:
1. ringraziare la persona
2. riassumere il problema
3. spiegare perché il sistema consigliato è adatto
4. proporre una call o contatto
5. non sembrare generica

Crea anche:
- una nota interna per Luca
- la prossima azione consigliata
```

## Supabase Schema

Schema minimo per i lead orchestrati:

```sql
create table if not exists divino_leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null,
  email text not null,
  business_type text,
  problem text,
  goal text,
  segment text,
  recommended_system text,
  quiz_result jsonb,
  agent_name text default 'business_agent',
  agent_action text,
  agent_subject text,
  agent_body text,
  internal_note text,
  next_action text,
  source text default 'quiz_business',
  status text default 'new'
);

create index if not exists idx_divino_leads_email
on divino_leads (email);

create index if not exists idx_divino_leads_status
on divino_leads (status);

create index if not exists idx_divino_leads_created_at
on divino_leads (created_at desc);
```

Nota:

nel repo esiste gia anche uno schema piu esteso in [supabase-schema.sql](/Users/luca/codex/divino-ai-wine-system/docs/supabase-schema.sql), utile se vuoi tracciare thread email, messaggi e job di sequenza.
