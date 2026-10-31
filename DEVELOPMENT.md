# Signaleringen — ontwikkelaarsnotities

Technische beschrijving voor wie aan de extensie werkt. De handleiding voor
gebruikers staat in [README.md](README.md); het privacybeleid in
[PRIVACY.md](PRIVACY.md). Uitgebreide architectuurbeschrijving:
`Design - Architectuur browserextensie.md` in de Obsidian-vault.

## Laden tijdens ontwikkeling

1. Ga naar `edge://extensions`
2. Zet **Ontwikkelaarsmodus** aan
3. **Uitgepakt laden** → kies deze map (`extension/`)

Na een codewijziging: **Opnieuw laden** op de extensiekaart. De service worker
inspecteer je via de link *service worker* op diezelfde kaart.

**Chrome** werkt op dezelfde manier via `chrome://extensions` (Chrome 121 of
nieuwer). Edge en Chrome melden dat ze `browser_specific_settings` niet
kennen; die sleutel is voor Firefox en kan geen kwaad.

**Firefox** (128 of nieuwer): `about:debugging#/runtime/this-firefox` →
**Tijdelijke add-on laden** → kies `manifest.json`. Een tijdelijke add-on
verdwijnt bij het afsluiten van Firefox. Verschillen met Edge:

- Het zijpaneel heet in Firefox de *sidebar* (nu verborgen, zie *Zijpaneel*).
- Firefox staat `alarms` niet toe als optionele permissie. Automatisch
  synthetiseren is daar daarom niet beschikbaar; Instellingen meldt dat.
- Host-toestemming vraag je net als in Edge per bron; Firefox toont daarvoor
  een eigen venster.

## Eerste configuratie (technisch)

1. Open het dashboard (pictogram → **Dashboard**, of via `edge://extensions` → Opties)
2. **Instellingen** → route op *Eigen API-key in deze browser*, plak je
   OpenRouter-key en sla op. Voor `openrouter.ai` is geen host-toestemming
   nodig: de API staat verzoeken vanuit de browser toe (CORS).
3. **Model** en **Routing** staan vooringevuld: `deepseek/deepseek-v4-flash-0731`
   bij `deepinfra`. De uitwijk is sinds 0.24.0 optioneel en staat uit; de
   vroegere waarden (`deepseek/deepseek-v4.1-flash` bij `decart/fp4`, samen
   gelijk aan de preset `@preset/signaleringen`) staan als voorbeeld in de velden. Routing vul je
   in als `provider` of `provider/kwantisatie`, in volgorde van voorkeur,
   komma-gescheiden — dezelfde tags als op de endpoints-pagina van een model
   bij OpenRouter. Een preset als model kan ook; dan geldt het routingveld niet.
4. **Verbinding testen** en **Uitwijkroute testen** — horen `ok` terug te
   geven, met de provider die antwoordde. Testen slaat eerst op.
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

Het key-veld bij Instellingen staat dan vooringevuld, zolang er nog geen key
is opgeslagen — een opgeslagen waarde gaat altijd voor. Het bestand staat in
`.gitignore` en komt dus niet in de repo en niet in een uitrolpakket.

Het bestand is een gemak voor ontwikkeling, geen opslagplek: de key staat er
leesbaar in. Gebruik je de wachtwoordkluis (zie *Waar de API-key staat*), haal de key
dan uit dit bestand — de extensie waarschuwt daar ook voor.

## Uitrol naar collega's

Iedere collega krijgt een **eigen key op zijn of haar naam** uit de
OpenRouter-workspace `signaleringen`, met een eigen uitgavenlimiet (B-42). In
de extensie is het key-veld leeg; de collega plakt de eigen key erin (stap 2
van *Eerste configuratie*). Zie besluit B-D09 in de vault.

Maak het pakket altijd met het inpakscript, nooit door de map te kopiëren of
te zippen (B-73):

```bash
npm run package                 # dist/signaleringen-<versie>-chromium.zip en -firefox.zip
npm run package -- chromium     # alleen Edge/Chrome
```

Het script (`scripts/package.mjs`, Node 22.2+, geen afhankelijkheden):

