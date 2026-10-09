/**
 * Centrale constanten. Tegenhanger van `AppConfig.kt` in de Android-app.
 * Geen magic numbers elders in de codebase.
 */
export const AppConfig = {
  // Netwerk-timeouts (milliseconden)
  FEED_TIMEOUT_MS: 15_000,
  LLM_TIMEOUT_MS: 120_000,

  // Contentlimieten
  WEB_CONTENT_MAX_CHARS: 5_000,
  RSS_DESCRIPTION_MAX_CHARS: 300,

  // Publicatiefilter
  /**
   * Terugkijktijd: hoe ver een scan terugkijkt naar publicaties. Per profiel
   * in te stellen (`lookbackDays`, B-51); dit is de standaard voor nieuwe
   * profielen. Een open.overheid-zoek-URL met een eigen periode gaat voor.
   */
  DEFAULT_LOOKBACK_DAYS: 7,
  MAX_LOOKBACK_DAYS: 365,

  // Retry met exponential backoff
  MAX_RETRIES: 3,
  RETRY_INITIAL_DELAY_MS: 1_000,
  RETRY_BACKOFF_FACTOR: 2,

  /**
   * Opnieuw proberen bij een LLM-aanroep die op 429 of 5xx stuit. Met
   * `allow_fallbacks: false` wijkt OpenRouter niet uit naar een andere
   * provider; zit DeepInfra even aan zijn limiet, dan komt dat als 429
   * "Provider returned error" terug. Ruimer dan bij feeds: een scan heeft
   * meerdere batches na elkaar, en één afgewezen batch mag niet de hele scan
   * laten mislukken. Een `Retry-After` van de server gaat voor, tot het plafond.
   *
   * Pogingen per route: eerst de primaire route, daarna de uitwijkroute uit
   * de instellingen (`fallback*` in DefaultSettings). Dus maximaal 2 × 3
   * aanroepen.
   */
  LLM_ATTEMPTS_PER_ROUTE: 3,
  LLM_RETRY_INITIAL_DELAY_MS: 2_000,
  LLM_RETRY_MAX_DELAY_MS: 30_000,

  // LLM
  LLM_MAX_TOKENS: 16_384,
  LLM_TEMPERATURE: 0.1,
  SYNTHESIS_MAX_TOKENS: 4_096,
  SYNTHESIS_TEMPERATURE: 0.3,

  /**
   * Redeneerinspanning — één regelaar, niet twee. "Uit" en "minimaal" zijn twee
   * standen op dezelfde schaal:
   *
   *   'none'    geen redeneertokens
   *   'minimal' ±10% van de tokens gaat naar redeneren
   *   'low' | 'medium' | 'high' | 'xhigh' | 'max'   oplopend, tot ±95%
   *
   * DeepSeek V4 Flash 0731 is een reasoning-model, dus elk niveau boven 'none'
   * kost tokens uit `max_tokens` aan een gedachtegang die de extensie zelf niet
   * gebruikt. Relevantie beoordelen en een signalering schrijven hebben die
   * gedachtegang niet nodig, en B-D06 noemt de verbositeit van dit model al als
   * kostenrisico.
   *
   * `enabled: false` combineren met een `effort`-waarde is bewust vermeden: de
   * OpenRouter-documentatie legt niet vast wat er dan voorrang krijgt.
   */
  LLM_REASONING_EFFORT: 'none',

  /**
   * Lengtegrenzen per publicatie in de prompt (B-44). Houdt één bron met een
   * lange lap tekst — al dan niet met ingebedde instructies — in toom. De
   * synthese krijgt iets meer ruimte dan het filter, omdat zij de inhoud moet
   * samenvatten en niet alleen beoordelen.
   */
  PROMPT_TITLE_MAX_CHARS: 300,
  PROMPT_FILTER_TEXT_MAX_CHARS: 1_000,
  PROMPT_SYNTHESIS_TEXT_MAX_CHARS: 2_000,

  /**
   * Relevantie als score (B-59). Het model geeft per publicatie 0–100; de
   * extensie deelt in. "Mogelijk relevant" is zichtbaar in het scanresultaat
   * maar gaat niet naar de synthese: twijfelgevallen wisselen tussen runs, en
   * zo ziet de gebruiker ze in plaats van dat ze willekeurig in of uit de
   * signalering vallen.
   *
   * Gekalibreerd op het additionaliteitsprofiel (150 publicaties, 5 runs,
   * 2026-10-07): bij 65 schommelt "relevant" tussen 44 en 48 en wisselen 7
   * publicaties tussen runs, bij 60 is dat 44–51 en 12. Het model gebruikt de
   * 60-er scores zelden, dus 65 en 70 geven hetzelfde. Ondergrens 40: daaronder
   * zit vooral wat het model in de ene run 0–10 en in de andere 30 geeft.
   * Details in "Design - Beslissingen" (B-D12).
   */
  RELEVANCE_THRESHOLD: 65,
  POSSIBLE_RELEVANCE_THRESHOLD: 40,

  /**
   * Pogingen per batch als het antwoord geen leesbare JSON-array is. Dat
   * gebeurt af en toe (2026-10-07: 1 van ± 12 batches); een nieuwe poging
   * lukt dan vrijwel altijd. Blijft het mislukken, dan krijgen die
   * publicaties geen oordeel en biedt de volgende scan ze opnieuw aan.
   */
  LLM_PARSE_ATTEMPTS: 3,

  // Batching — voorkomt afgekapte responses bij grote feeds (zie B-20)
  LLM_BATCH_SIZE: 40,

  /**
   * Voorfilter met Jev (B-58, besluit B-D10). Optioneel, standaard uit
   * (`jevPrefilterEnabled`); endpoint, key, model en routing staan in de
   * instellingen (`prefilter*`). Jev geeft per publicatie een kans 0–1 dat ze
   * over de gebruikersvraag gaat; de extensie rekent die om naar 0–100. Wat
   * onder de drempel valt, gaat niet naar DeepSeek.
   *
   * De drempel ligt bewust laag: wat de voorfilter weggooit, ziet het model
   * nooit. Gemeten op het additionaliteitsprofiel (150 publicaties,
   * 2026-10-07): bij 10 bleven alle 45 zeker relevante behouden en ging de
   * helft door; bij 15–20 vielen er 1–3 weg.
   *
   * Batches van 40: state plus langste vraag moet binnen 32k tokens blijven.
   */
  JEV_PREFILTER_THRESHOLD: 10,
  JEV_BATCH_SIZE: 40,
  JEV_TIMEOUT_MS: 30_000,
  /** De gebruikersvraag staat in elke noul-vraag; begrensd tegen een uit de hand gelopen profiel. */
  JEV_QUERY_MAX_CHARS: 500,

  /**
   * Plafond per open.overheid-bron per scan. Een brede zoekopdracht (een heel
   * ministerie) levert zo'n 40 publicaties per week; na lang niet scannen kan
   * het venster er honderden bevatten. Liever de oudste overslaan dan één scan
   * de hele batchverwerking laten opsouperen.
   */
  OPEN_OVERHEID_MAX_RESULTS: 200,

  /**
   * Volledige tekst voor open.overheid-publicaties zonder fragment (B-60).
   * De zoek-API geeft dan alleen titel en standaardomschrijving, en daar zit
   * de meeste twijfel. Kamerstukken via officielebekendmakingen.nl hebben de
   * hele tekst als HTML; de extensie zet een fragment rond de zoekterm erbij.
   * Alleen voor wat beoordeeld wordt (nieuwe publicaties), een paar tegelijk,
   * met een plafond per scan. Gemeten 2026-10-07: ± 0,6–1,7 s per pagina.
   */
  FULLTEXT_MAX_PER_SCAN: 100,
  FULLTEXT_CONCURRENCY: 4,
  //
  // Fragmentgrootte gelijk aan een gewoon fragment van de zoek-API (mediaan
  // ± 250 tekens incl. organisatie). Gemeten 2026-10-09 op 151 publicaties:
  // 300 tekens kost +1.400 prompttokens per scan (+6,5%, ± 70 per aangevulde
  // publicatie), 700 tekens +3.400 (+16%) — en beide maken alle 20 aangevulde
  // publicaties relevant. Meer tekst voegt dus niets toe.
  FULLTEXT_SNIPPET_CHARS: 150, // per kant van een treffer
  FULLTEXT_MAX_CHARS: 300, // alle fragmenten samen

  // Bewaartermijn
  SCANS_TO_KEEP_PER_PROFILE: 5,

  /**
   * Periodieke scan. Eén alarm tikt elk kwartier en kijkt wélke profielen aan
   * de beurt zijn; per profiel een eigen alarm zetten zou bij veel profielen
   * onnodig veel wekkers opleveren voor werk dat toch serieel gebeurt.
   *
   * "Aan de beurt" wordt afgeleid uit de datum van de laatste scan, niet uit
   * een apart bijgehouden tijdstip. Een handmatige scan schuift de klok dus
   * mee — je hebt net gescand, dan hoeft het niet meteen nog eens.
   */
  AUTO_SCAN_TICK_MINUTES: 15,
  AUTO_SCAN_MIN_INTERVAL_MINUTES: 60,
  AUTO_SCAN_DEFAULT_INTERVAL_MINUTES: 1_440, // één keer per dag

  // Export/import
  EXPORT_FORMAT: 'signaleringen-export',
  EXPORT_FORMAT_VERSION: 1,
};

