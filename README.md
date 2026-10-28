# Signaleringen

Signaleringen is een extensie voor Microsoft Edge. Je kiest een onderwerp en
de bronnen die je wilt volgen: nieuwsfeeds, webpagina's en zoekopdrachten op
open.overheid.nl. De extensie haalt de nieuwe publicaties op, laat een
taalmodel (AI) bepalen welke over jouw onderwerp gaan, en maakt daar één
korte samenvatting van: de **signalering**. Zo lees je niet alles zelf, maar
zie je wel wat er speelt.

**Inhoud**

- [Wat heb je nodig?](#wat-heb-je-nodig)
- [Aan de slag in zes stappen](#aan-de-slag-in-zes-stappen)
- [Hoe het werkt](#hoe-het-werkt)
- [Overzicht van de functies](#overzicht-van-de-functies)
- [Profielen](#profielen)
- [Bronnen](#bronnen)
- [Scannen](#scannen)
- [Signaleringen lezen](#signaleringen-lezen)
- [Je API-key en de wachtwoordzin](#je-api-key-en-de-wachtwoordzin)
- [Instellingen](#instellingen)
- [Gegevens bewaren en overzetten](#gegevens-bewaren-en-overzetten)
- [Kosten](#kosten)
- [Privacy](#privacy)
- [Problemen oplossen](#problemen-oplossen)
- [Contact](#contact)

## Wat heb je nodig?

- **Microsoft Edge.** Installeer Signaleringen via de Edge Add-ons-store.
- **Een API-key van OpenRouter.** Dat is een soort wachtwoord waarmee de
  extensie het taalmodel mag gebruiken. Heb je een key van je organisatie
  gekregen, gebruik die. Anders maak je zelf een account op
  [openrouter.ai](https://openrouter.ai) en maak je daar een key aan. Zet er
  meteen een **uitgavenlimiet** op; dan weet je zeker dat het nooit meer kost
  dan je wilt.
- **Een wachtwoordzin** die je zelf bedenkt en onthoudt. Daarmee versleutel je
  de key (zie stap 3).

## Aan de slag in zes stappen

**1. Installeer de extensie en zet hem vast.**
Na de installatie klik je in Edge op het puzzelstukje rechtsboven en zet je
*Signaleringen* vast aan de werkbalk. Klik op het pictogram: je ziet nu het
kleine venster (de **popup**). Klik daarin op **Dashboard**.

**2. Plak je API-key.**
Ga in het dashboard naar **Instellingen**. Laat bij *Verbinding* de keuze
op *Eigen API-key in deze browser* staan en plak je key in het veld
**API-key**. Klik op **Opslaan**.

**3. Versleutel je key met een wachtwoordzin. Sla deze stap niet over.**
Zonder deze stap staat je key leesbaar in je browser. Iedereen of elk
programma dat bij je browserprofiel kan, kan hem dan lezen. Ook gaat hij
leesbaar mee als je browser je gegevens synchroniseert of een back-up maakt.
Met de key kan iemand op jouw kosten het taalmodel gebruiken.

Zo versleutel je hem:

1. Zoek bij Instellingen het blok **Versleuteling van de key**.
2. Typ twee keer dezelfde wachtwoordzin (minstens 8 tekens; een zin van een
   paar woorden is sterker en makkelijker te onthouden dan een kort
   wachtwoord).
3. Klik op **Key versleutelen**.

Daarna staat er: *De key staat versleuteld en is ontgrendeld tot je de
browser sluit.* Goed om te weten:

- **Na het opnieuw starten van de browser, en na een update van de
  extensie,** is de key vergrendeld. Edge werkt de extensie vanzelf bij; je
  key en je profielen blijven daarbij bewaard. De popup vraagt dan je
  wachtwoordzin; klik op **Ontgrendelen**. Tot je dat doet, kan de extensie
  niet scannen, ook niet automatisch.
- **Ben je je wachtwoordzin vergeten?** Die is niet te herstellen, ook niet
  door de maker. Exporteer je profielen (zie
  [Gegevens bewaren en overzetten](#gegevens-bewaren-en-overzetten)),
  verwijder de extensie, installeer hem opnieuw, importeer je profielen en
  plak je key opnieuw. Kun je de key zelf niet meer vinden, maak dan een
  nieuwe aan op openrouter.ai.
- Met **Nu vergrendelen** vergrendel je de key meteen, bijvoorbeeld als je
  even van je computer weggaat.

**4. Test de verbinding.**
Klik onderaan Instellingen op **Verbinding testen**. Na een paar seconden zie
je *Verbinding werkt*. Krijg je een foutmelding, kijk dan bij
[Problemen oplossen](#problemen-oplossen).

**5. Maak je eerste profiel.**
Ga naar **Profielen** en klik op **Nieuw profiel**. Vul in:

- **Profielnaam**, bijvoorbeeld *Stikstofbeleid*.
- **Waar let je op?** Beschrijf in een of twee zinnen wat je wilt weten.
  Bijvoorbeeld: *Wat verandert er in het stikstofbeleid voor de landbouw en
  de bouw?* Dit is de vraag waarmee het taalmodel elke publicatie
  beoordeelt. Een te smalle vraag levert niets op; begin liever wat breder.

Voeg daarna bij **Bronnen** een of meer bronnen toe met **Bron toevoegen**
(zie [Bronnen](#bronnen)). Klik bij elke bron op **Testen**. De eerste keer
vraagt Edge of de extensie die website mag lezen; klik op *Toestaan*. Klik
tot slot op **Opslaan**.

**6. Doe je eerste scan.**
Klik bij je profiel op **Scan nu**. De extensie haalt de publicaties op,
laat ze beoordelen en maakt de signalering. Dat duurt meestal een halve tot
een paar minuten. Klik daarna op **Lees signalering**.

## Hoe het werkt

Een scan gaat in drie stappen:

1. **Ophalen.** De extensie haalt de publicaties op uit je bronnen, van de
   afgelopen dagen (standaard 7).
2. **Beoordelen.** Het taalmodel geeft elke publicatie een score van 0 tot 100:
   hoe goed past ze bij je vraag?
   - **65 of hoger: relevant.** Deze publicaties komen in de signalering.
   - **40 tot 64: mogelijk relevant.** Je ziet ze in het scanresultaat, met
     de score, zodat je ze zelf kunt bekijken. Ze komen niet in de
     signalering.
   - **Lager dan 40: weggefilterd.**
3. **Samenvatten.** Het taalmodel schrijft over de relevante publicaties één
   signalering. Achter elke bewering staat een nummer, zoals [1]. Dat nummer
   verwijst naar de publicatie waar het vandaan komt, zodat je het kunt
   nalezen.

De extensie onthoudt wat ze al eens heeft opgehaald. Standaard beoordeelt een
volgende scan alleen wat nieuw is. Dat scheelt tijd en kosten.

**Let op:** een taalmodel kan fouten maken. Gebruik de signalering als
startpunt en lees bij twijfel de publicatie zelf. Staat er boven een
signalering een waarschuwing met ⚠, bijvoorbeeld omdat bronverwijzingen
ontbreken, lees haar dan extra kritisch.

## Overzicht van de functies

| Functie | Waar |
| --- | --- |
| Profielen maken, bewerken, dupliceren en verwijderen | Dashboard → Profielen |
| Bronnen toevoegen: nieuwsfeeds, webpagina's, open.overheid.nl | Profiel → Bewerken → Bronnen |
| Een lijst met feeds in één keer toevoegen (OPML) | Profiel → Bewerken → OPML importeren |
| Een pagina toevoegen terwijl je hem leest | Rechtermuisknop → *Deze pagina toevoegen als bron…* |
| Scannen met één klik | Popup, zijpaneel of dashboard |
| Automatisch scannen, bijvoorbeeld elke dag | Instellingen en per profiel |
| De laatste signalering lezen | Popup → *Lees signalering*, of het zijpaneel |
| Eerdere signaleringen teruglezen | Profiel → *Alle signaleringen* |
| Signalering kopiëren, bijvoorbeeld naar een mail | Knop *Kopiëren* bij de signalering |
| Publicaties bewaren om later te lezen | *☆ Bewaren* in het scanresultaat; terug te vinden bij Bladwijzers |
| Profielen exporteren en importeren | Dashboard → Gegevens |
| Je key versleutelen met een wachtwoordzin | Instellingen → Versleuteling van de key |
| Licht of donker thema | Instellingen → Weergave |

## Profielen

Een profiel is één onderwerp dat je volgt. Per profiel stel je in:

- **Profielnaam** en eventueel een **Categorie**. Met categorieën groepeer je
  profielen; bovenaan de lijst kun je erop filteren.
- **Waar let je op?** De vraag waarmee het taalmodel publicaties beoordeelt.
  Schrijf hem zoals je hem aan een collega zou stellen.
- **Instructie voor de signalering (optioneel).** Hoe je de samenvatting wilt
  hebben. Bijvoorbeeld: *Begin met de drie belangrijkste ontwikkelingen* of
  *Schrijf voor een bestuurder, zonder vakjargon*.
- **Terugkijktijd.** Hoeveel dagen een scan terugkijkt (1 tot 365, standaard 7).
  Heb je een tijd niet gescand, zet hem dan wat ruimer. Wat je al eerder zag,
  wordt niet opnieuw beoordeeld, dus dat kost weinig extra.
- **Alleen nieuwe publicaties beoordelen** (standaard aan). Zet dit uit als je
  je vraag hebt veranderd en alles opnieuw beoordeeld wilt hebben. Dat kost
  meer.
- **Automatisch synthetiseren.** Laat dit profiel vanzelf scannen, van elk uur
  tot elke week. Zie [Scannen](#scannen).

Met **Dupliceren** maak je een kopie van een profiel, bijvoorbeeld om een
andere vraag op dezelfde bronnen te proberen.

## Bronnen

Er zijn drie soorten bronnen:

| Soort | Wat de extensie ophaalt |
| --- | --- |
| **RSS/Atom-feed** | De berichten uit een nieuwsfeed |
| **Webpagina** | De tekst van één pagina, als één publicatie |
| **Zoekopdracht op open.overheid.nl** | Kamerbrieven, rapporten, Woo-stukken en andere overheidsdocumenten |

**Een feed vinden.** Een feed is een lijst met de nieuwste berichten van een
website. Je hebt het adres van de feed zelf nodig, niet van de homepage.
Probeer het adres van de site met `/rss`, `/rss.xml` of `/feed/` erachter.
Geef je toch een gewone webpagina op als feed, dan meldt de extensie dat bij
**Testen**, en noemt ze het feedadres als de pagina er een heeft. Sommige
feeds geven alleen titels; het taalmodel beoordeelt dan alleen de titel.

**Een zoekopdracht op open.overheid.nl.** Stel je zoekopdracht samen op
[open.overheid.nl](https://open.overheid.nl): zoek, klap *Uitgebreid zoeken*
open en kies ministeries, soorten documenten en eventueel een zoekterm.
Kopieer dan het adres uit de adresbalk en plak het als bron. De extensie
herkent het zelf. Kies je op de site een periode (zoals *Afgelopen maand*),
dan geldt die in plaats van de terugkijktijd van het profiel.

Tips voor een beleidsonderwerp:

- Filter op het ministerie en houd de zoekterm leeg of breed. Het taalmodel
  doet de rest met je vraag.
- Voeg een tweede bron toe met alleen de zoekterm, of met de organisatie
  *Tweede Kamer*. Kamerstukken en moties staan vaak niet onder het
  ministerie.
- Geeft een Kamerstuk in de zoekresultaten geen tekst, dan haalt de extensie
  de volledige tekst op bij officielebekendmakingen.nl en zoekt daarin de
  passage over je zoekterm. Daarvoor vraagt ze één keer toestemming. Zeg je
  nee, dan werkt de scan gewoon; in het scanresultaat staat dan een knop
  **Toegang geven**.

**Toestemming per website.** De extensie mag alleen websites lezen die jij
als bron toevoegt. Bij een nieuwe website vraagt Edge daarom om toestemming.
Heb je die per ongeluk geweigerd, dan staat in het profiel de melding dat er
nog toestemming ontbreekt. Klik daar op **Toestemming vragen**.

**Met de rechtermuisknop.** Op een webpagina kun je met de rechtermuisknop
kiezen voor **Deze pagina toevoegen als bron…**. Je kiest dan het profiel en
het soort bron. Met **Selectie signaleren…** doe je hetzelfde vanuit een stuk
geselecteerde tekst; die tekst zie je ter herinnering, maar de extensie
bewaart hem niet.

## Scannen

**Zelf scannen.** Klik op **Scan** in de popup, op **Scan nu** in het
dashboard of op **Scan** in het zijpaneel. Tijdens de scan zie je hoe ver hij
is. Je kunt de popup gewoon sluiten; de scan loopt door.

**Grote scans.** Staan er meer dan 200 publicaties klaar, dan vraagt de
extensie eerst of je door wilt. Stop je, dan gaat er niets verloren: die
publicaties komen bij de volgende scan terug.

**Automatisch scannen.** Dit gaat in twee stappen:

1. Zet bij **Instellingen → Automatisch synthetiseren** het vinkje aan. De
   extensie krijgt dan toestemming om taken op de achtergrond uit te voeren.
2. Zet in elk profiel dat je automatisch wilt laten scannen **Automatisch
   synthetiseren** aan en kies hoe vaak.

Een nieuwe automatische signalering herken je aan een getal op het pictogram
van de extensie en het label *nieuw* in de popup. Die verdwijnen als je de
signalering leest. Automatisch scannen werkt alleen als Edge openstaat en je
key ontgrendeld is.

**Een signalering alsnog opstellen.** Is de browser afgesloten terwijl de
signalering werd gemaakt, of ging er iets mis? Dan staat in het
scanresultaat een knop **Signalering opstellen** of **Opnieuw proberen**. De
publicaties worden dan niet opnieuw beoordeeld.

## Signaleringen lezen

Je kunt een signalering op drie plekken lezen:

- **Popup.** Een voorproefje per profiel, met **Lees signalering**.
- **Zijpaneel.** Klik in de popup op **Paneel**. Het zijpaneel blijft naast de
  pagina staan, ook als je van tabblad wisselt. Kies bovenaan het profiel.
  Met **Alle signaleringen →** en **Publicaties →** ga je naar het dashboard.
- **Dashboard.** Bij een profiel: **Lees signalering** voor de nieuwste,
  **Alle signaleringen** voor eerdere. Per profiel bewaart de extensie de
  laatste vijf scans met hun signaleringen.

In het scanresultaat zie je ook alle beoordeelde publicaties, met hun score
en een label: **nieuw**, **eerder gezien** of **eerder verwerkt** (al in een
eerdere signalering). Met **☆ Bewaren** zet je een publicatie bij je
**Bladwijzers**.

## Je API-key en de wachtwoordzin

Je key is persoonlijk. Deel hem niet en zet hem nergens anders neer.

| | Zonder wachtwoordzin | Met wachtwoordzin |
| --- | --- | --- |
| Hoe de key bewaard wordt | Leesbaar | Versleuteld |
| Gaat mee in synchronisatie en back-ups | Leesbaar | Alleen versleuteld |
| Na het herstarten van de browser of een update | Werkt meteen | Eerst ontgrendelen |

Gebruik daarom altijd de wachtwoordzin (zie [stap 3](#aan-de-slag-in-zes-stappen)).
De wachtwoordzin beschermt je key in je browserprofiel, in back-ups en bij
synchronisatie. Hij beschermt niet tegen schadelijke software die meekijkt
terwijl de key ontgrendeld is. Houd je computer dus ook zelf veilig.

**Je key wijzigen.** Een versleutelde key kun je niet zomaar aanpassen. Klik
eerst op **Vault opheffen** (de key staat dan weer leesbaar), plak de nieuwe
key, klik op **Opslaan** en versleutel opnieuw.

**Verbruik bekijken.** Op [openrouter.ai](https://openrouter.ai) zie je
hoeveel je key heeft verbruikt en kun je de limiet aanpassen.

## Instellingen

De meeste instellingen staan al goed. Pas ze alleen aan als je weet waarom.

| Onderdeel | Wat je er instelt |
| --- | --- |
| **Verbinding** | Je API-key en de versleuteling ervan. *Via een eigen proxy* is alleen voor organisaties die dat zelf aanbieden. |
| **Model** | Welk taalmodel de publicaties beoordeelt en samenvat. Staat vooringesteld. |
| **Routing** | Bij welke aanbieder het model draait, en de **uitwijkroute**: een tweede model dat het overneemt als het eerste tijdelijk niet bereikbaar is. De uitwijk staat standaard aan; je kunt hem uitzetten. Test hem met **Uitwijkroute testen**. |
| **Voorfilter** | Optioneel, standaard uit. Een snel beslismodel zeeft eerst publicaties weg die duidelijk niet over je onderwerp gaan. Dat maakt grote scans sneller. Weggezeefde publicaties zie je bij *Weggefilterd*, met het label *voorfilter*. |
| **Signalering** | Hoeveel publicaties er hooguit in één signalering gaan (standaard 25, de best passende). |
| **Weergave** | Systeem, licht of donker. |
| **Automatisch synthetiseren** | De hoofdschakelaar voor automatisch scannen. |

Klik na een wijziging op **Opslaan**.

**Zelf een taalmodel draaien.** Heb je een eigen taalmodel op je computer of
in je netwerk, bijvoorbeeld met Ollama of LM Studio? Vul dan bij *Base-URL*
het adres in (zoals `http://localhost:11434/v1`), bij *Model* de naam van het
model, en laat de API-key leeg. Er gaat dan niets naar OpenRouter. Een klein
model op een gewone laptop is wel traag en minder nauwkeurig.

## Gegevens bewaren en overzetten

Alles wat de extensie bewaart, staat alleen in je eigen browser. Ga in het
dashboard naar **Gegevens**:

- **Exporteren** maakt één bestand met de profielen die je kiest, met hun
  bronnen, scans en signaleringen. Je API-key zit er niet in. Handig als
  back-up, om naar een andere computer over te stappen of om een profiel met
  een collega te delen.
- **Importeren** leest zo'n bestand in. Je ziet eerst wat erin zit. Bestaat
  een profiel al, dan kies je: **Toevoegen als kopie** (er gaat niets
  verloren) of **Bestaande profielen vervangen**.

Verwijder je de extensie, dan zijn al je gegevens weg. Exporteer dus eerst.

## Kosten

De extensie zelf is gratis. Je betaalt alleen voor het gebruik van het
taalmodel, via je eigen OpenRouter-key. Hoeveel dat is, hangt af van het
aantal publicaties dat beoordeeld wordt. Zo houd je de kosten laag:

- laat **Alleen nieuwe publicaties beoordelen** aan;
- kies een terugkijktijd die past bij hoe vaak je scant;
- zet een **uitgavenlimiet** op je key bij openrouter.ai, en kijk daar af en
  toe naar je verbruik.

## Privacy

- De extensie heeft **geen eigen server, geen account en meet niets**. De
  maker ziet niets van je profielen, bronnen of signaleringen.
- Om te beoordelen en samen te vatten, stuurt de extensie per publicatie de
  titel, een stukje tekst en de naam van de bron naar het taalmodel, samen
  met je vraag. Dat gaat naar het model dat bij Instellingen staat, met
  jouw key.
- **Jij kiest het model en de aanbieder, en daarmee wat er met je gegevens
  gebeurt.** Op openrouter.ai kun je bij je account (*Privacy*) instellen dat
  alleen aanbieders worden gebruikt die niets bewaren en niet trainen op je
  gegevens.
- Neem geen bronnen op met vertrouwelijke informatie of gevoelige
  persoonsgegevens, tenzij je organisatie daar afspraken over heeft met de
  aanbieder.

Het volledige privacybeleid staat in [PRIVACY.md](PRIVACY.md).

## Problemen oplossen

**"Geen toestemming voor … host(s)".** De extensie mag die website nog niet
lezen. Open het profiel met **Bewerken**, klik op **Toestemming vragen** en
sta het toe.

**"De API-key is vergrendeld".** Je browser is opnieuw gestart, of de
extensie is bijgewerkt. Klik in de popup op **Ontgrendelen** en typ je
wachtwoordzin.

**Verbinding testen geeft een fout.** Controleer of je de hele key hebt
geplakt, zonder spatie ervoor of erachter. Kijk op openrouter.ai of je key
nog geldig is en of de limiet niet is bereikt.

**Een scan vindt 0 relevante publicaties.** Je vraag bij *Waar let je op?*
is misschien te smal. Maak hem breder. Of je bronnen hadden in de
terugkijktijd niets nieuws; zet de terugkijktijd tijdelijk ruimer.

**Een feed geeft een foutmelding bij Testen.** Waarschijnlijk is het een
gewone webpagina en geen feed. Gebruik het feedadres dat de extensie noemt,
of kies als soort bron *Webpagina*.

**De scan stopte halverwege.** Bijvoorbeeld omdat Edge werd afgesloten. Je
ziet dan een melding met een knop **Opnieuw scannen**. Er gaat niets
verloren.

## Contact

Signaleringen wordt uitgegeven door FDLE ([fdle.eu](https://fdle.eu)).
Vragen of een fout gevonden? Mail naar
[vollebergh@fdle.eu](mailto:vollebergh@fdle.eu).

Ben je ontwikkelaar? Kijk dan in [DEVELOPMENT.md](DEVELOPMENT.md).