- neemt alleen **gecommitte** bestanden uit `HEAD`, en daarvan alleen de
  allowlist: `manifest.json`, `src/`, `vendor/pdfjs/` en de iconen 16–128.
  `local-settings.json`, `test/`, `node_modules/`, `.git`, `scripts/`,
  README's en `icon-300.png` (alleen voor de store-listing) gaan nooit mee;
- weigert als er niet-gecommitte wijzigingen in die bestanden zijn;
- schrijft per browser een eigen manifest: Chromium zonder `background.scripts`,
  `sidebar_action` en `browser_specific_settings`; Firefox zonder
  `background.service_worker`, `side_panel`, `minimum_chrome_version` en de
  permissie `sidePanel`;
- controleert of alles waar het manifest naar verwijst in het pakket zit;
- draait `gitleaks dir` op de inhoud en zoekt zelf naar OpenRouter-keys en
  naar de waarden uit jouw `local-settings.json`. Bij een treffer, of als
  `gitleaks` niet is geïnstalleerd, komt er geen pakket.

Hetzelfde commit geeft hetzelfde pakket (vaste volgorde, commitdatum als
bestandsdatum).

## Tests

```bash
npm ci          # eenmalig: alleen fake-indexeddb, voor test/scan.test.mjs
npm test        # = node --test test/*.test.mjs
```

De extensie zelf heeft geen npm-afhankelijkheden en geen buildstap.
`package.json` bestaat alleen voor de tests: `fake-indexeddb` staat exact
vastgezet met een lockfile, en `.npmrc` zet install-scripts uit. `node_modules/`
hoort niet in een uitrolpakket.

Dekt de XML-pull-parser, feed-mapping (RSS 2.0 en Atom), datumherkenning,
HTML-stripping, OPML-import, de reparatie van afgekapte LLM-antwoorden, de
vertaling van open.overheid-zoek-URL's, de wachtwoordkluis, de afbakening van
bronmateriaal in de prompt en de voorfilter met nagebootste Jev-antwoorden
(normaal, fout → terugval, ontbrekende antwoorden) — de onderdelen waar een stille fout tot lege
scanresultaten of een lek leidt. Daarnaast de berichtrouter, het ontdubbelen
binnen een scan, wat er van de instellingen wordt opgeslagen, de grenzen op
antwoorden, de https-eis, de controle van bronnen en de import
(`test/worker.test.mjs` en `test/hardening.test.mjs`), sleutels uit een
feed die op het prototype van een object vallen (`test/js-protocol.test.mjs`),
en de scan als geheel tegen een echte IndexedDB: ontdubbelen, wat als gezien
telt, een mislukte bron of synthese, een signalering alsnog opstellen, en het opruimen van de
gezien-administratie (`test/scan.test.mjs`). Tot slot het inpakscript: allowlist,
manifest per browser, keycontrole en de zip zelf (`test/package.test.mjs`).
En of wachtwoordkluizen uit oudere versies een update overleven (`test/upgrade.test.mjs`,
zie *Updates en opgeslagen gegevens*).

## Updates en opgeslagen gegevens

Bij een update vanuit de store blijft `chrome.storage.local` (instellingen,
wachtwoordkluis) en IndexedDB (profielen, scans) staan; `chrome.storage.session` wordt
gewist. Een gebruiker met een wachtwoordkluis moet na elke update dus opnieuw
ontgrendelen (staat in de README), maar mag zijn key nooit kwijtraken.

**Procescontrole:** `test/upgrade.test.mjs` zet wachtwoordkluizen uit oudere versies
(`test/fixtures/vault-formats.json`) in een opslag zoals na een update en
controleert dat de huidige code ze vergrendeld vindt, met de wachtwoordzin
opent en de juiste keys teruggeeft; ook de opslagsleutel `vault` ligt vast.
De test hoort bij `npm test` en faalt bij elke wijziging die bestaande wachtwoordkluizen
onleesbaar maakt (gecontroleerd door de opslagsleutel en het lezen van het
oude formaat tijdelijk te breken).

Regels bij een wijziging aan de wachtwoordkluis (`core/vault.js`, `data/vault-repository.js`)
of de opslagsleutels:

1. **Fixtures nooit wijzigen of opnieuw genereren.** Faalt de test, dan zou
   een update gebruikers hun key kosten: schrijf een migratie of laat de oude
   code-route staan.
