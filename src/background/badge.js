/**
 * Badge op het extensiepictogram: het aantal profielen met een ongelezen
 * signalering van de automatische synthese (B-54). Vervangt een melding
 * zonder dat daar de `notifications`-permissie voor nodig is.
 *
 * Zit de wachtwoordkluis op slot terwijl de key nodig is, dan staat er een
 * slotje: zonder ontgrendelen scant de extensie niet, ook niet automatisch.
 *
 * De badge zelf overleeft geen herstart van de browser; de ongelezen-status
 * wel (storage.local). Daarom zet de worker hem bij elke start opnieuw.
 */

import { AppConfig } from '../core/config.js';
import { log } from '../core/logger.js';
import { getProfile } from '../data/profile-repository.js';
import { getSynthesis } from '../data/scan-repository.js';
import { getUnread, forget } from '../data/unread-repository.js';
import { getSettings } from '../data/settings-repository.js';
import { isKeyLocked } from '../data/vault-repository.js';

export function badgeText(count) {
  if (count <= 0) return '';
  return count > 99 ? '99+' : String(count);
}

export const LOCKED_BADGE_TEXT = '🔒';

export function badgeTitle(count, locked = false) {
  if (locked) {
    const unread = count > 0 ? ` — ${count} profiel${count === 1 ? '' : 'en'} met een nieuwe signalering` : '';
    return `Signaleringen — wachtwoordkluis vergrendeld, ontgrendel om te scannen${unread}`;
  }
  if (count <= 0) return 'Signaleringen';
  return `Signaleringen — ${count} profiel${count === 1 ? '' : 'en'} met een nieuwe signalering`;
}

/**
 * Profiel-id's met een ongelezen signalering. Ruimt onderweg vermeldingen op
 * waarvan het profiel of de synthese niet meer bestaat (verwijderd, vervangen
 * bij een import, of opgeruimd als oude scan).
 */
export async function getUnreadProfileIds() {
  const unread = await getUnread();
  const valid = [];
  const stale = [];

  for (const [profileId, entry] of Object.entries(unread)) {
    const [profile, synthesis] = await Promise.all([getProfile(profileId), getSynthesis(entry.scanId)]);
    if (profile && synthesis?.text) valid.push(profileId);
    else stale.push(profileId);
  }

  await forget(stale);
  return valid;
}

export async function updateBadge() {
  try {
    const count = (await getUnreadProfileIds()).length;
    const locked = await isKeyLocked(await getSettings());
    await chrome.action.setBadgeText({ text: locked ? LOCKED_BADGE_TEXT : badgeText(count) });
    await chrome.action.setTitle({ title: badgeTitle(count, locked) });
    if (locked || count > 0) {
      await chrome.action.setBadgeBackgroundColor({ color: AppConfig.BADGE_COLOR });
      await chrome.action.setBadgeTextColor?.({ color: '#ffffff' });
    }
  } catch (err) {
    log.warn('Badge bijwerken mislukt', err);
  }
}
