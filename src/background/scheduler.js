/**
 * Periodiek automatisch scannen en synthetiseren.
 *
 * Ontwerp: één alarm dat elk kwartier tikt en dan kijkt wélke profielen aan de
 * beurt zijn. Per profiel een eigen alarm zetten zou bij veel profielen een
 * hoop wekkers opleveren voor werk dat toch serieel gebeurt — en `chrome.alarms`
 * garandeert het exacte tijdstip sowieso niet.
 *
 * "Aan de beurt" wordt afgeleid uit de datum van de laatste scan, niet uit een
 * apart bijgehouden tijdstip. Dat scheelt state en klopt beter: heb je net
 * handmatig gescand, dan hoeft de automaat niet meteen opnieuw.
 *
 * Er is geen melding bij nieuwe resultaten — de extensie vraagt geen
 * `notifications`-permissie. Wat de automaat oplevert zie je bij het openen van
 * de popup, het dashboard of het side panel.
 */

import { AppConfig } from '../core/config.js';
import { log } from '../core/logger.js';
import { getSettings } from '../data/settings-repository.js';
import { loadProfiles } from '../data/profile-repository.js';
import { getLatestScan } from '../data/scan-repository.js';
import { isConfigured, getVaultStatus } from '../data/settings-repository.js';
import { runScan, isScanning } from './scan-runner.js';
import { missingOrigins } from './permissions.js';

export const ALARM_NAME = 'signaleringen-auto-synthese';

/** Heeft de gebruiker de optionele `alarms`-permissie verleend? */
export async function hasAlarmsPermission() {
  try {
    return await chrome.permissions.contains({ permissions: ['alarms'] });
  } catch {
    return false;
  }
}

/**
 * Zet het alarm aan of uit, op basis van de instellingen. Idempotent — veilig
 * om aan te roepen bij elke start van de service worker.
 */
export async function applySchedule() {
  if (!(await hasAlarmsPermission())) {
    log.debug('Automatisch synthetiseren: geen alarms-permissie, planner staat uit');
    return { scheduled: false, reason: 'no-permission' };
  }

  const settings = await getSettings();
  if (!settings.autoScanEnabled) {
    await chrome.alarms.clear(ALARM_NAME);
    log.info('Automatisch synthetiseren staat uit');
    return { scheduled: false, reason: 'disabled' };
  }

  const existing = await chrome.alarms.get(ALARM_NAME);
  if (!existing) {
    await chrome.alarms.create(ALARM_NAME, {
      delayInMinutes: 1,
      periodInMinutes: AppConfig.AUTO_SCAN_TICK_MINUTES,
    });
    log.info(`Automatisch synthetiseren ingepland, tik elke ${AppConfig.AUTO_SCAN_TICK_MINUTES} min`);
  }
  return { scheduled: true };
}

/** Is dit profiel aan de beurt? */
export function isDue(profile, latestScanDate, now = Date.now()) {
  if (!profile.autoScanEnabled) return false;
  if (profile.sources.length === 0) return false;

  const interval = Math.max(
    AppConfig.AUTO_SCAN_MIN_INTERVAL_MINUTES,
    Number(profile.autoScanIntervalMinutes) || AppConfig.AUTO_SCAN_DEFAULT_INTERVAL_MINUTES,
  );

  // Nog nooit gescand? Dan meteen aan de beurt.
  if (!latestScanDate) return true;
  return now - latestScanDate >= interval * 60_000;
}

/**
 * Eén tik van de planner: alle profielen langs, de verschuldigde scannen.
 * Bewust serieel — parallelle scans zouden dezelfde rate limits raken en het
 * werk gebeurt op de achtergrond, dus haast is er niet.
 */
export async function runDueScans() {
  const settings = await getSettings();
  if (!settings.autoScanEnabled) return { ran: 0, skipped: 'disabled' };

  if (!(await isConfigured(settings))) {
    log.warn('Automatische synthese overgeslagen: nog geen API-key of proxy ingesteld');
    return { ran: 0, skipped: 'not-configured' };
  }

  const vault = await getVaultStatus();
  if (vault.exists && !vault.unlocked && settings.transport === 'direct') {
    log.warn('Automatische synthese overgeslagen: de vault is vergrendeld (bijv. na een herstart van de browser)');
    return { ran: 0, skipped: 'locked' };
  }

  const profiles = await loadProfiles();
  const now = Date.now();
  let ran = 0;

  for (const profile of profiles) {
    if (isScanning(profile.id)) continue;

    const latest = await getLatestScan(profile.id);
    if (!isDue(profile, latest?.scanDate ?? null, now)) continue;

    // Zonder host-toestemming faalt elke fetch; dat is een keuze van de
    // gebruiker, geen storing, dus overslaan zonder ophef.
    const blocked = await missingOrigins(profile.sources.map((s) => s.url));
    if (blocked.length > 0) {
      log.debug(`Automatische synthese overgeslagen voor '${profile.name}': host-toestemming ontbreekt`);
      continue;
    }

    try {
      const result = await runScan(profile.id);
      ran += 1;
      log.info(
        `Automatische synthese '${profile.name}': ${result.relevantCount} relevant van ${result.totalFetched}`,
      );
    } catch (err) {
      log.error(`Automatische synthese mislukt voor '${profile.name}'`, err);
    }
  }

  return { ran };
}