2. **Nieuw formaat = nieuw item** in de fixture, aangemaakt met de nieuwe
   code vóór de release, naast de bestaande items. Verhoog `VAULT_VERSION`
   in `core/vault.js` en laat `unlockVault` de oude versies blijven lezen
   (de iteraties en het algoritme staan per wachtwoordkluis in de blob).
3. **Hogere PBKDF2-iteraties** gelden alleen voor nieuwe wachtwoordkluizen; een
   bestaande wachtwoordkluis houdt zijn eigen `iterations`. Wil je bestaande wachtwoordkluizen
   omzetten, doe dat na een geslaagd ontgrendelen (dan is de wachtwoordzin
   bekend) en test ook dat pad.
4. **Opslagsleutels** (`vault`, `settings`) niet hernoemen zonder migratie.

## Permissiemodel

De extensie declareert geen enkele host-permissie vooraf — alleen
`optional_host_permissions`. Toestemming wordt per host gevraagd op het moment
dat je een bron of proxy toevoegt, altijd vanuit een klik. Dat is nodig voor de
Edge Add-ons-certificering (permissies "voor later" aanvragen is verboden) en
beperkt de blootstelling tot precies de hosts die je zelf hebt ingevoerd.
Bij een open.overheid-bron vraagt de extensie in hetzelfde verzoek ook
`zoek.officielebekendmakingen.nl`, voor de volledige tekst van Kamerstukken
(zie *Bronnen*); dat is geen voorwaarde om te kunnen scannen.

Vaste permissies en waarom ze nodig zijn:

| Permissie | Waarvoor |
| --- | --- |
| `storage` | Profielen, instellingen en scangeschiedenis |
| `contextMenus` | "Deze pagina toevoegen als bron" |

`sidePanel` staat er sinds 0.24.0 niet meer in: het zijpaneel is verborgen
(zie *Zijpaneel*). Elke Base-URL buiten openrouter.ai (Claude API, OpenAI,
een ander endpoint, een lokaal model) krijgt bij *Opslaan* een
toestemmingsvraag voor die host.

Optioneel, pas gevraagd bij het aanzetten van de betreffende functie:

| Permissie | Waarvoor |
| --- | --- |
| `alarms` | Automatisch synthetiseren op een interval |

## Waar de API-key staat

Twee routes, in te stellen bij Instellingen:

| Route | Wanneer | Risico |
| --- | --- | --- |
| **Eigen API-key in deze browser** (standaard) | Iedere gebruiker heeft een eigen key op eigen naam (B-D09) | Zonder wachtwoordkluis staat de key onversleuteld in `chrome.storage.local` en gaat mee in backups en profielsynchronisatie. Aanvaardbaar bij een persoonlijke key met uitgavenlimiet |
| **Via een eigen proxy** | Eén key voor meerdere mensen | De key staat server-side; de extensie kent hem niet |

Een gedeelde key hoort nooit in de `direct`-route: wie het pakket of het
browserprofiel heeft, leest hem uit.

**Wachtwoordkluis (optioneel).** Bij Instellingen kun je de key versleutelen met een
wachtwoordzin: PBKDF2-SHA256 (600.000 iteraties) naar AES-GCM-256. De
versleutelde key staat in `chrome.storage.local`, de afgeleide sleutel alleen
in `chrome.storage.session` — in het geheugen, weg bij een herstart van de
browser. Daarna vraagt de extensie de wachtwoordzin opnieuw; scans en de
planner wachten tot dan. De wachtwoordkluis beschermt de key in het profielbestand,
backups en synchronisatie; **niet** tegen code die draait terwijl hij
ontgrendeld is. Een vergeten wachtwoordzin is niet te herstellen: hef de wachtwoordkluis
dan op door de extensiedata te wissen en vul de key opnieuw in.

Zit de wachtwoordkluis op slot terwijl de key nodig is, dan staat er een 🔒
op het extensiepictogram (`isKeyLocked` in `data/vault-repository.js`,
`updateBadge` in `background/badge.js`; de badge wordt bijgewerkt na elke
slotwijziging en bij het starten van de browser).

**Naamgeving.** Voor gebruikers heet dit *wachtwoordkluis*. In de code blijft
het `vault` (`core/vault.js`, `data/vault-repository.js`, `Msg.VAULT_*`,
`VaultLockedError`), net als de opslagsleutels `vault` en `vaultSessionKey` en
de fixtures in `test/fixtures/`: die laatste zijn bevroren voor de
updatetest en worden niet hernoemd zonder migratie.

