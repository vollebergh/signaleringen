# Privacybeleid Signaleringen

*Versie 1 · [datum invullen]*

Signaleringen is een browserextensie die publicaties uit bronnen volgt die u zelf kiest, door een taalmodel laat beoordelen en per profiel bundelt tot één signalering.

**Uitgever:** [naam uitgever invullen, bijv. FDLE] · **Contact:** [e-mailadres invullen]

## In het kort

- De extensie heeft **geen eigen server, geen account en geen telemetrie**. De uitgever ontvangt geen gegevens over uw gebruik of uw bronnen.
- Alles wat de extensie bewaart, staat **lokaal in uw browser**.
- Voor het beoordelen en samenvatten stuurt de extensie tekst naar een **taalmodel dat u zelf instelt**, met uw eigen API-key. **U bepaalt welk model en welke aanbieder dat is, en u bent verantwoordelijk voor het databeleid van die aanbieder.**

## Wat de extensie lokaal bewaart

Profielen en hun vragen, bronnen, gevonden publicaties (titel, adres, datum en een kort tekstfragment), scanresultaten, signaleringen, de status gezien/verwerkt en uw instellingen. Dit staat in `chrome.storage.local` en IndexedDB van uw browserprofiel. Het verlaat uw apparaat alleen via de functies hieronder en via de synchronisatie of back-up van uw browser zelf.

Uw API-key staat in dezelfde opslag. Met de optie *Vault* (Instellingen) versleutelt u hem met een wachtwoordzin (PBKDF2-SHA256, 600.000 iteraties, AES-GCM-256). Zonder vault staat hij onversleuteld en gaat hij mee met synchronisatie en back-ups van uw browser. Een vergeten wachtwoordzin is niet te herstellen.

U kunt alles exporteren, importeren en verwijderen via het dashboard; het verwijderen van de extensie wist ook de lokale gegevens.

## Wat naar een taalmodel gaat

Bij een scan stuurt de extensie per publicatie:

| Gegeven | Maximale omvang |
| --- | --- |
| Bronnaam | 200 tekens |
| Titel | 300 tekens |
| Tekstfragment (omschrijving of passage rond uw zoekterm) | 1.000 tekens bij het beoordelen, 2.000 bij het samenvatten |
| Uw vraag van het profiel en, indien ingevuld, de aanvullende instructie | zoals ingevoerd |
| Uw API-key, in de autorisatiekop | n.v.t. |

**Naar wie:** naar het endpoint dat u bij *Instellingen* invult. Standaard is dat de gateway OpenRouter (`openrouter.ai`); die stuurt de aanvraag door naar het model en de aanbieder die u kiest. U kunt in plaats daarvan een eigen proxy of een lokaal model invullen.

**Wie waarvoor verantwoordelijk is.** De uitgever sluit geen overeenkomst met modelaanbieders namens u en heeft geen inzage in wat zij met uw gegevens doen. Voor de verwerking gelden de voorwaarden van het endpoint en van de aanbieder die u zelf kiest. Controleer vóór gebruik of die aanbieder uw invoer niet bewaart en er niet mee traint. Bij OpenRouter kunt u in uw account (*Privacy*) instellen dat alleen aanbieders met *zero data retention* of zonder training worden gebruikt; dat geldt dan ook voor uw scans.

**Uitwijk.** Als u bij *Routing* een uitwijkmodel instelt en aanzet, gaat dezelfde inhoud na herhaalde fouten naar dat tweede model en die tweede aanbieder. Het is uw instelling en uw keuze van aanbieder.

**Voorfilter (optioneel, standaard uit).** Zet u *Voorfilter* aan, dan gaan titel, tekstfragment (max. 1.000 tekens), bronnaam en uw vraag (max. 500 tekens) naar het decisions-endpoint en het beslismodel dat u daar instelt. Zonder dit vinkje gebeurt dat niet.

Publicaties kunnen persoonsgegevens bevatten (bijvoorbeeld namen in een besluit). Neem geen bronnen met vertrouwelijke of bijzondere persoonsgegevens op, tenzij u daarover afspraken heeft met de aanbieder die u kiest.

## Welke websites de extensie benadert

Alleen hosts die u zelf als bron of proxy toevoegt, plus `open.overheid.nl` en, voor de volledige tekst van Kamerstukken, `zoek.officielebekendmakingen.nl`. Toegang tot een website vraagt de extensie pas op het moment dat u de bron toevoegt, na een klik van u. Documenten worden alleen in het geheugen doorzocht; alleen het fragment rond uw zoekterm (max. 300 tekens) wordt bewaard.

## Geen tracking, geen verkoop

De extensie gebruikt geen analytics, geen advertenties en geen externe scripts, verkoopt of deelt geen gegevens en gebruikt gegevens niet voor andere doelen dan hierboven beschreven.

## Uw rechten

De uitgever heeft geen persoonsgegevens van u; u kunt uw gegevens zelf inzien, exporteren en wissen in de extensie. Voor de verwerking bij het endpoint en de modelaanbieder die u kiest, wendt u zich tot die partijen.

## Wijzigingen

Een nieuwe versie van dit beleid staat op deze pagina, met een nieuwe datum en een samenvatting van wat is veranderd.
