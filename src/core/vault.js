/**
 * Versleuteling van de API-key met een wachtwoordzin (B-49). Alleen WebCrypto,
 * geen chrome-API's — daardoor ook in Node te testen.
 *
 * PBKDF2-SHA256 leidt uit de wachtwoordzin een AES-GCM-sleutel van 256 bits
 * af; daarmee wordt de key versleuteld. Opslag regelt vault-repository.js:
 * de versleutelde blob in `chrome.storage.local`, de afgeleide sleutel in
 * `chrome.storage.session` (alleen in het geheugen, weg bij een herstart van
 * de browser).
 *
 * Wat dit wél en niet afdekt staat in de architectuurnotitie §11: het
 * beschermt de key in het profielbestand, backups en synchronisatie, maar niet
 * tegen code die draait terwijl de vault ontgrendeld is.
 */

export const VAULT_VERSION = 1;

/** OWASP-advies voor PBKDF2-HMAC-SHA256 (2023): minstens 600.000 iteraties. */
export const PBKDF2_ITERATIONS = 600_000;

export const MIN_PASSPHRASE_LENGTH = 8;

const toBase64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const fromBase64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

async function deriveRawKey(passphrase, salt, iterations) {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    256,
  );
}

const importAesKey = (raw) =>
  crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);

/**
 * Versleutelt `secret` met `passphrase`.
 * @returns {Promise<{ vault: object, sessionKey: string }>} de op te slaan
 *   blob en de afgeleide sleutel (base64) voor de sessie
 */
export async function createVault(secret, passphrase, iterations = PBKDF2_ITERATIONS) {
  if (!secret?.trim()) throw new Error('Er is geen key om te versleutelen');
  if ((passphrase ?? '').length < MIN_PASSPHRASE_LENGTH) {
    throw new Error(`De wachtwoordzin moet minstens ${MIN_PASSPHRASE_LENGTH} tekens hebben`);
  }

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const raw = await deriveRawKey(passphrase, salt, iterations);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await importAesKey(raw),
    new TextEncoder().encode(secret.trim()),
  );

  return {
    vault: {
      version: VAULT_VERSION,
      kdf: 'PBKDF2-SHA256',
      iterations,
      salt: toBase64(salt),
      iv: toBase64(iv),
      ciphertext: toBase64(ciphertext),
    },
    sessionKey: toBase64(raw),
  };
}

/** Ontsleutelt met de afgeleide sleutel uit de sessie. Gooit bij een verkeerde sleutel. */
export async function decryptVault(vault, sessionKey) {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(vault.iv) },
    await importAesKey(fromBase64(sessionKey)),
    fromBase64(vault.ciphertext),
  );
  return new TextDecoder().decode(plain);
}

/**
 * Leidt de sessiesleutel af uit de wachtwoordzin en controleert die door te
 * ontsleutelen. AES-GCM faalt hard bij een verkeerde sleutel, dus een aparte
 * controlewaarde is niet nodig.
 * @returns {Promise<string>} de sessiesleutel (base64)
 */
export async function unlockVault(vault, passphrase) {
  const raw = await deriveRawKey(passphrase ?? '', fromBase64(vault.salt), vault.iterations);
  const sessionKey = toBase64(raw);
  try {
    await decryptVault(vault, sessionKey);
  } catch {
    throw new Error('Onjuiste wachtwoordzin');
  }
  return sessionKey;
}
