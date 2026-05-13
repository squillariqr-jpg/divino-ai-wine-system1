# Funnel Divino AI Wine System

## Obiettivo

Trasformare il sito da semplice presentazione a funnel AI-operated capace di:

- acquisire lead
- classificare profili
- raccomandare il prossimo step
- preparare follow-up automatizzati

## Struttura del funnel

1. Ebook lead magnet
2. Cantina Minima
3. Corso introduttivo in 5 lezioni
4. Wine AI Mastery
5. Wine Buyer Academy

## Snodi principali

- Homepage: presenta le offerte come tappe del funnel
- Quiz: segmenta l’utente con scoring rule-based
- Result card: espone segmento, punteggi, CTA e upsell
- Lead capture: invia i dati a un backend placeholder

## Stati del funnel oggi

- scoring locale in `lib/recommendation.ts`
- lead capture su `POST /api/lead`
- raccomandazione su `POST /api/recommend`
- follow-up solo simulato lato backend placeholder

## Stati futuri

- Supabase per memorizzare lead, profili e risultati quiz
- n8n per email, CRM sync e sequenze
- agent layer per raccomandazione e follow-up adattivi
- Notion per contenuti editoriali e calendario
