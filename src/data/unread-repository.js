/**
 * Ongelezen signaleringen van de automatische synthese (B-54).
 *
 * Per profiel hooguit één vermelding: de nieuwste synthese die de planner
 * opstelde en die de gebruiker nog niet zag. Staat in `chrome.storage.local`
 * en niet in IndexedDB: het is UI-status, geen inhoud, en hoort dus niet in
 * een export. Een import levert daardoor ook geen stapel "ongelezen" op.
 *
 * Een handmatige scan zet niets op ongelezen — wie zelf op Scan klikt, weet
 * dat er iets aankomt.
 */

const KEY = 'unreadSyntheses';

/** @returns {Promise<Record<string, { scanId: string, createdAt: number }>>} */
export async function getUnread() {
  const stored = await chrome.storage.local.get(KEY);
  return stored[KEY] ?? {};
}

async function setUnread(map) {
  await chrome.storage.local.set({ [KEY]: map });
}

export async function markUnread(profileId, scanId, createdAt) {
  const map = await getUnread();
  map[profileId] = { scanId, createdAt };
  await setUnread(map);
}

/**
 * Markeert de signalering van een profiel als gelezen. Met `seenCreatedAt`
 * alleen als de bekeken synthese minstens zo nieuw is als de ongelezen — een
 * oude scan openen laat een nieuwere ongelezen signalering staan.
 * @returns {Promise<boolean>} of er iets veranderde
 */
export async function markRead(profileId, seenCreatedAt = Infinity) {
  const map = await getUnread();
  const entry = map[profileId];
  if (!entry || seenCreatedAt < entry.createdAt) return false;
  delete map[profileId];
  await setUnread(map);
  return true;
}

/** Verwijdert vermeldingen die niet meer kloppen (profiel of scan weg). */
export async function forget(profileIds) {
  if (profileIds.length === 0) return;
  const map = await getUnread();
  profileIds.forEach((id) => delete map[id]);
  await setUnread(map);
}