**Uitgavenlimiet en verbruik** per key regel je in de OpenRouter-workspace
`signaleringen` (openrouter.ai): daar zet je per key een limiet en zie je het
verbruik per collega.

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
een `provider`-blok uit de instellingen onder **Routing**, standaard
`{"order":["deepinfra"],"allow_fallbacks":false}`. De tags gaan ongewijzigd naar
`order`; OpenRouter accepteert daar ook `provider/kwantisatie` (`deepinfra/fp8`).

De voorfilter (zie hieronder) gebruikt een ander endpoint
(`/api/alpha/decisions`) en gaat daarom niet via de proxy; in de proxy-route
werkt hij alleen met een eigen key in het voorfilterveld.

**Opnieuw proberen en uitwijken.** Bij een 429, 5xx of time-out probeert de
extensie elke aanroep tot 3 keer opnieuw (2 s, verdubbelend, maximaal 30 s;
`Retry-After` gaat voor). Blijft de primaire route weigeren, dan wijkt ze uit
naar de uitwijkroute bij **Instellingen → Routing**, ook weer tot 3 keer.
Sinds 0.24.0 staat de uitwijk standaard uit en zijn model en routing leeg
(`fallback*` in `DefaultSettings`); het voorbeeld in de velden is
`deepseek/deepseek-v4.1-flash` bij `decart/fp4`. De uitwijk werkt alleen bij
OpenRouter (`routesFor`).

Let op: dit is **geen remote code**. Het Edge-beleid verbiedt het laden en
uitvoeren van extern gehost script; JSON van een API ophalen is gewoon data en
is toegestaan. Wel geldt dat een backend tijdens de certificering bereikbaar
moet zijn, en dat het versturen van gegevens naar een eigen server in het
privacybeleid en de datadeclaratie hoort te staan.

## Bronnen

Drie soorten, te kiezen per bron bij *Bewerken*:

| Type | Wat de extensie ophaalt |
| --- | --- |
| **RSS/Atom** | De items uit de feed, binnen de terugkijktijd van het profiel |
| **Webpagina** | De leesbare tekst van de pagina, als één publicatie |
| **open.overheid.nl** | Een zoekopdracht op open.overheid.nl: Kamerbrieven, rapporten, Woo-stukken |

**Feedadres vinden.** Gebruik het adres van de feed zelf, niet de homepage.
Vaak werkt `<site>/rss`, `<site>/rss.xml` of `<site>/feed/`, of de nieuwspagina
in plaats van de homepage. Geef je toch een webpagina op als RSS-bron, dan
meldt de extensie dat, met het feedadres erbij als de pagina er een noemt.
Sommige feeds (Volkskrant, Trouw, grotendeels CBS) geven alleen titels; het
model beoordeelt dan op de titel. Geteste feeds en hun adressen: *Referentie -
RSS-feeds in de praktijk* in de vault.

Een zoekopdracht op open.overheid.nl stel je samen op de site zelf: zoeken, dan
*Uitgebreid zoeken* openklappen en ministeries, documentsoorten en eventueel
een zoekterm kiezen. Plak daarna de URL uit de adresbalk als bron; de extensie
herkent hem en zet het type zelf goed. Kies je op de site een periode, dan
haalt de extensie die hele periode op, tot maximaal 200 publicaties per scan:
"Afgelopen week/maand/jaar" schuift mee met de datum, een zelfgekozen periode
geldt letterlijk. Zonder periode geldt de terugkijktijd van het profiel. Sortering en paginering uit de URL worden genegeerd.

