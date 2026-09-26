/**
 * Profielopslag. Tegenhanger van RoomProfileRepository.kt.
 * Bronnen worden hier als genest array in het profielrecord bewaard in plaats
 * van in een aparte tabel — IndexedDB kent geen joins, en bronnen worden nooit
 * los van hun profiel opgevraagd.
 */

import { Store, getAll, getByKey, transaction } from './db.js';
import { collectProfileData } from './scan-repository.js';
import { deleteHistoryForProfile } from './history-repository.js';
import { createProfile, duplicateProfile as cloneProfile } from '../core/models.js';
import { log } from '../core/logger.js';

export async function loadProfiles() {
  const rows = await getAll(Store.PROFILES);
  return rows.map(createProfile).sort((a, b) => a.name.localeCompare(b.name, 'nl'));
}

export async function getProfile(id) {
  const row = await getByKey(Store.PROFILES, id);
  return row ? createProfile(row) : null;
}

export async function saveProfile(profile) {
  const normalised = createProfile(profile);
  await transaction(Store.PROFILES, 'readwrite', (store) => {
    store.put(normalised);
  });
  log.debug(`Profiel opgeslagen: ${normalised.name}`);
  return normalised;
}

export async function deleteProfile(id) {
  // Ruimt ook de scans, publicaties en syntheses op, zodat er geen wezen
  // achterblijven in IndexedDB — IndexedDB kent geen cascading delete.
  const { scanIds, publicationIds } = await collectProfileData(id);

  await transaction(
    [Store.PROFILES, Store.SCANS, Store.PUBLICATIONS, Store.SYNTHESES],
    'readwrite',
    (stores) => {
      stores[Store.PROFILES].delete(id);
      scanIds.forEach((scanId) => {
        stores[Store.SCANS].delete(scanId);
        stores[Store.SYNTHESES].delete(scanId);
      });
      publicationIds.forEach((pubId) => stores[Store.PUBLICATIONS].delete(pubId));
    },
  );
  await deleteHistoryForProfile(id);
  log.info(`Profiel ${id} verwijderd, inclusief ${scanIds.length} scan(s)`);
}

export async function duplicateProfile(id) {
  const original = await getProfile(id);
  if (!original) throw new Error('Profiel niet gevonden');
  return saveProfile(cloneProfile(original));
}
