/**
 * Andere aanbieders dan OpenRouter (B-79): welk soort endpoint bij welke
 * Base-URL hoort, en hoe het verzoek en het antwoord er per soort uitzien.
 * Draaien met:
 *   node --test test/
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const { ApiKind, apiKind, apiKindOfUrl } = await import('../src/core/api-kind.js');
const { buildRequestBody, parseAnthropicResponse, routesFor } = await import('../src/network/llm-transport.js');
const { AppConfig, DefaultSettings, SuggestedConnection } = await import('../src/core/config.js');
// Sinds 0.25.6 zijn Base-URL, model en routing standaard leeg; de tests gaan uit
// van een ingestelde verbinding met OpenRouter.
const Connected = { ...DefaultSettings, ...SuggestedConnection, directApiKeyHost: 'openrouter.ai' };
const { validateRouting } = await import('../src/core/routing.js');
const { testConnection } = await import('../src/network/llm-transport.js');

const request = { system: 'S', user: 'U', maxTokens: 100, temperature: 0.2 };
const route = { model: 'm', provider: { order: ['deepinfra'], allow_fallbacks: false } };

test('apiKind: afgeleid uit de Base-URL; de proxy telt als OpenRouter', () => {
  assert.equal(apiKindOfUrl('https://openrouter.ai/api/v1'), ApiKind.OPENROUTER);
  assert.equal(apiKindOfUrl('https://api.anthropic.com/v1'), ApiKind.ANTHROPIC);
  assert.equal(apiKindOfUrl('https://api.openai.com/v1/'), ApiKind.OPENAI);
  assert.equal(apiKindOfUrl('http://localhost:11434/v1'), ApiKind.LOCAL);
  assert.equal(apiKindOfUrl('https://llm.example.org/v1'), ApiKind.OTHER);
  assert.equal(apiKindOfUrl('geen adres'), ApiKind.OTHER);
  assert.equal(apiKind({ transport: 'proxy', directBaseUrl: 'https://api.openai.com/v1' }), ApiKind.OPENROUTER);
  assert.equal(apiKind(Connected), ApiKind.OPENROUTER, 'standaard: OpenRouter');
});

test('OpenRouter: provider-blok, reasoning, temperature en max_tokens zoals altijd', () => {
  const body = buildRequestBody(ApiKind.OPENROUTER, route, request);
  assert.deepEqual(body.messages, [
    { role: 'system', content: 'S' },
    { role: 'user', content: 'U' },
  ]);
  assert.equal(body.max_tokens, 100);
  assert.equal(body.temperature, 0.2);
  assert.deepEqual(body.provider, route.provider);
  assert.deepEqual(body.reasoning, { effort: AppConfig.LLM_REASONING_EFFORT });
});

test('Claude API: Messages-vorm, geen temperature, ruimte voor denken', () => {
  const body = buildRequestBody(ApiKind.ANTHROPIC, route, request);
  assert.equal(body.system, 'S');
  assert.deepEqual(body.messages, [{ role: 'user', content: 'U' }]);
  assert.equal(body.max_tokens, 100 + AppConfig.LLM_THINKING_HEADROOM_TOKENS);
  assert.deepEqual(body.output_config, { effort: AppConfig.ANTHROPIC_EFFORT });
  for (const field of ['temperature', 'provider', 'reasoning', 'max_completion_tokens']) {
    assert.equal(field in body, false, field);
  }
});

test('OpenAI: max_completion_tokens, geen temperature en geen OpenRouter-velden', () => {
  const body = buildRequestBody(ApiKind.OPENAI, route, request);
  assert.equal(body.max_completion_tokens, 100 + AppConfig.LLM_THINKING_HEADROOM_TOKENS);
  for (const field of ['temperature', 'max_tokens', 'provider', 'reasoning']) {
    assert.equal(field in body, false, field);
  }
});

test('lokaal en ander endpoint: alleen de gemeenschappelijke velden', () => {
  for (const kind of [ApiKind.LOCAL, ApiKind.OTHER]) {
    const body = buildRequestBody(kind, route, request);
    assert.equal(body.max_tokens, 100);
    assert.equal(body.temperature, 0.2);
    assert.equal('provider' in body, false, kind);
    assert.equal('reasoning' in body, false, kind);
  }
});

test('routesFor: buiten OpenRouter geen provider-blok en geen uitwijk', () => {
  const settings = {
    ...Connected,
    directBaseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-haiku-5-5',
    fallbackEnabled: true,
    fallbackModel: 'deepseek/deepseek-v4.1-flash',
  };
  assert.deepEqual(routesFor(settings), [{ model: 'claude-haiku-5-5', provider: null }]);
});

test('parseAnthropicResponse: tekstblokken, denkblokken overslaan, weigering en afkappen melden', () => {
  const ok = parseAnthropicResponse(
    {
      model: 'claude-haiku-5-5',
      stop_reason: 'end_turn',
      content: [
        { type: 'thinking', thinking: '' },
        { type: 'text', text: '{"a":' },
        { type: 'text', text: '1}' },
      ],
    },
    route,
  );
  assert.deepEqual(ok, { content: '{"a":1}', provider: null, model: 'claude-haiku-5-5' });
  assert.throws(() => parseAnthropicResponse({ stop_reason: 'refusal', content: [] }, route), /weigerde/);
  assert.throws(
    () => parseAnthropicResponse({ stop_reason: 'max_tokens', content: [{ type: 'thinking' }], usage: { output_tokens: 9 } }, route),
    /afgekapt.*9 tokens/,
  );
  assert.throws(() => parseAnthropicResponse({ type: 'error', error: { message: 'kapot' } }, route), /kapot/);
});

test('testConnection naar de Claude API: /messages met x-api-key en versieheader', async () => {
  const { testConnection } = await import('../src/network/llm-transport.js');
  const real = globalThis.fetch;
  let seen;
  globalThis.fetch = async (url, init) => {
    seen = { url, headers: init.headers, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({ model: 'claude-haiku-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const result = await testConnection({
      ...Connected,
      directBaseUrl: 'https://api.anthropic.com/v1/',
      directApiKey: 'sk-ant-test',
      directApiKeyHost: 'api.anthropic.com',
      model: 'claude-haiku-5-5',
    });
    assert.equal(result.reply, 'ok');
  } finally {
    globalThis.fetch = real;
  }
  assert.equal(seen.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(seen.headers['x-api-key'], 'sk-ant-test');
  assert.equal(seen.headers.Authorization, undefined, 'geen Bearer naar Anthropic');
  assert.equal(seen.headers['anthropic-version'], AppConfig.ANTHROPIC_API_VERSION);
  assert.equal(seen.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.equal(seen.body.model, 'claude-haiku-5-5');
});

test('validateRouting: routing en uitwijk alleen controleren bij OpenRouter (CR-28)', () => {
  // Uitwijk aangezet bij OpenRouter, toen een andere aanbieder gekozen: de
  // velden zijn verborgen en worden niet gebruikt, dus Opslaan mag niet blokkeren.
  const stale = { ...Connected, fallbackEnabled: true, fallbackModel: '', providerRouting: 'geen tag!' };
  assert.equal(validateRouting(stale).length, 2, 'bij OpenRouter wel: twee fouten');
  for (const directBaseUrl of ['https://api.anthropic.com/v1', 'https://api.openai.com/v1', 'http://localhost:11434/v1']) {
    assert.deepEqual(validateRouting({ ...stale, directBaseUrl, model: 'model' }), [], directBaseUrl);
  }
  // De proxy telt als OpenRouter: daar blijft de controle.
  assert.equal(validateRouting({ ...stale, transport: 'proxy', proxyUrl: 'https://proxy.example/v1' }).length, 2);
});

test('testConnection: zonder adres of model een duidelijke melding, geen netwerkfout (CR-34)', async () => {
  await assert.rejects(testConnection(DefaultSettings), /Vul eerst een Base-URL en een model in/);
  await assert.rejects(testConnection({ ...DefaultSettings, directBaseUrl: Connected.directBaseUrl }), /Vul eerst een Base-URL en een model in/);
  await assert.rejects(testConnection({ ...DefaultSettings, transport: 'proxy' }), /Vul eerst het proxy-adres en een model in/);
});

test('validateRouting: zolang er geen adres is, worden de zichtbare routingvelden gecontroleerd (CR-36)', () => {
  assert.deepEqual(validateRouting(DefaultSettings), [], 'leeg is in orde: leesmodus');
  const errors = validateRouting({ ...DefaultSettings, providerRouting: 'geen tag!' });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /geen providertag/);
  // Met een adres van een andere aanbieder verdwijnen de velden en dus de controle.
  assert.deepEqual(validateRouting({ ...DefaultSettings, directBaseUrl: 'https://api.openai.com/v1', model: 'm', providerRouting: 'geen tag!' }), []);
});