**Publicaties zonder fragment.** De zoek-API geeft bij een deel van de
treffers geen tekstfragment rond de zoekterm, alleen titel en een
standaardomschrijving ("Brief regering"). Komt zo'n publicatie van
officielebekendmakingen.nl (Kamerstukken, Kamervragen, moties), dan haalt de
scan daar de volledige tekst op en zet de passage(s) rond de zoekterm achter
de beschrijving, vóór de voorfilter en de relevantiestap. Alleen voor wat
beoordeeld wordt, 4 tegelijk, tot 100 per scan. Kamerstukken (`kst-`) en
Kamervragen met antwoord (`ah-`) staan daar met de hele documenttekst.
Bijlagen (`blg-`) bestaan alleen als PDF; die leest de extensie met het
meegeleverde pdf.js (`vendor/pdfjs`, Apache-2.0, zie de README daar), 2
tegelijk en tot 25 per scan. De server ondersteunt geen Range-verzoeken, dus
een PDF komt helemaal binnen; daarom blijven bestanden boven 25 MB of 500
pagina's liggen (de zoek-API geeft grootte en aantal pagina's vooraf). Geen
treffer in de tekst: de beschrijving blijft zoals ze was. Zonder toestemming voor de host gaat de
scan gewoon door en biedt het scanresultaat een knop *Toegang geven* aan.

- **Tokens:** het fragment is maximaal 300 tekens, even groot als een gewoon
  fragment van de zoek-API. Gemeten op 151 publicaties: +1.400 prompttokens
  per scan (+6,5%), $0,0026 → $0,0028. Een fragment van 700 tekens kostte
  +16% en gaf hetzelfde resultaat.
- **Opslag:** het document wordt met `cache: 'no-store'` opgehaald (de server
  stuurt zelf ook `no-store`), alleen in het geheugen doorzocht en daarna
  weggegooid. Alleen het fragment wordt bewaard, als deel van de beschrijving.
- **Effect:** op het additionaliteitsprofiel 20 van 20 Kamerstukken en
  Kamervragen aangevuld in 4 s; 17 daarvan bleken relevant, waar het model ze
  zonder tekst op 5–30 had gezet.

Tips voor een profiel over een beleidsdossier:

- Filter op het ministerie en laat de zoekterm leeg of breed; de
  relevantiestap past de gebruikersvraag toe. De site kent geen zoeken op een
  exacte woordgroep.
- Voeg een **tweede bron** toe met alleen de zoekterm, of met de organisatie
  *Tweede Kamer*. Kamerstukken, moties en geagendeerde stukken staan vaak
  niet onder het ministerie maar onder de Kamer of zonder organisatie.

Technische achtergrond: *Referentie - open.overheid.nl zoek-API* in de vault.

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
klok mee. Meldingen vraagt de extensie niet: een nieuwe signalering van de
automaat zet een teller op het extensiepictogram en een label *nieuw* in de
popup. Beide verdwijnen zodra je de signalering in het dashboard of het side
panel bekijkt.

Een scan kent geen maximum aantal publicaties: je gaat zelf over je
tokenbudget. Staan er bij een handmatige scan meer dan 200 publicaties klaar om
te beoordelen, dan vraagt de extensie eerst of je door wilt. Stoppen kost niets
en verliest niets: die publicaties komen bij de volgende scan terug. De
automatische planner vraagt dit niet. Een RSS-bron levert hooguit de nieuwste
200 items per scan, zoals een open.overheid-bron; dat begrenst de kosten als een
feed er plotseling duizenden aanbiedt.

Een signalering bundelt hooguit 25 artikelen, de hoogst scorende (instelbaar bij
Instellingen → Signalering). De overige blijven als relevant in het
scanresultaat staan.

## Wat al eerder is opgehaald

Per profiel wordt bijgehouden welke publicaties eerder langskwamen en welke
daarvan in een signalering zijn verwerkt. Publicaties worden herkend op een
genormaliseerde URL (tracking-parameters als `utm_*` worden genegeerd), met
bron + titel als terugval voor feeds zonder link. Die administratie wordt
opgeruimd 180 dagen nadat een publicatie voor het laatst in een bron stond; wat
nog in een bron staat, blijft bewaard.

Dat is op drie plekken zichtbaar:

- **Profielformulier** — per bron: wanneer voor het laatst opgehaald, hoeveel
  publicaties dat opleverde, hoeveel daarvan nieuw waren, en hoeveel er ooit in
  een signalering zijn verwerkt.
- **Scanresultaat** — per bron een regel met aantallen en een knop om de bron te
  openen; per publicatie een label `nieuw`, `eerder gezien` of
  `eerder verwerkt · <datum>`. Heeft een scan relevante publicaties maar geen
  signalering (de browser sloot tijdens het opstellen, of de synthese mislukte),
  dan staat er een knop *Signalering opstellen*. Die publicaties tellen al als
  gezien en komen bij een volgende scan niet terug; de knop kost één
  modelaanroep en beoordeelt niets opnieuw.
