# Signaleringen

Signaleringen is een browserextensie voor het duiden van nieuwe publicaties in RSS-feeds. 
Deze extensie is primair ontwikkeld als oplossing op het vervallen van de mailings van 
het Rijk en de ministeries. Kies een onderwerp en bronnen die je wilt volgen: nieuwsfeeds, 
webpagina's en zoekopdrachten op open.overheid.nl. De extensie haalt nieuwe publicaties in een RSS-feed op, 
filtert de relevante publicaties met AI, en maakt daar één korte samenvatting van op een manier die jij opgeeft.
Zonder taalmodel werkt de extensie als gewone RSS-feedlezer (zie [Zonder taalmodel](#zonder-taalmodel)).

**Inhoud**

- [Wat heb je nodig?](#wat-heb-je-nodig)
- [Aan de slag in zeven stappen](#aan-de-slag-in-zeven-stappen)
- [Hoe het werkt](#hoe-het-werkt)
- [Zonder taalmodel](#zonder-taalmodel)
- [Profielen en bronnen](#profielen-en-bronnen)
- [Gegevens bewaren en overzetten](#gegevens-bewaren-en-overzetten)
- [Kosten en privacy](#kosten-en-privacy)
- [Problemen oplossen](#problemen-oplossen)
- [Contact](#contact)

## Wat heb je nodig?

- **Een API-key**, als je wilt dat de extensie publicaties beoordeelt en
  samenvat. Heb je een key van je organisatie gekregen, gebruik die. Anders
  kun je er zelf een aanmaken bij o.a.:
  - **OpenRouter** ([openrouter.ai](https://openrouter.ai)).
  - **Anthropic** (Claude): [platform.claude.com](https://platform.claude.com).
  - **OpenAI** (ChatGPT): [platform.openai.com](https://platform.openai.com).
  Het is mogelijk om handmatig API-keys en endpoints van je eigen provider op te geven. Ook lokale modellen worden ondersteund.
  Let erop dat je zelf verantwoordelijk bent voor de kosten die je maakt op je API-key.
- **Een wachtwoordzin** die je zelf bedenkt en onthoudt. Hiermee versleutel je
  de API-key in een wachtwoordkluis. Deze stap is niet verplicht, maar wel aangeraden. Als je je API-key niet
  versleutelt, wordt deze opgeslagen in het browsergeheugen en kan deze door derden worden uitgelezen.

## Aan de slag in zeven stappen

**1. Installeer de extensie en zet hem vast.**
Installeer de extensie via de store. Zet hem daarna vast aan de werkbalk van
je browser, via het puzzelstukje rechtsboven. Klik op het pictogram (de
**popup**) en daarin op **Dashboard**.

**2. Vul je aanbieder, model en API-key in.**
Ga naar **Instellingen**. Laat de route op *Eigen API-key in deze browser*
staan. Vul bij **Base-URL** het adres van je aanbieder in, bijvoorbeeld
`https://openrouter.ai/api/v1`, en plak je key bij **API-key**. Vul bij
**Model** de modelnaam in, bijvoorbeeld `deepseek/deepseek-v4-flash-0731` bij
OpenRouter of `claude-haiku-5-5` bij Anthropic. De lege velden tonen een
voorbeeld. Klik op **Opslaan**. Bij een andere aanbieder dan OpenRouter vraagt
de browser één keer toestemming. Je key hoort bij het adres waarvoor je hem
invult: verander je later de Base-URL, vul dan ook de key van die aanbieder in.

**3. Stel desgewenst een terugvalmodel en/of een filtermodel in.**
Een taalmodel kan soms bezet zijn. Voeg desgewenst een terugvalmodel (fallback) toe.
Bij grotere scans (>100 publicaties) is een decision model zoals Jev sneller dan 
een taalmodel. 

**4. Versleutel je key met een wachtwoordzin. Sla deze stap niet over.**
Zonder wachtwoordzin staat je key leesbaar in je browser, en gaat hij leesbaar
mee als je browser synchroniseert of een back-up maakt. Wie bij je
browserprofiel kan, kan het gekozen taalmodel op jouw kosten gebruiken.

1. Zoek bij Instellingen het blok **Wachtwoordkluis (versleuteling van de key)**.
2. Typ twee keer dezelfde wachtwoordzin, minstens 8 tekens. Een zin van een
   paar woorden is sterker en makkelijker te onthouden dan een kort
   wachtwoord.
3. Klik op **Key versleutelen**.

Goed om te weten:

- **Als je je computer afsluit of de extensie updatet** is de key
  vergrendeld; je key en profielen blijven bewaard. Een slotje op het
  pictogram laat dat zien. Klik op het pictogram, typ je wachtwoordzin en druk
  op Enter. Tot dan kan de extensie niet
  scannen, ook niet automatisch. Gebruik een wachtwoordmanager om je wachtwoordzin
  snel in te voeren.
- **Key wijzigen?** Klik op **Wachtwoordkluis opheffen**, plak de nieuwe key, klik op
  **Opslaan** en versleutel opnieuw.
- **Wachtwoordzin vergeten?** Die is niet te herstellen, ook niet door de
  ontwikkelaar. Exporteer je profielen (zie
  [Gegevens](#gegevens-bewaren-en-overzetten)), verwijder de extensie,
  installeer en importeer opnieuw en plak je key opnieuw.
- De wachtwoordzin beschermt je key in je profiel, back-ups en
  synchronisatie, niet tegen schadelijke software die meekijkt terwijl hij
  ontgrendeld is. Deel je key met niemand.

**5. Test de verbinding.**
Klik onderaan Instellingen op **Verbinding testen**. Je ziet *Verbinding
werkt*, of een fout (zie [Problemen oplossen](#problemen-oplossen)).

**6. Maak je eerste profiel.**
Ga naar **Profielen** → **Nieuw profiel**. Vul een **Profielnaam** in en bij
**Waar let je op?** in een of twee zinnen wat je wilt weten, bijvoorbeeld:
*Wat verandert er in het stikstofbeleid voor de landbouw en de bouw?* Begin
liever breed: een te smalle vraag levert niets op. Voeg bij **Bronnen** een of
meer bronnen toe (zie [Profielen en bronnen](#profielen-en-bronnen)), klik bij
elke bron op **Testen** en geef de browser toestemming om die website te lezen.
Klik op **Opslaan**.

**7. Doe je eerste scan.**
Klik bij je profiel op **Scan nu**. Dat duurt meestal een halve tot een paar
minuten. Klik daarna op **Lees signalering**.

## Hoe het werkt

Een scan gaat in drie stappen:

1. **Ophalen** uit je bronnen, van de afgelopen dagen (instelbaar, standaard 7).
2. **Beoordelen.** Het taalmodel beoordeelt van elke publicatie de relevantie:
   **irrelevant**, **mogelijk relevant**, en **relevant**. Wellicht relevante publicaties
   komen niet in de signalering, wel in de bronnenlijst.
3. **Samenvatten.** Het taalmodel schrijft over de nieuwe relevante publicaties één
   signalering. Een nummer als [1] verwijst naar de bron waar een
   bewering vandaan komt.

Een taalmodel kan fouten maken: lees bij twijfel de publicaties
zelf, en extra kritisch als er een waarschuwing met ⚠ boven de signalering
staat.

**Scannen.** Klik op **Scan** in de popup of **Scan nu** in het dashboard. Je
kunt de popup sluiten; de scan loopt door. Staan er meer dan 200 publicaties
klaar, dan vraagt de extensie een bevestiging vanwege de kosten. Stoppen kost niets, ze
komen de volgende keer terug.

**Automatisch scannen.** Zet bij **Instellingen → Automatisch synthetiseren** het vinkje aan, 
en in elk profiel **Automatisch synthetiseren** met hoe vaak (elk uur tot elke week). Een nieuwe automatische
signalering zie je aan een getal op het pictogram en het label *nieuw* in de
popup. Dit werkt alleen als de browser openstaat en je key ontgrendeld is.

**Lezen.** In de popup zie je per profiel een voorproefje met **Lees signalering**; 
in het dashboard ook **Alle signaleringen** (de laatste vijf
scans per profiel). Het scanresultaat toont alle publicaties met score en
label: **nieuw**, **eerder gezien** of **eerder verwerkt** (al in een eerdere
signalering). Met **☆ Bewaren** zet je er een bij je **Bladwijzers**, met
**Kopiëren** neem je de signalering mee naar bijvoorbeeld een mail.

**Ging er iets mis tijdens het samenvatten**, bijvoorbeeld omdat de browser
sloot? Dan staat in het scanresultaat **Signalering opstellen** of **Opnieuw
proberen**. Er wordt dan niets opnieuw beoordeeld.

## Zonder taalmodel

Zonder taalmodel werkt de extensie als gewone feedlezer. Sla stap 2 tot en
met 5 over; *Waar let je op?* mag leeg blijven.

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

## Profielen en bronnen

Een profiel is één onderwerp dat je volgt. Per profiel stel je in:

- **Profielnaam** en eventueel een **Categorie** (label), om profielen te groeperen en
  te filteren.
- **Waar let je op?** Het criterium of de zoekterm(en) waarop het taalmodel de feed filtert. 
- **Instructie voor de signalering (optioneel)**, bijvoorbeeld *Begin met de
  drie belangrijkste ontwikkelingen* of *Schrijf voor een bestuurder*. 
  Schrijf de instructie zoals je je signalering van een collega zou vragen.
- **Terugkijktijd** (1 tot 365 dagen, standaard 7). Heb je een tijd niet
  gescand, zet hem ruimer; wat al eerder langskwam kost niets extra.
- **Alleen nieuwe publicaties beoordelen** (standaard aan). Zet dit uit als je
  je vraag hebt veranderd en alles opnieuw beoordeeld wilt hebben; dat kost
  meer.
- **Automatisch synthetiseren** (zie [Hoe het werkt](#hoe-het-werkt)).

Met **Dupliceren** probeer je een andere vraag op dezelfde bronnen. Zo kun je bijvoorbeeld
per profiel de RSS-feed van ministeries op verschillende onderwerpen filteren.

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
een zoekterm, en plak het adres uit de adresbalk als bron. Tips:

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

**Met de rechtermuisknop** kies je op een webpagina **Deze pagina toevoegen als bron…**, 
of vanuit geselecteerde tekst **Selectie signaleren…** (de
selectie zie je ter herinnering, maar wordt niet bewaard).

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
hangt af van het model en het aantal beoordeelde publicaties. Laat 
**Alleen nieuwe publicaties beoordelen** aan, kies een terugkijktijd die past 
bij hoe vaak je scant, en houd bij je aanbieder je limiet en verbruik in de gaten.

- De extensie heeft **geen eigen server, geen account en meet niets**. De
  ontwikkelaar ziet niets van je profielen, bronnen of signaleringen.
- Per publicatie gaan de titel, een stukje tekst en de bronnaam, met je vraag,
  naar het model bij Instellingen, met jouw key.
- **Jij kiest de aanbieder, en daarmee wat er met je gegevens gebeurt.** Lees
  het privacybeleid: bewaart deze je invoer, traint deze erop? Bij OpenRouter
  kun je bij je account (*Privacy*) filteren op aanbieders die niets
  bewaren en niet trainen.

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

Deze extensie wordt uitgegeven door FDLE ([fdle.eu](https://fdle.eu)).
Vragen of een fout gevonden? Mail naar
[vollebergh@fdle.eu](mailto:vollebergh@fdle.eu). Ontwikkelaars kijken in
[DEVELOPMENT.md](DEVELOPMENT.md).
