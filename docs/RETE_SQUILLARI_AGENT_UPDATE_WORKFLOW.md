# Rete Squillari — workflow aggiornamenti agente

Questo documento governa gli aggiornamenti del prototipo pubblico `public/rete-squillari/`.

## Permessi di OpenClaw

OpenClaw può:

- leggere il frontend;
- preparare modifiche;
- creare branch isolati;
- eseguire controlli statici e test Playwright;
- produrre screenshot;
- preparare una Pull Request.

OpenClaw non può:

- modificare direttamente `main`;
- eseguire deploy senza autorizzazione;
- modificare quantità operative reali;
- approvare trasferimenti;
- risolvere conflitti commerciali;
- modificare o cancellare audit;
- introdurre backend o servizi esterni senza un gate separato.

## Workflow

```text
Richiesta Luca
→ branch isolato
→ modifica agente
→ controllo statico
→ Playwright
→ screenshot
→ diff
→ approvazione Luca
→ eventuale push
→ Pull Request
→ merge autorizzato
→ deploy
```

La directory pubblica contiene solo dati dimostrativi e non è collegata a Gmail, WBOS, database, notifiche o sistemi operativi reali.

La riconciliazione quantitativa delle azioni `riduci` e `lascia entrambi` resta soggetta a una decisione commerciale separata.