- **Per profiel** de schakelaar *Alleen nieuwe publicaties beoordelen* (standaard
  aan). Uit zetten laat elke scan alles opnieuw beoordelen — nuttig als je de
  vraagstelling hebt gewijzigd, maar het kost meer tokens.

## Relevant, mogelijk relevant, weggefilterd

Het model geeft elke publicatie een score van 0 tot 100 voor de relevantie
voor de gebruikersvraag. Vanaf 65 is een publicatie **relevant** en gaat ze
naar de signalering; 40–64 is **mogelijk relevant**: zichtbaar in het
scanresultaat met de score erbij, maar niet in de signalering. Daaronder is ze
weggefilterd. Twijfelgevallen vallen zo niet meer willekeurig in of uit de
signalering, maar staan apart om zelf na te kijken. Drempels in
`AppConfig.RELEVANCE_THRESHOLD` en `POSSIBLE_RELEVANCE_THRESHOLD`.

## Voorfilter met Jev (optioneel)

Bij **Instellingen → Voorfilter** staat één vinkje, standaard uit. Aan legt de
extensie de te beoordelen publicaties eerst voor aan een beslismodel —
bijvoorbeeld Jev van TypeSafe via OpenRouters decisions-endpoint. Dat geeft per
publicatie een kans dat ze over de gebruikersvraag gaat; wat onder 0,10 valt
(`AppConfig.JEV_PREFILTER_THRESHOLD`, 10 op 100) gaat niet meer naar het
taalmodel.

Met het vinkje aan verschijnen vier velden. Sinds 0.24.0 is niets
vooringevuld; de velden tonen een voorbeeld (placeholder). Zonder endpoint,
model en key slaat de extensie de voorfilter over, en *Opslaan* meldt welke
velden ontbreken (`validateRouting`).

| Veld | Voorbeeld | Toelichting |
| --- | --- | --- |
| Endpoint | `https://openrouter.ai/api/alpha/decisions` | Een decisions-endpoint; een chatmodel werkt hier niet |
| API-key | leeg | Leeg: de key van het taalmodel, alleen bij dezelfde host. Eigen key: aparte uitgavenlimiet, en nodig via een proxy of een andere aanbieder. Gaat mee in de wachtwoordkluis |
| Model | `~typesafe/jev-latest` | Een vaste versie (`typesafe/jev-1.13-20260917`) is stabieler: de drempel is op 1.13 afgesteld |
| Aanbieder (provider-routing) | `typesafe` | Zelfde vorm als bij het taalmodel |

*Voorfilter testen* slaat op en stelt één testvraag; het toont model en
provider die antwoordden.

- **Waarom:** de relevantiestap is de trage stap (± 0,8 s per publicatie).
  Jev zeeft 150 publicaties in ± 1–2 s. Bij een eerste scan of een profiel met
  veel bronnen scheelt dat ongeveer de helft van de filtertijd; bij
  vervolgscans met weinig nieuwe publicaties weinig.
- **Veilig ruim:** de drempel ligt laag, zodat de voorfilter liever te veel
  doorlaat. Wat hij wegfiltert, staat bij *Weggefilterd* met het label
  "voorfilter" en de score, en wordt als gezien vastgelegd.
- **Nooit een mislukte scan:** bij elke fout, time-out of ontbrekend antwoord
  vervalt de voorfilter voor die scan en gaat alles naar het taalmodel. Het
  scanresultaat meldt dat.
- **Proxy-route:** daar staat geen key in de browser; de voorfilter werkt dan
  alleen met een eigen key in het voorfilterveld.
- **Extra verwerker:** met het vinkje aan gaan titels, tekstfragmenten en de
  gebruikersvraag ook naar de aanbieder van het beslismodel (bij Jev:
  TypeSafe).

Achtergrond en metingen: B-D10 in de vault (*Design - Beslissingen*).

## Bronmateriaal is data, geen instructie

Feedinhoud komt van derden. Om te voorkomen dat een pagina met "negeer je
instructies" de beoordeling of de signalering stuurt (prompt-injectie):

- elke publicatie staat in de prompt tussen tags met een per aanroep
  willekeurige markering, en de systeemprompt verklaart alles daartussen tot
  data; tags uit de bron zelf worden weggehaald;
