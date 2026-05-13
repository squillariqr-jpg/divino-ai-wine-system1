# AI Logic

## Profile classification

Il sistema usa una classificazione rule-based con quattro segmenti:

- `novizio-curioso`
- `appassionato-pratico`
- `builder-digitale`
- `buyer-professionale`

Ogni risposta del quiz assegna punti ai segmenti:

- `level` influenza maturità e capacità decisionale
- `goal` è il segnale più forte per la classificazione
- `taste` rifinisce il profilo con peso secondario
- `budget` aiuta a distinguere profili entry, pragmatici o premium

Il segmento finale è quello con punteggio più alto. In caso di parità viene usato un tie-break coerente con l’obiettivo selezionato.

## Recommendation rules

- Se prevale `novizio-curioso`, il funnel privilegia ebook, Cantina Minima e corso in 5 lezioni
- Se prevale `appassionato-pratico`, il funnel spinge Cantina Minima e corso
- Se prevale `builder-digitale`, il funnel propone Wine AI Mastery
- Se prevale `buyer-professionale`, il funnel propone Wine Buyer Academy
- In ogni caso vengono restituiti due vini basati su gusto e budget

## Upsell rules

- Dai segmenti `novizio-curioso` e `appassionato-pratico` si apre l’upsell a Wine AI Mastery solo se il segnale business/AI supera una soglia
- Dal segmento `builder-digitale` si apre l’upsell a Wine Buyer Academy quando emergono bisogno professionale o punteggi buyer elevati
- Dal segmento `buyer-professionale` si può attivare un cross-sell verso Wine AI Mastery per casi con forte componente contenuti o automazione
- Se non ci sono segnali sufficienti, l’upsell resta spento per mantenere il funnel pulito

## Future OpenClaw + n8n integration points

### OpenClaw or another agent layer

- sostituire o arricchire la classificazione locale con scoring probabilistico
- generare follow-up personalizzati
- proporre next-best-action in base a storico lead e risposta agli step precedenti
- sintetizzare insight utili per team commerciale o editoriale

### n8n

- webhook su nuova lead capture
- webhook su completamento quiz
- sequenze email per lead magnet, corso, mastery e academy
- sync con CRM o database operativo

## Local fallback

Anche dopo l’integrazione, il motore locale dovrebbe restare disponibile come fallback per garantire continuità e semplicità operativa.
