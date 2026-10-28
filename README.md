# Signaleringen

Signaleringen is een extensie voor Microsoft Edge. Je kiest een onderwerp en
de bronnen die je wilt volgen: nieuwsfeeds, webpagina's en zoekopdrachten op
open.overheid.nl. De extensie haalt de nieuwe publicaties op, laat een
taalmodel (AI) bepalen welke over jouw onderwerp gaan, en maakt daar één
korte samenvatting van: de **signalering**. Zonder taalmodel werkt ze als
gewone feedlezer (zie [Zonder taalmodel](#zonder-taalmodel)).

**Inhoud**

- [Wat heb je nodig?](#wat-heb-je-nodig)
- [Aan de slag in zes stappen](#aan-de-slag-in-zes-stappen)
- [Hoe het werkt](#hoe-het-werkt)
- [Zonder taalmodel](#zonder-taalmodel)
- [Overzicht van de functies](#overzicht-van-de-functies)
- [Profielen en bronnen](#profielen-en-bronnen)
- [Instellingen](#instellingen)
- [Gegevens bewaren en overzetten](#gegevens-bewaren-en-overzetten)
- [Kosten en privacy](#kosten-en-privacy)
- [Problemen oplossen](#problemen-oplossen)
- [Contact](#contact)

## Wat heb je nodig?

- **Microsoft Edge.** Installeer Signaleringen via de Edge Add-ons-store.
- **Een API-key**, als je wilt dat de extensie publicaties beoordeelt en
  samenvat. Dat is een soort wachtwoord waarmee de extensie een taalmodel mag
  gebruiken. Heb je een key van je organisatie gekregen, gebruik die. Anders
  maak je er zelf een aan bij:
  - **OpenRouter** ([openrouter.ai](https://openrouter.ai)): één key voor
    modellen van veel aanbieders. Dit is de standaard.
  - **Anthropic** (Claude): [platform.claude.com](https://platform.claude.com).
  - **OpenAI** (ChatGPT): [platform.openai.com](https://platform.openai.com).
  - een **ander adres** dat werkt zoals de API van OpenAI, of een **eigen
    model** op je computer (zie [Instellingen](#instellingen)).

  Een **abonnement** zoals Claude Pro/Max of ChatGPT Plus geeft **geen**
  API-key: API-gebruik betaal je apart, per gebruik. Zet bij je aanbieder
  meteen een **uitgavenlimiet** op je key.
- **Een wachtwoordzin** die je zelf bedenkt en onthoudt. Daarmee versleutel je
  de key.

## Aan de slag in zes stappen

**1. Installeer de extensie en zet hem vast.**
Klik in Edge op het puzzelstukje rechtsboven en zet *Signaleringen* vast aan
de werkbalk. Klik op het pictogram (de **popup**) en daarin op **Dashboard**.

**2. Kies je aanbieder en plak je API-key.**
Ga naar **Instellingen**. Laat de route op *Eigen API-key in deze browser*
staan, kies bij **Aanbieder** waar je key vandaan komt en plak je key bij
**API-key**. Gebruik je niet OpenRouter, vul dan bij **Model** de modelnaam
in, bijvoorbeeld `claude-haiku-5-5` bij Anthropic. Klik op **Opslaan**. Bij
een andere aanbieder dan OpenRouter vraagt Edge één keer toestemming; klik op
*Toestaan*.

**3. Versleutel je key met een wachtwoordzin. Sla deze stap niet over.**
Zonder wachtwoordzin staat je key leesbaar in je browser, en gaat hij leesbaar
mee als je browser synchroniseert of een back-up maakt. Wie bij je
browserprofiel kan, kan dan op jouw kosten het taalmodel gebruiken.

1. Zoek bij Instellingen het blok **Versleuteling van de key**.
2. Typ twee keer dezelfde wachtwoordzin, minstens 8 tekens. Een zin van een
   paar woorden is sterker en makkelijker te onthouden dan een kort
   wachtwoord.
3. Klik op **Key versleutelen**.

Goed om te weten:

- **Na een herstart van de browser of een update van de extensie** is de key
  vergrendeld; je key en profielen blijven bewaard. Klik in de popup op
  **Ontgrendelen** en typ je wachtwoordzin. Tot dan kan de extensie niet
  scannen, ook niet automatisch. Met **Nu vergrendelen** vergrendel je hem
  zelf, bijvoorbeeld als je even weggaat.
- **Key wijzigen?** Klik op **Vault opheffen**, plak de nieuwe key, klik op
  **Opslaan** en versleutel opnieuw.
- **Wachtwoordzin vergeten?** Die is niet te herstellen, ook niet door de
  maker. Exporteer je profielen (zie
  [Gegevens](#gegevens-bewaren-en-overzetten)), verwijder de extensie,
  installeer en importeer opnieuw en plak je key opnieuw.
- De wachtwoordzin beschermt je key in je profiel, back-ups en
  synchronisatie, niet tegen schadelijke software die meekijkt terwijl hij
  ontgrendeld is. Deel je key met niemand.

**4. Test de verbinding.**
Klik onderaan Instellingen op **Verbinding testen**. Je ziet *Verbinding
werkt*, of een fout (zie [Problemen oplossen](#problemen-oplossen)).

**5. Maak je eerste profiel.**
Ga naar **Profielen** → **Nieuw profiel**. Vul een **Profielnaam** in en bij
**Waar let je op?** in een of twee zinnen wat je wilt weten, bijvoorbeeld:
*Wat verandert er in het stikstofbeleid voor de landbouw en de bouw?* Begin
liever breed: een te smalle vraag levert niets op. Voeg bij **Bronnen** een of
meer bronnen toe (zie [Profielen en bronnen](#profielen-en-bronnen)), klik bij
elke bron op **Testen** en geef Edge toestemming om die website te lezen.
Klik op **Opslaan**.

**6. Doe je eerste scan.**
Klik bij je profiel op **Scan nu**. Dat duurt meestal een halve tot een paar
minuten. Klik daarna op **Lees signalering**.

## Hoe het werkt

Een scan gaat in drie stappen:

1. **Ophalen** uit je bronnen, van de afgelopen dagen (standaard 7).
2. **Beoordelen.** Het taalmodel geeft elke publicatie een score van 0 tot
   100 voor je vraag. Vanaf 65 is ze **relevant** en gaat ze naar de
   signalering; 40 tot 64 is **mogelijk relevant** (zichtbaar met de score,
   niet in de signalering); daaronder **weggefilterd**.
3. **Samenvatten.** Het taalmodel schrijft over de relevante publicaties één
   signalering. Een nummer als [1] verwijst naar de publicatie waar een
   bewering vandaan komt.

De extensie onthoudt wat ze al heeft opgehaald en beoordeelt standaard alleen
wat nieuw is. Een taalmodel kan fouten maken: lees bij twijfel de publicatie
zelf, en extra kritisch als er een waarschuwing met ⚠ boven de signalering
staat.

**Scannen.** Klik op **Scan** in de popup of **Scan nu** in het dashboard. Je
kunt de popup sluiten; de scan loopt door. Staan er meer dan 200 publicaties
klaar, dan vraagt de extensie eerst of je door wilt; stoppen kost niets, ze
komen de volgende keer terug.

**Automatisch scannen.** Zet bij **Instellingen → Automatisch
synthetiseren** het vinkje aan, en in elk profiel **Automatisch
synthetiseren** met hoe vaak (elk uur tot elke week). Een nieuwe automatische
signalering zie je aan een getal op het pictogram en het label *nieuw* in de
popup. Dit werkt alleen als Edge openstaat en je key ontgrendeld is.

**Lezen.** In de popup zie je per profiel een voorproefje met **Lees
signalering**; in het dashboard ook **Alle signaleringen** (de laatste vijf
scans per profiel). Het scanresultaat toont alle publicaties met score en
label: **nieuw**, **eerder gezien** of **eerder verwerkt** (al in een eerdere
signalering). Met **☆ Bewaren** zet je er een bij je **Bladwijzers**, met
**Kopiëren** neem je de signalering mee naar bijvoorbeeld een mail.

**Ging er iets mis tijdens het samenvatten**, bijvoorbeeld omdat de browser
sloot? Dan staat in het scanresultaat **Signalering opstellen** of **Opnieuw
proberen**. Er wordt dan niets opnieuw beoordeeld.

## Zonder taalmodel

Zonder taalmodel werkt de extensie als gewone feedlezer. Sla stap 2 tot en
met 4 over; *Waar let je op?* mag leeg blijven.

- Een scan haalt de publicaties op, binnen de terugkijktijd. Er gaat niets
  naar een taalmodel en het kost niets.
- Het scanresultaat is een lijst: eerst wat nieuw is, steeds het nieuwste
  bovenaan, met titel, begin van de tekst en link. Geen score, geen
  signalering.
- De popup meldt *Geen taalmodel ingesteld* en toont per profiel hoeveel er
  nieuw is. Automatisch scannen werkt ook, maar zonder getal op het
  pictogram.

Stel je later een taalmodel in, dan beoordeelt de eerste scan ook wat je al
als feedlezer zag, zolang het nog in de bron staat.

## Overzicht van de functies

| Functie | Waar |
| --- | --- |
| Profielen maken, bewerken, dupliceren en verwijderen | Dashboard → Profielen |
| Bronnen toevoegen, ook een lijst feeds in één keer (OPML) | Profiel → Bewerken → Bronnen |
| Een pagina toevoegen terwijl je hem leest | Rechtermuisknop → *Deze pagina toevoegen als bron…* |
| Scannen, ook automatisch | Popup, dashboard, Instellingen en per profiel |
| Signaleringen lezen en kopiëren | Popup → *Lees signalering*, profiel → *Alle signaleringen* |
| Publicaties bewaren | *☆ Bewaren* in het scanresultaat → Bladwijzers |
| Profielen exporteren en importeren | Dashboard → Gegevens |
| Aanbieder, model en key, versleuteld | Instellingen → Verbinding en Model |
| Licht of donker thema | Instellingen → Weergave |

## Profielen en bronnen

Een profiel is één onderwerp dat je volgt. Per profiel stel je in:

- **Profielnaam** en eventueel een **Categorie**, om profielen te groeperen en
  te filteren.
- **Waar let je op?** De vraag waarmee het taalmodel beoordeelt. Schrijf hem
  zoals je hem aan een collega zou stellen.
- **Instructie voor de signalering (optioneel)**, bijvoorbeeld *Begin met de
  drie belangrijkste ontwikkelingen* of *Schrijf voor een bestuurder*.
- **Terugkijktijd** (1 tot 365 dagen, standaard 7). Heb je een tijd niet
  gescand, zet hem ruimer; wat al eerder langskwam kost niets extra.
- **Alleen nieuwe publicaties beoordelen** (standaard aan). Zet dit uit als je
  je vraag hebt veranderd en alles opnieuw beoordeeld wilt hebben; dat kost
  meer.
- **Automatisch synthetiseren** (zie [Hoe het werkt](#hoe-het-werkt)).

Met **Dupliceren** probeer je een andere vraag op dezelfde bronnen.

Er zijn drie soorten bronnen:

| Soort | Wat de extensie ophaalt |
| --- | --- |
| **RSS/Atom-feed** | De berichten uit een nieuwsfeed |
| **Webpagina** | De tekst van één pagina, als één publicatie |
| **Zoekopdracht op open.overheid.nl** | Kamerbrieven, rapporten, Woo-stukken en andere overheidsdocumenten |

**Een feed vinden.** Je hebt het adres van de feed nodig, niet van de
homepage. Probeer het adres van de site met `/rss`, `/rss.xml` of `/feed/`
erachter. Is het toch een gewone webpagina, dan meldt **Testen** dat, met het
feedadres als de pagina er een noemt. Geeft een feed alleen titels, dan
beoordeelt het taalmodel alleen de titel.

**Open.overheid.nl.** Zoek op [open.overheid.nl](https://open.overheid.nl),
klap *Uitgebreid zoeken* open, kies ministeries, documentsoorten en eventueel
een zoekterm, en plak het adres uit de adresbalk als bron. Een periode die je
daar kiest (zoals *Afgelopen maand*) gaat voor de terugkijktijd. Tips:

- Filter op het ministerie en houd de zoekterm leeg of breed; je vraag doet
  de rest.
- Voeg een tweede bron toe met alleen de zoekterm, of met de organisatie
  *Tweede Kamer*: Kamerstukken en moties staan vaak niet onder het
  ministerie.
- Heeft een Kamerstuk geen tekst in de zoekresultaten, dan zoekt de extensie
  in de volledige tekst op officielebekendmakingen.nl. Weiger je die
  toestemming, dan werkt de scan gewoon en staat er een knop **Toegang
  geven**.

**Toestemming.** De extensie leest alleen websites die jij als bron toevoegt,
en vraagt daarvoor per website toestemming. Per ongeluk geweigerd? Dan meldt
het profiel dat; klik daar op **Toestemming vragen**.

**Met de rechtermuisknop** kies je op een webpagina **Deze pagina toevoegen
als bron…**, of vanuit geselecteerde tekst **Selectie signaleren…** (de
selectie zie je ter herinnering, maar wordt niet bewaard).

## Instellingen

De meeste instellingen staan al goed. Klik na een wijziging op **Opslaan**.

| Onderdeel | Wat je er instelt |
| --- | --- |
| **Verbinding** | Aanbieder, adres (*Base-URL*), API-key en de versleuteling ervan. *Via een eigen proxy* is alleen voor organisaties die dat zelf aanbieden. |
| **Model** | Het taalmodel. Bij OpenRouter vooringesteld; bij een andere aanbieder vul je de modelnaam zelf in. |
| **Routing** | Alleen bij OpenRouter: bij welke onderliggende aanbieder het model draait, en de optionele **uitwijkroute** (standaard uit), een tweede model voor als het eerste tijdelijk onbereikbaar is. Test die met **Uitwijkroute testen**. |
| **Voorfilter** | Optioneel, standaard uit. Een snel beslismodel zeeft eerst weg wat duidelijk niet over je onderwerp gaat; dat versnelt grote scans. Je vult endpoint, model, aanbieder en eventueel een eigen key zelf in; de vakjes tonen een voorbeeld. Weggezeefd staat bij *Weggefilterd*, met het label *voorfilter*. |
| **Signalering** | Hoeveel publicaties hooguit in één signalering gaan (standaard 25, de best passende). |
| **Weergave** | Systeem, licht of donker. |
| **Automatisch synthetiseren** | De hoofdschakelaar voor automatisch scannen. |

**Ander adres of eigen model.** Kies bij *Aanbieder* voor *Ander endpoint*
(een dienst die werkt zoals de API van OpenAI) of *Lokaal model* (Ollama of
LM Studio, bijvoorbeeld `http://localhost:11434/v1`), pas zo nodig het adres
aan en vul de modelnaam in. Een lokaal model heeft geen key nodig en stuurt
niets naar buiten, maar is op een gewone laptop traag en minder nauwkeurig.

## Gegevens bewaren en overzetten

Alles staat alleen in je eigen browser. Bij **Gegevens** in het dashboard:

- **Exporteren** maakt één bestand met de gekozen profielen, met bronnen,
  scans en signaleringen, zonder je API-key. Handig als back-up, voor een
  andere computer of om een profiel met een collega te delen.
- **Importeren** toont eerst wat erin zit. Bestaat een profiel al, dan kies je
  **Toevoegen als kopie** of **Bestaande profielen vervangen**.

Verwijder je de extensie, dan zijn je gegevens weg. Exporteer dus eerst.

## Kosten en privacy

De extensie is gratis. Je betaalt alleen het taalmodel, via je eigen key; dat
hangt af van het model en het aantal beoordeelde publicaties. Laat **Alleen
nieuwe publicaties beoordelen** aan, kies een terugkijktijd die past bij hoe
vaak je scant, en houd bij je aanbieder je limiet en verbruik in de gaten.

- De extensie heeft **geen eigen server, geen account en meet niets**. De
  maker ziet niets van je profielen, bronnen of signaleringen.
- Per publicatie gaan de titel, een stukje tekst en de bronnaam, met je vraag,
  naar het model bij Instellingen, met jouw key.
- **Jij kiest de aanbieder, en daarmee wat er met je gegevens gebeurt.** Lees
  zijn privacybeleid: bewaart hij je invoer, traint hij erop? Bij OpenRouter
  kun je bij je account (*Privacy*) alleen aanbieders toestaan die niets
  bewaren en niet trainen.
- Neem geen bronnen op met vertrouwelijke informatie of gevoelige
  persoonsgegevens, tenzij je organisatie daar afspraken over heeft met de
  aanbieder.

Het volledige privacybeleid staat in [PRIVACY.md](PRIVACY.md).

## Problemen oplossen

**"Geen toestemming voor … host(s)".** Open het profiel met **Bewerken** en
klik op **Toestemming vragen**.

**"De API-key is vergrendeld".** Klik in de popup op **Ontgrendelen** en typ
je wachtwoordzin (zie stap 3).

**Verbinding testen geeft een fout.** Heb je de hele key geplakt, zonder
spatie? Klopt de modelnaam? Is de key nog geldig en de limiet niet bereikt?

**0 relevante publicaties.** Maak je vraag bij *Waar let je op?* breder, of
zet de terugkijktijd tijdelijk ruimer.

**Een feed geeft een fout bij Testen.** Waarschijnlijk is het een webpagina.
Gebruik het feedadres dat de extensie noemt, of kies *Webpagina*.

**De scan stopte halverwege**, bijvoorbeeld omdat Edge sloot. Klik op
**Opnieuw scannen**; er gaat niets verloren.

## Contact

Signaleringen wordt uitgegeven door FDLE ([fdle.eu](https://fdle.eu)).
Vragen of een fout gevonden? Mail naar
[vollebergh@fdle.eu](mailto:vollebergh@fdle.eu). Ontwikkelaars kijken in
[DEVELOPMENT.md](DEVELOPMENT.md).
