/**
 * Houdt de service worker in leven tijdens een langlopende scan.
 *
 * Een MV3-worker wordt na ~30 seconden inactiviteit afgesloten. Elke aanroep
 * van een extensie-API zet die teller terug, dus een lichte periodieke ping
 * voorkomt dat een scan halverwege wordt afgekapt. De ping stopt zodra het werk
 * klaar is — een permanent wakkere worker is precies wat het platform (en de
 * certificering) niet wil.
 */

let handle = null;
let depth = 0;

const PING_INTERVAL_MS = 20_000;

function start() {
  if (handle !== null) return;
  handle = setInterval(() => {
    // Alleen de aanroep telt (hij houdt de worker wakker); het antwoord en een
    // eventuele fout doen er niet toe.
    chrome.runtime.getPlatformInfo().catch(() => {});
  }, PING_INTERVAL_MS);
}

function stop() {
  if (handle === null) return;
  clearInterval(handle);
  handle = null;
}

/** Voert `work` uit terwijl de worker wakker gehouden wordt. */
export async function withKeepalive(work) {
  depth += 1;
  start();
  try {
    return await work();
  } finally {
    depth -= 1;
    if (depth === 0) stop();
  }
}
