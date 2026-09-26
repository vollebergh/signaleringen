/**
 * IndexedDB-wrapper. Tegenhanger van Room (`AppDatabase.kt`) in de Android-app:
 * één plek waar het schema en de migraties staan, daarboven repositories die
 * alleen domeinobjecten teruggeven.
 */

import { log } from '../core/logger.js';

const DB_NAME = 'signaleringen';
const DB_VERSION = 2;

export const Store = Object.freeze({
  PROFILES: 'profiles',
  SCANS: 'scans',
  PUBLICATIONS: 'publications',
  SYNTHESES: 'syntheses',
  /** v2: welke publicaties dit profiel eerder al zag, en of ze in een synthese zaten. */
  SEEN: 'seen',
  /** v2: per bron wanneer die voor het laatst is opgehaald en met welk resultaat. */
  SOURCE_STATE: 'sourceState',
});

let dbPromise = null;

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      log.info(`Database-migratie van v${event.oldVersion} naar v${DB_VERSION}`);

      if (!db.objectStoreNames.contains(Store.PROFILES)) {
        const profiles = db.createObjectStore(Store.PROFILES, { keyPath: 'id' });
        profiles.createIndex('category', 'category', { unique: false });
      }

      if (!db.objectStoreNames.contains(Store.SCANS)) {
        const scans = db.createObjectStore(Store.SCANS, { keyPath: 'id' });
        scans.createIndex('profileId', 'profileId', { unique: false });
        scans.createIndex('scanDate', 'scanDate', { unique: false });
      }

      if (!db.objectStoreNames.contains(Store.PUBLICATIONS)) {
        const publications = db.createObjectStore(Store.PUBLICATIONS, { keyPath: 'id' });
        publications.createIndex('scanId', 'scanId', { unique: false });
        publications.createIndex('isBookmarked', 'isBookmarked', { unique: false });
      }

      if (!db.objectStoreNames.contains(Store.SYNTHESES)) {
        const syntheses = db.createObjectStore(Store.SYNTHESES, { keyPath: 'scanId' });
        syntheses.createIndex('profileId', 'profileId', { unique: false });
      }

      if (!db.objectStoreNames.contains(Store.SEEN)) {
        const seen = db.createObjectStore(Store.SEEN, { keyPath: 'id' });
        seen.createIndex('profileId', 'profileId', { unique: false });
      }

      if (!db.objectStoreNames.contains(Store.SOURCE_STATE)) {
        const sourceState = db.createObjectStore(Store.SOURCE_STATE, { keyPath: 'id' });
        sourceState.createIndex('profileId', 'profileId', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Database geblokkeerd door een andere sessie'));
  });
}

function getDb() {
  if (!dbPromise) {
    dbPromise = openDatabase().catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

/**
 * Voert `work` uit binnen één transactie en resolvet pas als die is
 * doorgevoerd. Zonder dat laatste kan een lezer een schrijfactie missen.
 */
export async function transaction(storeNames, mode, work) {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, mode);
    const stores = Array.isArray(storeNames)
      ? Object.fromEntries(storeNames.map((n) => [n, tx.objectStore(n)]))
      : tx.objectStore(storeNames);

    let outcome;
    try {
      outcome = work(stores);
    } catch (err) {
      tx.abort();
      reject(err);
      return;
    }

    tx.oncomplete = () => resolve(outcome);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transactie afgebroken'));
  });
}

/** Promisificeert een enkel IDBRequest. */
export function req(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Alle records uit een index met een bepaalde waarde. */
export async function getAllByIndex(storeName, indexName, value) {
  const db = await getDb();
  const tx = db.transaction(storeName, 'readonly');
  return req(tx.objectStore(storeName).index(indexName).getAll(value));
}

/** Alle records uit een store. */
export async function getAll(storeName) {
  const db = await getDb();
  const tx = db.transaction(storeName, 'readonly');
  return req(tx.objectStore(storeName).getAll());
}

/** Eén record op primaire sleutel. */
export async function getByKey(storeName, key) {
  const db = await getDb();
  const tx = db.transaction(storeName, 'readonly');
  return req(tx.objectStore(storeName).get(key));
}
