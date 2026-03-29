# Divino AI Wine System

V1 iniziale di un sito premium dedicato a educazione enologica, AI commerce e raccomandazioni vino personalizzate.

## Stack

- Next.js App Router
- TypeScript
- Tailwind CSS

## Pagine incluse

- Homepage
- Quiz in 4 step
- Wine Buyer Academy
- Wine AI Mastery

## API incluse

- `POST /api/lead`
- `POST /api/recommend`

## Avvio locale

```bash
npm install
npm run dev
```

Apri [http://localhost:3000](http://localhost:3000).

## Dati starter

- `/data/wines.json`
- `/data/products.json`
- `/data/personas.json`

## Documentazione funnel

- `/docs/funnel.md`
- `/docs/ai-logic.md`
- `/docs/roadmap.md`

## Placeholder integrazioni future

- `.env.example` contiene i placeholder per Supabase, n8n, layer agentico e Notion
- `lib/integrations.ts` espone le interfacce per repository, workflow, agent layer e backoffice editoriale

## Contenuti starter

- `/content/cantina-minima.md`
- `/content/ebook.md`
- `/content/corso-5-lezioni.md`
- `/content/wine-ai-mastery.md`
- `/content/wine-buyer-academy.md`

## Logica quiz

- Se il profilo è principiante, il sistema consiglia il corso in 5 lezioni
- Se emerge interesse AI/business, il sistema consiglia Wine AI Mastery
- Se il profilo è professionale o buyer, il sistema consiglia Wine Buyer Academy
- In ogni caso vengono suggeriti 2 vini in base a gusto e budget

## Note

Questa versione evita integrazioni esterne e persistenze complesse: l’obiettivo è una base v1 forte, pulita e pronta da evolvere.
