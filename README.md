# Signaleringen — Edge-extensie

Browserversie van de Android-app. Volgt RSS-feeds en webpagina's per profiel,
filtert de publicaties op relevantie met een LLM en bundelt de relevante
publicaties tot **één signalering per profiel**.

Uitgebreide architectuurbeschrijving: `Signaleringen/Design - Architectuur browserextensie.md`
in de Obsidian-vault.

## Laden tijdens ontwikkeling

1. Ga naar `edge://extensions`
2. Zet **Ontwikkelaarsmodus** aan
3. **Uitgepakt laden** → kies deze map (`extension/`)

Na een codewijziging: **Opnieuw laden** op de extensiekaart. De service worker
inspecteer je via de link *service worker* op diezelfde kaart.

## Eerste configuratie

1. Open het dashboard (pictogram → **Dashboard**, of via `edge://extensions` → Opties)
2. **Instellingen** → route op *Eigen API-key in deze browser*, plak je
   OpenRouter-key en sla op. De browser vraagt dan toestemming voor
   `openrouter.ai`.
3. Laat **Model** op `@preset/signaleringen` staan. Die preset zit in de
   OpenRouter-workspace `signaleringen` en draagt de provider-routing
   (`order: ["deepinfra"]`, `allow_fallbacks: false`).
4. **Verbinding testen** — hoort `ok` terug te geven.
5. **Profielen** → *Nieuw profiel*: naam, onderwerpomschrijving, eventueel een
   eigen instructie voor de signalering, en één of meer bronnen.
6. Per bron **Testen**; de browser vraagt bij de eerste test toestemming voor
   die host.

## Vooringevulde key voor eigen gebruik

Maak naast `manifest.json` een bestand `local-settings.json` (voorbeeld:
`local-settings.example.json`) met je eigen key:

```json
{ "directApiKey": "sk-or-…" }
```

Het key-veld bij Instellingen staat dan vooringevuld. Klik één keer op
**Opslaan**, zodat de browser toestemming voor `openrouter.ai` vraagt. Het
bestand staat in `.gitignore` en komt dus niet in de repo en niet in een
uitrolpakket.

## Uitrol naar collega's

Iedere collega krijgt een **eigen key op zijn of haar naam** uit de
OpenRouter-workspace `signaleringen`, met een eigen uitgavenlimiet (B-42). In
de extensie is het key-veld leeg; de collega plakt de eigen key erin (stap 2
van *Eerste configuratie*). Zie besluit B-D09 in de vault.

Maak het pakket altijd uit git, nooit door de map te kopiëren of te zippen:

```bash
mkdir -p dist && git archive --format=zip -o dist/signaleringen-$(git describe --always).zip HEAD
```

`git archive` neemt alleen gecommitte bestanden mee, dus `local-settings.json`
met jouw key zit er gegarandeerd niet in. Controleer het zo:

```bash
unzip -l dist/signaleringen-*.zip | grep local-settings
```

Alleen `local-settings.example.json` hoort daar te staan.

## Permissiemodel

De extensie declareert geen enkele host-permissie vooraf — alleen
`optional_host_permissions`. Toestemming wordt per host gevraagd op het moment
dat je een bron of proxy toevoegt, altijd vanuit een klik. Dat is nodig voor de
Edge Add-ons-certificering (permissies "voor later" aanvragen is verboden) en
beperkt de blootstelling tot precies de hosts die je zelf hebt ingevoerd.

Vaste permissies en waarom ze nodig zijn:

| Permissie | Waarvoor |
| --- | --- |
| `storage` | Profielen, instellingen en scangeschiedenis |
| `contextMenus` | "Deze pagina toevoegen als bron" |
| `sidePanel` | Signalering naast de pagina lezen |

Optioneel, pas gevraagd bij het aanzetten van de betreffende functie:

| Permissie | Waarvoor |
| --- | --- |
| `alarms` | Automatisch synthetiseren op een interval |

## Scannen

Standaard start een scan alleen door op **Scan** te klikken bij een profiel — in
de popup, het dashboard of het side panel.

Daarnaast kun je per profiel **automatisch synthetiseren** aanzetten. Dat werkt
in twee lagen, expres:

1. Een **hoofdschakelaar** bij Instellingen. Zolang die uit staat gebeurt er
   niets automatisch. Aanzetten vraagt de optionele permissie voor
   achtergrondtaken (`alarms`) — een verse installatie heeft die niet.
2. Een **interval per profiel** bij Bewerken: elk uur tot elke week. Verschillende
   onderwerpen hebben verschillende tempo's; één globaal interval zou dat
   platslaan.

Eén alarm tikt elk kwartier en kijkt wie aan de beurt is. "Aan de beurt" wordt
afgeleid uit de datum van de laatste scan, dus een handmatige scan schuift de
klok mee. Meldingen vraagt de extensie niet: wat de automaat oplevert zie je bij
het openen van de extensie.

## Signaleringen teruglezen