- titel en tekst per publicatie zijn begrensd (`PROMPT_*_MAX_CHARS`);
- alleen een echte `true` telt als relevant;
- de signalering wordt gecontroleerd op bronverwijzingen: geen verwijzingen of
  een nummer dat niet bestaat geeft een zichtbare waarschuwing.

Dat maakt injectie moeilijker, niet onmogelijk. Lees een signalering met een
waarschuwing daarom na aan de hand van de publicaties.

## Lokaal model (optioneel)

In plaats van OpenRouter kan de extensie een lokaal model gebruiken via een
OpenAI-compatibele server, zoals Ollama of LM Studio. Bij Instellingen:

- **Base-URL**: Ollama `http://localhost:11434/v1`, LM Studio
  `http://localhost:1234/v1`. Een adres op het eigen netwerk (bijv.
  `http://192.168.1.20:11434/v1` of `http://server.local:11434/v1`) of in
  Tailscale (`http://100.64.0.0/10`, bijv. `http://100.101.1.2:11434/v1`)
  werkt ook. Voor elk ander adres, ook de proxy, eist de extensie **https**:
  anders zou je key onversleuteld over het netwerk gaan.
- **Model**: de lokale modelnaam, bijv. `qwen2.5:3b`.
- **API-key**: leeg laten; een lokaal adres heeft er geen nodig.
- Bij het opslaan vraagt de extensie toestemming voor het lokale adres.

Herkent de extensie een lokaal adres (localhost, een privé-adres, 100.x.x.x of
een `.local`-naam), dan stuurt ze geen OpenRouter-velden mee: geen
provider-routing, geen redeneerinstelling en geen uitwijkroute. De voorfilter
(Jev) is een OpenRouter-dienst; zet die uit. De beoordeling gaat in groepen van
10 in plaats van 40.

Weigert de server de verbinding (403), sta dan verzoeken van de extensie toe:
bij Ollama met de omgevingsvariabele `OLLAMA_ORIGINS=chrome-extension://*`, bij
LM Studio met de CORS-schakelaar in de serverinstellingen.

Model, hardware, contextvenster en KV-cache regel je zelf op de server; de
extensie stuurt alleen verzoeken. Ter oriëntatie: een groep van 10 publicaties
kost ± 2.200 tokens prompt plus ± 300 antwoord, dus de standaardcontext van
Ollama (4.096) volstaat voor de beoordeling. Een synthese met veel artikelen
vraagt meer; verruim dan de context of zet het maximum aantal artikelen in een
signalering lager.

Een korte proef (2026-10-09, `qwen2.5:3b`, CPU zonder GPU, 20 nieuwsberichten)
werkte, maar duurde ruim 4 minuten en gaf matige kwaliteit: geregeld
onleesbare JSON (de extensie probeert het dan opnieuw), te lage scores voor
relevante berichten en een signalering zonder bronverwijzingen. Kies voor
serieus gebruik een groter model op een machine met GPU.

## Leesmodus zonder taalmodel (B-82)

Is er geen taalmodel ingesteld (`isConfigured` onwaar: geen key, geen lokaal
model, geen proxy-adres), dan stopt een scan niet meer maar draait hij in
leesmodus (`loadProfileAndSettings(…, { allowReaderMode: true })` →
`finishReaderScan` in `background/scan-runner.js`):

- ophalen, ontdubbelen en `refreshSeen` zoals altijd; geen vraag bij een
  grote scan, geen volledige tekst, geen voorfilter, beoordeling of synthese;
- alle opgehaalde publicaties worden opgeslagen met `relevance: 'unjudged'`
  (`UNJUDGED` in `data/scan-repository.js`), `score: null` en als
  `shortDescription` het begin van de omschrijving
  (`READER_DESCRIPTION_MAX_CHARS`); de scan krijgt `readerMode: true`;
- `getScanResults` geeft ze als `unjudged`, nieuw eerst en dan op datum;
- nieuwe publicaties worden vastgelegd als gezien mét `unjudged: true` op het
  seen-record. Records zonder dat veld (alles van vóór B-82) gelden als
  beoordeeld.

