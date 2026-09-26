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
  PUBLICATION_AGE_DAYS: 7,
  get PUBLICATION_AGE_MILLIS() {
    return this.PUBLICATION_AGE_DAYS * 24 * 60 * 60 * 1000;
  },

  // Retry met exponential backoff
  MAX_RETRIES: 3,
  RETRY_INITIAL_DELAY_MS: 1_000,
  RETRY_BACKOFF_FACTOR: 2,

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

  // Batching — voorkomt afgekapte responses bij grote feeds (zie B-20)
  LLM_BATCH_SIZE: 40,

  /**
   * Plafond per open.overheid-bron per scan. Een brede zoekopdracht (een heel
   * ministerie) levert zo'n 40 publicaties per week; na lang niet scannen kan
   * het venster er honderden bevatten. Liever de oudste overslaan dan één scan
   * de hele batchverwerking laten opsouperen.
   */
  OPEN_OVERHEID_MAX_RESULTS: 200,

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
  model: '@preset/signaleringen',
  theme: 'system', // 'system' | 'light' | 'dark'

  /**
   * Hoofdschakelaar voor automatisch synthetiseren. Staat uit bij een verse
   * installatie: de permissie `alarms` is optioneel en wordt pas gevraagd als
   * je dit aanzet. Het interval staat per profiel, niet hier.
   */
  autoScanEnabled: false,
};