Per profiel is er een knop **Lees signalering** die direct de recentste
signalering opent, en **Alle signaleringen** voor de volledige lijst. De nieuwste
staat open, oudere ingeklapt. Er blijven maximaal 5 scans per profiel bewaard,
dus daar loopt ook de synthese-geschiedenis tegenaan.

## Exporteren en importeren

Tabblad **Gegevens** in het dashboard. Export levert één JSON-bestand met de
geselecteerde profielen en alles wat eronder hangt: onderwerp, gebruikersvraag,
synthese-instructie, bronnen, beoordeelde publicaties, scangeschiedenis, eerdere
signaleringen en de administratie van wat al eens is opgehaald en verwerkt.

JSON en geen XML omdat de data al als JavaScript-objecten in IndexedDB staat —
XML zou een schema en een escaping-regime toevoegen zonder dat er iets
tegenover staat.

Bij import zie je eerst wat er in het bestand zit. Profielen die al bestaan
krijgen een keuze: **toevoegen als kopie** (standaard, niets gaat verloren) of
**vervangen** (wist het bestaande profiel inclusief geschiedenis, met
bevestiging). Bij een kopie krijgen alle id's nieuwe waarden, zodat de kopie niet
de scans van het origineel overschrijft.

## Wat al eerder is opgehaald

Per profiel wordt bijgehouden welke publicaties eerder langskwamen en welke
daarvan in een signalering zijn verwerkt. Publicaties worden herkend op een
genormaliseerde URL (tracking-parameters als `utm_*` worden genegeerd), met
bron + titel als terugval voor feeds zonder link.

Dat is op drie plekken zichtbaar:

- **Profielformulier** — per bron: wanneer voor het laatst opgehaald, hoeveel
  publicaties dat opleverde, hoeveel daarvan nieuw waren, en hoeveel er ooit in
  een signalering zijn verwerkt.
- **Scanresultaat** — per bron een regel met aantallen en een knop om de bron te
  openen; per publicatie een label `nieuw`, `eerder gezien` of
  `eerder verwerkt · <datum>`.
- **Per profiel** de schakelaar *Alleen nieuwe publicaties beoordelen* (standaard
  aan). Uit zetten laat elke scan alles opnieuw beoordelen — nuttig als je de
  vraagstelling hebt gewijzigd, maar het kost meer tokens.

## Waar de API-key staat

Twee routes, in te stellen bij Instellingen:

| Route | Wanneer | Risico |
| --- | --- | --- |
| **Eigen API-key in deze browser** (standaard) | Iedere gebruiker heeft een eigen key op eigen naam (B-D09) | De key staat onversleuteld in `chrome.storage.local` en gaat mee in backups en profielsynchronisatie. Aanvaardbaar bij een persoonlijke key met uitgavenlimiet |
| **Via een eigen proxy** | Eén key voor meerdere mensen | De key staat server-side; de extensie kent hem niet |

Een gedeelde key hoort nooit in de `direct`-route: wie het pakket of het
browserprofiel heeft, leest hem uit.

## Proxy-contract

De proxy moet één route aanbieden:

```
POST <proxyUrl>/chat/completions
Authorization: Bearer <proxyToken>      (optioneel)
Content-Type: application/json
```

Body en antwoord zijn ongewijzigd OpenAI-compatibel. De proxy hoeft alleen:

1. het proxy-token te controleren;
2. de echte `Authorization`-header met de OpenRouter-key te zetten;
3. door te sturen naar `https://openrouter.ai/api/v1/chat/completions`;
4. het antwoord ongewijzigd terug te geven.

De extensie stuurt zelf al `model` mee, plus — als het model géén preset is —
een `provider`-blok met `{"order":["deepinfra"],"allow_fallbacks":false}`.

Let op: dit is **geen remote code**. Het Edge-beleid verbiedt het laden en
uitvoeren van extern gehost script; JSON van een API ophalen is gewoon data en
is toegestaan. Wel geldt dat een backend tijdens de certificering bereikbaar
moet zijn, en dat het versturen van gegevens naar een eigen server in het
privacybeleid en de datadeclaratie hoort te staan.

## Tests

```bash
node --test test/parsers.test.mjs
```

Dekt de XML-pull-parser, feed-mapping (RSS 2.0 en Atom), datumherkenning,
HTML-stripping, OPML-import en de reparatie van afgekapte LLM-antwoorden — de
onderdelen waar een stille fout tot lege scanresultaten leidt.

## Mapstructuur

```
extension/
├── manifest.json
├── icons/                      icon-16/32/48/128 (+300 voor de store-listing)
├── src/
│   ├── core/                   config, modellen, resultaattype, berichten, logger
│   ├── data/                   IndexedDB + repositories (incl. export/import)
│   ├── network/                XML-parser, feed-fetcher, LLM-client, HTTP
│   ├── background/             service worker, scan-orkestratie, planner, permissies
│   └── ui/                     popup, dashboard, side panel, gedeelde stijl
└── test/
```

Geen buildstap, geen bundler, geen externe scripts: platte ES-modules. Dat is
een eis van het Edge-beleid (geen remote code, geen geobfusceerde code) en het
maakt de code direct reviewbaar door de certificeringstesters.
