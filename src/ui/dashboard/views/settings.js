/**
 * Instellingen: verbinding, model en thema. Tegenhanger van SettingsScreen.kt.
 *
 * Standaardroute is `direct`: iedere gebruiker voert zijn eigen API-key in.
 * `proxy` blijft beschikbaar voor de situatie waarin één key door meerdere
 * mensen gebruikt wordt — dan hoort de key niet in de browser thuis.
 */

import { Msg, send } from '../../../core/messages.js';
import { el, clear, labelRow } from '../../shared/dom.js';
import { originPattern } from '../../../core/origins.js';
import { QUANTIZATIONS, validateRouting } from '../../../core/routing.js';
import { DefaultSettings } from '../../../core/config.js';
import { normalizeSynthesisMaxArticles } from '../../../core/models.js';
import { ApiKind, KnownProviders, apiKind, apiKindOfUrl } from '../../../core/api-kind.js';

export async function renderSettings() {
  const [settings, vault] = await Promise.all([send(Msg.GET_SETTINGS), send(Msg.VAULT_STATUS)]);
  const root = el('div');
  const status = el('span', { class: 'muted' });

  const draft = { ...settings };

  // ── Transport ─────────────────────────────────────────────────────────────
  const transportSelect = el('select', {}, [
    el('option', { value: 'direct', text: 'Eigen API-key in deze browser' }),
    el('option', { value: 'proxy', text: 'Via een eigen proxy' }),
  ]);
  transportSelect.value = draft.transport;

  const proxyFields = el('div');
  const directFields = el('div');

  const proxyUrl = input('url', draft.proxyUrl, (v) => {
    draft.proxyUrl = v;
  });
  const proxyToken = input('password', draft.proxyToken, (v) => {
    draft.proxyToken = v;
  });

  proxyFields.append(
    field('Proxy-adres', proxyUrl, 'Bijv. https://hp-mini.tailnet.ts.net/signaleringen — de extensie voegt zelf /chat/completions toe.'),
    field('Proxy-token (optioneel)', proxyToken, 'Gedeeld token om de proxy af te schermen. Dit is géén provider-key.'),
  );

  const directBaseUrl = input('url', draft.directBaseUrl, (v) => {
    draft.directBaseUrl = v;
    providerSelect.value = apiKindOfUrl(v);
    syncRouting();
  });

  // Aanbieder (B-79): vult de Base-URL in. Welke velden er meegaan, volgt uit
  // de Base-URL zelf (core/api-kind.js), niet uit deze keuze.
  const providerSelect = el(
    'select',
    {},
    Object.entries(KnownProviders).map(([value, { label }]) => el('option', { value, text: label })),
  );
  providerSelect.value = apiKindOfUrl(draft.directBaseUrl);
  providerSelect.addEventListener('change', () => {
    const kind = providerSelect.value;
    const known = KnownProviders[kind];
    if (known.baseUrl) {
      draft.directBaseUrl = known.baseUrl;
      directBaseUrl.value = known.baseUrl;
    }
    // Een model van de vorige aanbieder werkt bij de nieuwe niet: voorstel of leeg.
    if (kind !== ApiKind.OPENROUTER && String(draft.model ?? '').includes('/')) {
      draft.model = known.model ?? '';
      modelInput.value = draft.model;
    } else if (kind === ApiKind.OPENROUTER && !String(draft.model ?? '').includes('/')) {
      draft.model = DefaultSettings.model;
      modelInput.value = draft.model;
    }
    syncRouting();
  });
  const directApiKey = input('password', draft.directApiKey, (v) => {
    draft.directApiKey = v;
  });

  directFields.append(
    field('Aanbieder', providerSelect, 'Vult de Base-URL in. Een abonnement (Claude, ChatGPT) geeft geen API-toegang: je hebt een API-key nodig uit de ontwikkelaarsconsole van de aanbieder.'),
    field(
      'Base-URL',
      directBaseUrl,
      'Het adres van de API. Standaard https://openrouter.ai/api/v1. Elk OpenAI-compatibel endpoint werkt; voor de Claude API https://api.anthropic.com/v1. Een lokaal model kan ook, bijv. Ollama op http://localhost:11434/v1. Zie Uitleg.',
    ),
    vault.exists
      ? null
      : field('API-key', directApiKey, 'Je persoonlijke API-key van de aanbieder hierboven. Een lokaal model heeft geen key nodig. Versleutel de key hieronder met een wachtwoordzin.'),
    vaultSection(vault, draft),
  );

  // ── Voorfilter (B-58) ─────────────────────────────────────────────────────
  // Eigen verbinding: endpoint, key, model en routing, zodat een gebruiker in
  // productie zijn eigen key en model kiest. Lege key: die van het taalmodel.
  // Via een proxy staat die er niet, dan is een eigen key nodig.
  const prefilterCheckbox = el('input', { type: 'checkbox' });
  prefilterCheckbox.checked = Boolean(draft.jevPrefilterEnabled);
  prefilterCheckbox.style.width = 'auto';
  prefilterCheckbox.addEventListener('change', () => {
    draft.jevPrefilterEnabled = prefilterCheckbox.checked;
    syncPrefilter();
  });
  const prefilterProxyHint = el('div', {
    class: 'hint error',
    text: 'Via een proxy staat er geen key in de browser: vul hieronder een eigen key voor de voorfilter in, anders slaat de extensie de voorfilter over.',
  });

  const prefilterEndpoint = input('url', draft.prefilterEndpoint, (v) => {
    draft.prefilterEndpoint = v;
  });
  prefilterEndpoint.placeholder = 'bijv. https://openrouter.ai/api/alpha/decisions';
  const prefilterApiKey = input('password', draft.prefilterApiKey, (v) => {
    draft.prefilterApiKey = v;
  });
  prefilterApiKey.placeholder = 'leeg: de key van het taalmodel (zelfde host)';
  const prefilterModel = input('text', draft.prefilterModel, (v) => {
    draft.prefilterModel = v;
  });
  prefilterModel.placeholder = 'bijv. ~typesafe/jev-latest';
  const prefilterRouting = input('text', draft.prefilterProviderRouting, (v) => {
    draft.prefilterProviderRouting = v;
  });
  prefilterRouting.placeholder = 'bijv. typesafe';
  const prefilterStatus = el('span', { class: 'muted' });

  const prefilterFields = el('div', {}, [
    prefilterProxyHint,
    field(
      'Endpoint',
      prefilterEndpoint,
      'Een decisions-endpoint voor beslismodellen, bijv. https://openrouter.ai/api/alpha/decisions. Een gewoon chatmodel werkt hier niet.',
    ),
    vault.exists
      ? field('API-key voor de voorfilter', el('div', { class: 'muted', text: 'Staat versleuteld in de vault. Hef de vault op om hem te wijzigen.' }))
      : field('API-key voor de voorfilter (optioneel)', prefilterApiKey, 'Leeg: de key van het taalmodel hierboven, maar alleen als het endpoint op dezelfde host staat als de Base-URL (standaard openrouter.ai). Een ander endpoint krijgt die key niet. Een eigen key is handig voor een aparte uitgavenlimiet, en nodig in de proxy-route of bij een ander endpoint.'),
    field(
      'Model',
      prefilterModel,
      'Het beslismodel, bijv. ~typesafe/jev-latest. Een vaste versie (typesafe/jev-1.13-20260917) is stabieler: de drempel is op versie 1.13 afgesteld.',
    ),
    field('Aanbieder (provider-routing)', prefilterRouting, 'Zelfde vorm als bij het taalmodel, bijv. typesafe. Jev draait alleen bij TypeSafe.'),
    el('div', { class: 'hint', text: 'Alle vier de velden vul je zelf in; zonder endpoint, model en key slaat de extensie de voorfilter over.' }),
    el('div', { class: 'actions' }, [
      el('button', { text: 'Voorfilter testen', onclick: (e) => testPrefilterRoute(e.currentTarget) }),
      prefilterStatus,
    ]),
  ]);

  function syncPrefilter() {
    prefilterFields.style.display = draft.jevPrefilterEnabled ? '' : 'none';
    prefilterProxyHint.style.display = draft.transport === 'direct' ? 'none' : '';
  }
  syncPrefilter();

  async function testPrefilterRoute(button) {
    if (!(await save(button))) return;
    button.disabled = true;
    prefilterStatus.className = 'muted';
    prefilterStatus.textContent = 'Testen…';
    try {
      const { noul, model, provider } = await send(Msg.TEST_PREFILTER);
      prefilterStatus.className = 'badge ok';
      prefilterStatus.textContent = `Voorfilter werkt — ${model}${provider ? ` via ${provider}` : ''}, testvraag beantwoord met ${noul.toFixed(2)}`;
    } catch (err) {
      prefilterStatus.className = 'error';
      prefilterStatus.textContent = err.message;
    } finally {
      button.disabled = false;
    }
  }

  const prefilterField = el('div', { class: 'field' }, [
    labelRow(
      el('label', { class: 'row', style: 'color:var(--text)' }, [
        prefilterCheckbox,
        el('span', { text: 'Voorfilter met een beslismodel vóór de relevantiestap' }),
      ]),
      'Snellere filtering bij profielen met veel bronnen: een beslismodel (standaard Jev van TypeSafe) zeeft de te beoordelen publicaties eerst ruim, en alleen wat overblijft beoordeelt het taalmodel. Bij vervolgscans met weinig nieuwe publicaties scheelt het weinig. Lukt de voorfilter niet, dan gaat alles gewoon naar het taalmodel.',
    ),
    // De privacywaarschuwing blijft zichtbaar: die hoort niet achter een hover.
    el('div', {
      class: 'hint',
      text: 'Let op: met dit vinkje aan gaan titels en tekstfragmenten van publicaties, en de gebruikersvraag van het profiel, ook naar de aanbieder van dat model (bij Jev: TypeSafe, via OpenRouter).',
    }),
    prefilterFields,
  ]);

  const syncTransport = () => {
    proxyFields.style.display = draft.transport === 'proxy' ? '' : 'none';
    directFields.style.display = draft.transport === 'direct' ? '' : 'none';
    syncPrefilter();
  };
  transportSelect.addEventListener('change', () => {
    draft.transport = transportSelect.value;
    syncTransport();
  });
  syncTransport();

  // ── Model ─────────────────────────────────────────────────────────────────
  const modelInput = input('text', draft.model, (v) => {
    draft.model = v;
    syncRouting();
  });

  // ── Routing en uitwijkroute (B-61, B-D13) ─────────────────────────────────
  // Eén veld per route: providers in volgorde, elk eventueel met kwantisatie
  // (`deepinfra/fp8`). Bij een preset geldt het routingveld niet: de preset
  // draagt zijn eigen routing.
  const providerRouting = input('text', draft.providerRouting, (v) => {
    draft.providerRouting = v;
  });
  providerRouting.placeholder = 'bijv. deepinfra/fp8';
  const presetRoutingHint = el('div', {
    class: 'hint',
    text: 'Je gebruikt een preset: die bepaalt zelf de provider, dit veld geldt dan niet.',
  });

  const fallbackCheckbox = el('input', { type: 'checkbox' });
  fallbackCheckbox.checked = Boolean(draft.fallbackEnabled);
  fallbackCheckbox.style.width = 'auto';
  const fallbackModel = input('text', draft.fallbackModel, (v) => {
    draft.fallbackModel = v;
  });
  fallbackModel.placeholder = 'bijv. deepseek/deepseek-v4.1-flash';
  const fallbackProviderRouting = input('text', draft.fallbackProviderRouting, (v) => {
    draft.fallbackProviderRouting = v;
  });
  fallbackProviderRouting.placeholder = 'bijv. decart/fp4';
  const fallbackFields = el('div', {}, [
    field('Model voor de uitwijk', fallbackModel),
    field('Provider-routing voor de uitwijk', fallbackProviderRouting, 'Zelfde vorm als hierboven.'),
  ]);
  fallbackCheckbox.addEventListener('change', () => {
    draft.fallbackEnabled = fallbackCheckbox.checked;
    syncRouting();
  });

  const notOpenRouterHint = el('div', {
    class: 'hint',
    text: 'Provider-routing en de uitwijkroute werken alleen met OpenRouter. Bij deze aanbieder gaat elk verzoek rechtstreeks naar het model hierboven.',
  });
  const openRouterOnly = el('div');

  function syncRouting() {
    const preset = String(draft.model ?? '').includes('@preset/');
    providerRouting.disabled = preset;
    presetRoutingHint.style.display = preset ? '' : 'none';
    fallbackFields.style.display = draft.fallbackEnabled ? '' : 'none';
    const openRouter = apiKind(draft) === ApiKind.OPENROUTER;
    openRouterOnly.style.display = openRouter ? '' : 'none';
    notOpenRouterHint.style.display = openRouter ? 'none' : '';
  }
  const routingSection = el('div', {}, [notOpenRouterHint, openRouterOnly]);
  openRouterOnly.append(
    field(
      'Provider-routing',
      providerRouting,
      `Waar het model draait: provider of provider/kwantisatie, zoals op de endpoints-pagina van het model bij OpenRouter — bijv. deepinfra/fp8 of decart/fp4. Meerdere in volgorde van voorkeur, komma-gescheiden. OpenRouter wijkt nooit uit naar een provider die hier niet staat. Zonder kwantisatie: wat die provider serveert. Leeg: OpenRouter kiest zelf. Kwantisaties: ${QUANTIZATIONS.join(', ')}. Een combinatie die niet bestaat, geeft bij elke aanroep een fout — test na het invullen.`,
    ),
    presetRoutingHint,
    el('div', { class: 'field' }, [
      labelRow(
        el('label', { class: 'row', style: 'color:var(--text)' }, [
          fallbackCheckbox,
          el('span', { text: 'Uitwijkroute gebruiken' }),
        ]),
        'Blijft de route hierboven na drie pogingen bezet (429) of storen (5xx), dan probeert de extensie deze route, ook drie keer. Een scan mislukt pas als ook die weigert.',
      ),
    ]),
    fallbackFields,
  );
  syncRouting();

  // ── Automatisch synthetiseren ─────────────────────────────────────────────
  // Hoofdschakelaar. Het interval staat per profiel — verschillende onderwerpen
  // hebben verschillende tempo's, en één globaal interval zou dat platslaan.
  const autoCheckbox = el('input', { type: 'checkbox' });
  autoCheckbox.checked = Boolean(draft.autoScanEnabled);
  autoCheckbox.style.width = 'auto';

  const autoStatus = el('div', { class: 'hint' });

  const refreshAutoStatus = async () => {
    if (!autoCheckbox.checked) {
      autoStatus.className = 'hint';
      autoStatus.textContent =
        'Uit: er wordt alleen gescand wanneer je op Scan klikt bij een profiel.';
      return;
    }
    const granted = await chrome.permissions.contains({ permissions: ['alarms'] });
    autoStatus.className = granted ? 'hint' : 'hint error';
    autoStatus.textContent = granted
      ? 'Aan: profielen waarbij je dit hebt ingeschakeld worden op hun eigen interval gescand en gesynthetiseerd.'
      : 'De permissie voor achtergrondtaken is nog niet verleend — sla op om die te vragen.';
  };

  autoCheckbox.addEventListener('change', async () => {
    // Toestemming vragen vanuit deze klik; een `await` ervoor zou het
    // gebruikersgebaar verspelen dat de browser voor de prompt eist.
    if (autoCheckbox.checked) {
      let granted;
      try {
        granted = await chrome.permissions.request({ permissions: ['alarms'] });
      } catch {
        granted = null; // Firefox kent `alarms` niet als optionele permissie (B-65)
      }
      if (!granted) {
        autoCheckbox.checked = false;
        draft.autoScanEnabled = false;
        autoStatus.className = 'hint error';
        autoStatus.textContent =
          granted === null
            ? 'Deze browser kan de permissie voor achtergrondtaken niet los toekennen; automatisch scannen is hier niet beschikbaar.'
            : 'Zonder de permissie voor achtergrondtaken kan de extensie niet zelf scannen.';
        return;
      }
    }
    draft.autoScanEnabled = autoCheckbox.checked;
    refreshAutoStatus();
  });

  const autoField = el('div', { class: 'field' }, [
    labelRow(
      el('label', { class: 'row', style: 'color:var(--text)' }, [
        autoCheckbox,
        el('span', { text: 'Profielen automatisch scannen en synthetiseren' }),
      ]),
      'Dit vraagt de optionele permissie voor achtergrondtaken. Zolang deze schakelaar uit staat, gebruikt de extensie die permissie niet en scant ze nooit uit zichzelf. Aan: de extensie controleert elk kwartier welk profiel aan de beurt is; het interval stel je per profiel in bij Bewerken.',
    ),
    autoStatus,
  ]);
  refreshAutoStatus();

  // ── Synthese (B-45) ───────────────────────────────────────────────────────
  draft.synthesisMaxArticles = normalizeSynthesisMaxArticles(draft.synthesisMaxArticles);
  const synthesisMaxInput = el('input', {
    type: 'number',
    min: '1',
    step: '1',
    value: String(draft.synthesisMaxArticles),
    style: 'width:6em',
  });
  synthesisMaxInput.addEventListener('input', () => {
    draft.synthesisMaxArticles = normalizeSynthesisMaxArticles(synthesisMaxInput.value);
  });
  synthesisMaxInput.addEventListener('change', () => {
    synthesisMaxInput.value = String(draft.synthesisMaxArticles);
  });
  const synthesisMaxField = el('div', { class: 'field' }, [
    labelRow(
      el('label', { text: 'Maximaal aantal artikelen in een signalering' }),
      `Zijn er bij een scan meer relevante publicaties, dan krijgt de signalering de hoogst scorende mee (standaard ${DefaultSettings.synthesisMaxArticles}, geen bovengrens). De overige blijven als relevant in het scanresultaat staan. Minder artikelen geeft een kortere signalering en een kleinere prompt; meer artikelen kost meer tokens en kan het contextvenster van het model overschrijden.`,
    ),
    el('div', { class: 'row' }, [synthesisMaxInput, el('span', { text: 'artikelen' })]),
  ]);

  // ── Thema ─────────────────────────────────────────────────────────────────
  const themeSelect = el('select', {}, [
    el('option', { value: 'system', text: 'Systeem' }),
    el('option', { value: 'light', text: 'Licht' }),
    el('option', { value: 'dark', text: 'Donker' }),
  ]);
  themeSelect.value = draft.theme;
  themeSelect.addEventListener('change', () => {
    draft.theme = themeSelect.value;
    if (draft.theme === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = draft.theme;
  });

  root.append(
    el('h2', { text: 'Instellingen' }),

    el('h3', { class: 'section-title', text: 'Verbinding' }),
    field('Route', transportSelect),
    proxyFields,
    directFields,

    el('h3', { class: 'section-title', text: 'Model' }),
    field(
      'Model',
      modelInput,
      'De naam van het model bij je aanbieder. Bij OpenRouter bijv. deepseek/deepseek-v4-flash-0731 (een preset @preset/… kan ook), bij de Claude API bijv. claude-haiku-5-5, bij OpenAI de modelnaam uit je account. Kies bij voorkeur een vaste versie, zodat het model niet ongemerkt verandert.',
    ),

    el('h3', { class: 'section-title', text: 'Routing' }),
    routingSection,

    el('h3', { class: 'section-title', text: 'Voorfilter' }),
    prefilterField,

    el('h3', { class: 'section-title', text: 'Signalering' }),
    synthesisMaxField,

    el('h3', { class: 'section-title', text: 'Weergave' }),
    field('Thema', themeSelect),

    el('h3', { class: 'section-title', text: 'Automatisch synthetiseren' }),
    autoField,

    el('div', { class: 'sticky-save' }, [
      el('button', { class: 'primary', text: 'Opslaan', onclick: (e) => save(e.currentTarget) }),
      el('button', { text: 'Verbinding testen', onclick: (e) => test(e.currentTarget, 'primary') }),
      el('button', { text: 'Uitwijkroute testen', onclick: (e) => test(e.currentTarget, 'fallback') }),
      status,
    ]),
  );

  /** @returns {Promise<boolean>} of er is opgeslagen */
  async function save(button) {
    const routingErrors = validateRouting(draft);
    if (routingErrors.length > 0) {
      status.className = 'error';
      status.textContent = routingErrors.join(' · ');
      return false;
    }
    button.disabled = true;
    status.className = 'muted';
    status.textContent = 'Opslaan…';
    try {
      // De proxy is een host als elke andere: zonder toestemming blokkeert de
      // browser de fetch vanuit de service worker.
      // Zo ook een lokaal model (B-67) en elke andere aanbieder dan OpenRouter
      // (B-79): alleen OpenRouter staat verzoeken uit de browser vanzelf toe.
      const ownHost =
        draft.transport === 'proxy'
          ? draft.proxyUrl.trim()
          : apiKind(draft) !== ApiKind.OPENROUTER ? draft.directBaseUrl.trim() : '';
      if (ownHost) {
        const origin = originPattern(ownHost);
        // Meteen vragen: Firefox weigert een toestemmingsvraag na een eerdere
        // `await` in de klik (B-65); al gegeven toestemming vraagt niets.
        if (origin) {
          const granted = await chrome.permissions.request({ origins: [origin] });
          if (!granted) {
            status.className = 'error';
            status.textContent =
              draft.transport === 'proxy'
                ? 'Zonder toestemming voor de proxy-host werkt de verbinding niet.'
                : 'Zonder toestemming voor het adres van de aanbieder werkt de verbinding niet.';
            button.disabled = false;
            return false;
          }
        }
      }

      await send(Msg.SAVE_SETTINGS, { patch: draft });
      status.className = 'muted';
      status.textContent = 'Opgeslagen.';
      return true;
    } catch (err) {
      status.className = 'error';
      status.textContent = err.message;
      return false;
    } finally {
      button.disabled = false;
    }
  }

  /** Test één route met wat er nu in het formulier staat: eerst opslaan. */
  async function test(button, route) {
    if (!(await save(button))) return;
    button.disabled = true;
    status.className = 'muted';
    status.textContent = route === 'fallback' ? 'Uitwijkroute testen…' : 'Testen…';
    try {
      const { reply, provider, model } = await send(Msg.TEST_CONNECTION, { route });
      status.className = 'badge ok';
      status.textContent = `${route === 'fallback' ? 'Uitwijkroute' : 'Verbinding'} werkt — ${model}${provider ? ` via ${provider}` : ''}, antwoord: "${reply}"`;
    } catch (err) {
      status.className = 'error';
      status.textContent = err.message;
    } finally {
      button.disabled = false;
    }
  }

  return root;
}

/**
 * Vault voor de API-key (B-49). Zonder vault staat de key leesbaar in de
 * browseropslag; met vault versleuteld met een wachtwoordzin, en na een
 * herstart van de browser eerst te ontgrendelen.
 */
function vaultSection(vault, draft) {
  const status = el('span', { class: 'muted' });
  const passphrase = el('input', { type: 'password', autocomplete: 'new-password', placeholder: 'Wachtwoordzin' });
  const confirmation = el('input', { type: 'password', autocomplete: 'new-password', placeholder: 'Herhaal wachtwoordzin' });

  const run = async (button, action) => {
    button.disabled = true;
    status.className = 'muted';
    status.textContent = 'Bezig…';
    try {
      await action();
      location.reload();
    } catch (err) {
      status.className = 'error';
      status.textContent = err.message;
      button.disabled = false;
    }
  };

  const children = [];

  if (!vault.exists) {
    children.push(
      el('p', {
        text: 'De key(s) staan nu leesbaar in de browseropslag: wie bij het browserprofiel kan, leest ze, en ze gaan mee in een backup of profielsynchronisatie. Versleutel ze met een wachtwoordzin om dat te voorkomen. Na een herstart van de browser vraagt de extensie de wachtwoordzin opnieuw; automatisch synthetiseren wacht tot dan.',
      }),
      el('div', { class: 'grid' }, [passphrase, confirmation]),
      el('div', { class: 'actions' }, [
        el('button', {
          text: 'Key versleutelen',
          onclick: (e) =>
            run(e.currentTarget, async () => {
              if (passphrase.value !== confirmation.value) throw new Error('De wachtwoordzinnen verschillen');
              // Eerst de key uit het formulier opslaan: de vault versleutelt
              // wat er opgeslagen staat.
              await send(Msg.SAVE_SETTINGS, {
                patch: { directApiKey: draft.directApiKey, prefilterApiKey: draft.prefilterApiKey },
              });
              await send(Msg.VAULT_ENABLE, { passphrase: passphrase.value });
            }),
        }),
        status,
      ]),
    );
  } else if (!vault.unlocked) {
    children.push(
      el('p', { text: 'De key staat versleuteld en is vergrendeld. Ontgrendel met je wachtwoordzin om te kunnen scannen.' }),
      passphrase,
      el('div', { class: 'actions' }, [
        el('button', {
          class: 'primary',
          text: 'Ontgrendelen',
          onclick: (e) => run(e.currentTarget, () => send(Msg.VAULT_UNLOCK, { passphrase: passphrase.value })),
        }),
        status,
      ]),
    );
  } else {
    children.push(
      el('p', { text: 'De key staat versleuteld en is ontgrendeld tot je de browser sluit.' }),
      el('div', { class: 'actions' }, [
        el('button', { text: 'Nu vergrendelen', onclick: (e) => run(e.currentTarget, () => send(Msg.VAULT_LOCK)) }),
        el('button', {
          class: 'danger',
          text: 'Vault opheffen',
          title: 'Zet de key weer leesbaar in de browseropslag',
          onclick: (e) => run(e.currentTarget, () => send(Msg.VAULT_DISABLE)),
        }),
        status,
      ]),
    );
  }

  if (vault.exists && vault.localFileHasKey) {
    children.push(
      el('p', {
        class: 'error',
        text: 'Let op: local-settings.json in de extensiemap bevat nog een leesbare key. Die valt buiten de vault — haal hem daar weg.',
      }),
    );
  }

  return el('div', { class: 'field' }, [
    el('label', { text: 'Versleuteling van de key' }),
    el('div', { class: 'permission-warning' }, children),
  ]);
}

function input(type, value, onChange) {
  const node = el('input', { type, value: value ?? '' });
  node.addEventListener('input', () => onChange(node.value));
  return node;
}

/** Veld met label; de toelichting staat achter een info-knopje. */
function field(label, control, hint) {
  return el('div', { class: 'field' }, [labelRow(el('label', { text: label }), hint), control]);
}

