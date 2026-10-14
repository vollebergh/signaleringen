/**
 * Badge op het extensiepictogram: het aantal profielen met een ongelezen
 * signalering van de automatische synthese (B-54). Vervangt een melding
 * zonder dat daar de `notifications`-permissie voor nodig is.
 *
 * De badge zelf overleeft geen herstart van de browser; de ongelezen-status
 * wel (storage.local). Daarom zet de worker hem bij elke start opnieuw.
 */

import { AppConfig } from '../core/config.js';
import { log } from '../core/logger.js';
import { getProfile } from '../data/profile-repository.js';
import { getSynthesis } from '../data/scan-repository.js';
import { getUnread, forget } from '../data/unread-repository.js';

export function badgeText(count) {
  if (count <= 0) return '';
  return count > 99 ? '99+' : String(count);
}

export function badgeTitle(count) {
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
    await chrome.action.setBadgeText({ text: badgeText(count) });
    await chrome.action.setTitle({ title: badgeTitle(count) });
    if (count > 0) {
      await chrome.action.setBadgeBackgroundColor({ color: AppConfig.BADGE_COLOR });
      await chrome.action.setBadgeTextColor?.({ color: '#ffffff' });
    }
  } catch (err) {
    log.warn('Badge bijwerken mislukt', err);
  }
}