/**
 * Standaardinstellingen.
 *
 * `direct` is de standaardroute: iedere gebruiker voert een eigen API-key in
 * (B-D09). Zonder vault staat die onversleuteld in `chrome.storage.local`;
 * aanvaardbaar bij een persoonlijke key met uitgavenlimiet, niet bij een
 * gedeelde. De vault (B-49) versleutelt hem met een wachtwoordzin.
 *
 * `proxy` stuurt in plaats daarvan naar een eigen endpoint dat de key
 * server-side zet. Nodig zodra één key door meerdere mensen gebruikt wordt.
 */
export const DefaultSettings = {
  transport: 'direct', // 'direct' | 'proxy'
  proxyUrl: '', // bijv. https://hp-mini.tailnet.ts.net/signaleringen
  proxyToken: '', // gedeeld token, géén LLM-provider-key
  directBaseUrl: 'https://openrouter.ai/api/v1',
  directApiKey: '',
  /**
   * Model en routing staan los in de instellingen, zodat het venster ook
   * zonder de preset van de workspace werkt (productiefase). Vooringevuld met
   * wat `@preset/signaleringen` vastlegt: DeepSeek V4 Flash 0731 bij
   * DeepInfra. Een preset blijft mogelijk; dan geldt de routing hieronder niet.
   */
  model: 'deepseek/deepseek-v4-flash-0731',

  /**
   * Provider-routing (B-61, B-D13): OpenRouter-providers in volgorde van
   * voorkeur, komma-gescheiden, elk eventueel met kwantisatie als
   * `provider/kwantisatie` — dezelfde tags als op de endpoints-pagina van
   * OpenRouter (`deepinfra/fp8`, `decart/fp4`). Gaat ongewijzigd naar
   * `provider.order`, altijd met `allow_fallbacks: false`. Leeg: OpenRouter
   * kiest.
   *
   * `deepinfra` zonder kwantisatie, zoals de preset: DeepInfra serveert V4
   * Flash 0731 als fp8, en `deepinfra/fp4` geeft nul endpoints (B-D06).
   * Vastzetten op fp8 zou een verzoek laten mislukken zodra DeepInfra van
   * kwantisatie wisselt.
   */
  providerRouting: 'deepinfra',

  /**
   * Uitwijkroute (B-D11): als de primaire route na alle pogingen tijdelijk
   * blijft weigeren (429/5xx). Zichtbaar en uit te zetten bij Instellingen,
   * dus geen stille modelwissel.
   */
  fallbackEnabled: true,
  fallbackModel: 'deepseek/deepseek-v4.1-flash',
  fallbackProviderRouting: 'decart/fp4',

  theme: 'system', // 'system' | 'light' | 'dark'

  /**
   * Hoofdschakelaar voor automatisch synthetiseren. Staat uit bij een verse
   * installatie: de permissie `alarms` is optioneel en wordt pas gevraagd als
   * je dit aanzet. Het interval staat per profiel, niet hier.
   */
  autoScanEnabled: false,

  /**
   * Voorfilter met Jev vóór de relevantiestap (B-58). Globaal, niet per
   * profiel. Alleen in de route `direct`: de proxy kent alleen
   * `chat/completions`. Aan betekent ook TypeSafe als extra verwerker.
   */
  jevPrefilterEnabled: false,

  /**
   * Verbinding voor de voorfilter, los van die van het taalmodel: een
   * beslismodel via een decisions-endpoint (OpenRouter `/api/alpha/decisions`).
   * Lege key: dezelfde key als het taalmodel (`directApiKey`). Met een eigen
   * key werkt de voorfilter ook in de proxy-route.
   *
   * Het model staat op een vaste versie, niet op `~typesafe/jev-latest`: de
   * drempel (`JEV_PREFILTER_THRESHOLD`) is op Jev 1.13 gemeten, en een nieuwe
   * versie mag die niet ongemerkt verschuiven. Verdwijnt de versie, dan geeft
   * de voorfilter een fout en gaat alles naar het taalmodel.
   */
  prefilterEndpoint: 'https://openrouter.ai/api/alpha/decisions',
  prefilterApiKey: '',
  prefilterModel: 'typesafe/jev-1.13-20260917',
  prefilterProviderRouting: 'typesafe',
};