**Daarna een taalmodel:** met *Alleen nieuwe publicaties beoordelen* gaat
ook naar het model wat nog in een bron staat en `unjudged` is; na het
beoordelen haalt `markJudged` de markering weg. Zo verdwijnt niets
ongezien, en wordt niets twee keer beoordeeld. Wat al uit de bron verdwenen
is, wordt niet meer beoordeeld.

*Signalering opstellen* (`synthesizeScan`) blijft een taalmodel eisen. De
planner scant zonder taalmodel ook, in leesmodus; een vergrendelde wachtwoordkluis
houdt hem alleen tegen als er wél een taalmodel is. De popup toont zonder
taalmodel een melding in plaats van een blokkade. Tests: *leesmodus* en
*planner: zonder taalmodel* in `test/scan.test.mjs`.

## Aanbieders en endpoints

Welke velden een verzoek krijgt, volgt uit de Base-URL (`core/api-kind.js`,
B-79); de keuze *Aanbieder* in Instellingen vult alleen de Base-URL in.

| Soort | Herkend aan | Verzoek |
| --- | --- | --- |
| `openrouter` | `openrouter.ai`, of de proxy-route | `chat/completions` met `provider`, `reasoning`, `temperature`, `max_tokens`; presets en uitwijk |
| `anthropic` | `api.anthropic.com` | Messages API (`/messages`), headers `x-api-key`, `anthropic-version` (`AppConfig.ANTHROPIC_API_VERSION`) en `anthropic-dangerous-direct-browser-access`; systeemprompt los; geen `temperature` (geweigerd sinds API-versie 2026-10-21); `output_config.effort` (`ANTHROPIC_EFFORT`); antwoord uit de `text`-blokken |
| `openai` | `api.openai.com` | `chat/completions` met `max_completion_tokens`, zonder `temperature` (redeneermodellen weigeren een andere waarde) |
| `local` | localhost, privé-adres, Tailscale, `.local` | `chat/completions` met `temperature` en `max_tokens`, zonder key; batches van 10 |
| `other` | elke andere https-host | als `local`, met `Authorization: Bearer` |

Bij `anthropic` en `openai` komt er `LLM_THINKING_HEADROOM_TOKENS` bij de
tokenlimiet: denken is daar niet uit te zetten en telt mee. Provider-routing,
presets en de uitwijkroute gelden alleen bij `openrouter`; het
instellingenscherm verbergt ze daarbuiten. Een abonnement (Claude Pro/Max,
ChatGPT Plus) geeft geen API-toegang; de gebruiker heeft een API-key nodig.
Getest met nagebootste antwoorden (`test/providers.test.mjs`), nog niet met
een echte key bij Anthropic of OpenAI.

## Zijpaneel (verborgen)

Sinds 0.24.0 verborgen, niet verwijderd. `AppConfig.SIDE_PANEL_ENABLED` staat
op `false` (de popup toont dan geen knop *Paneel*), en `side_panel`,
`sidebar_action` en de permissie `sidePanel` staan niet in `manifest.json`,
zodat Edge het zijpaneel ook zelf niet aanbiedt. De code in `src/ui/sidepanel/`
blijft en gaat mee in het pakket. Weer aanzetten:

1. `SIDE_PANEL_ENABLED: true` in `src/core/config.js`;
2. in `manifest.json` terugzetten:
   `"side_panel": { "default_path": "src/ui/sidepanel/sidepanel.html" }`,
   `"sidebar_action": { "default_panel": "src/ui/sidepanel/sidepanel.html", "default_title": "Signaleringen", "default_icon": "icons/icon-32.png", "open_at_install": false }`
   en `"sidePanel"` bij `permissions`;
3. de test *zijpaneel verborgen* in `test/package.test.mjs` omdraaien.

Het inpakscript haalt `side_panel` en `sidebar_action` per browser al weg waar
ze niet horen.

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
bevestiging). Scans en publicaties krijgen bij elke import nieuwe id's; bij een
kopie ook het profiel en de bronnen. Zo kan een bestand nooit de scans van een
ander profiel overschrijven. Bronnen met een ander adres dan http(s) worden
geweigerd.

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
├── scripts/package.mjs         inpakscript voor de store (niet in het pakket)
└── test/
```

Geen buildstap, geen bundler, geen externe scripts: platte ES-modules. Dat is
een eis van het Edge-beleid (geen remote code, geen geobfusceerde code) en het
maakt de code direct reviewbaar door de certificeringstesters.
