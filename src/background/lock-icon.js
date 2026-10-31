/**
 * Slotje op het extensiepictogram zolang de wachtwoordkluis vergrendeld is
 * (B-83). Getekend op het eigen icoon, met transparante achtergrond: een emoji
 * als badgetekst kreeg in Edge het gekleurde vlak van de badge erachter (UI-
 * test ronde 7). De badge blijft zo vrij voor de teller van ongelezen
 * signaleringen.
 *
 * Tekenen kan alleen met `OffscreenCanvas` (worker in Chromium en Firefox);
 * in Node ontbreekt die, dan gooit `lockedIconData` en logt de aanroeper.
 */

import { AppConfig } from '../core/config.js';

const SIZES = [16, 32];

let lockedIcons = null;

/** De gewone iconen uit het manifest, per maat. */
function defaultIconPaths() {
  const icons = chrome.runtime.getManifest().icons ?? {};
  return Object.fromEntries(SIZES.filter((size) => icons[size]).map((size) => [size, `/${icons[size]}`]));
}

/**
 * Tekent een hangslot rechtsonder, in een raster van 16 × 16 dat met het
 * icoon meeschaalt; de coördinaten gaan uit van de hoek rechtsonder, zodat
 * `LOCK_ICON_SCALE` het slot vanuit die hoek groter maakt. Zonder rand: het
 * icoon blijft eromheen zichtbaar. Beugel, blok en een donker sleutelgat.
 */
export function drawPadlock(ctx, size, scale = AppConfig.LOCK_ICON_SCALE) {
  ctx.save();
  ctx.scale(size / 16, size / 16);
  ctx.translate(16, 16);
  ctx.scale(scale, scale);

  // Basisontwerp (schaal 1): blok van 6,5 × 5, ± 7 van 16 pixels breed, zo
  // groot als het emoji-slotje van eerst; de beugel steekt er ruim boven uit.
  ctx.strokeStyle = AppConfig.LOCK_ICON_COLOR;
  ctx.fillStyle = AppConfig.LOCK_ICON_COLOR;
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(-5.8, -4.8);
  ctx.lineTo(-5.8, -7);
  ctx.arc(-4.25, -7, 1.55, Math.PI, 0);
  ctx.lineTo(-2.7, -4.8);
  ctx.stroke();

  ctx.beginPath();
  ctx.roundRect(-7.5, -5.5, 6.5, 5, 0.9);
  ctx.fill();

  ctx.fillStyle = AppConfig.LOCK_ICON_KEYHOLE_COLOR;
  ctx.beginPath();
  ctx.arc(-4.25, -3.6, 0.85, 0, 2 * Math.PI);
  ctx.moveTo(-4.7, -3.6);
  ctx.lineTo(-3.8, -3.6);
  ctx.lineTo(-3.65, -1.5);
  ctx.lineTo(-4.85, -1.5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

async function drawSize(size, path) {
  const response = await fetch(chrome.runtime.getURL(path));
  const bitmap = await createImageBitmap(await response.blob());
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, size, size);
  drawPadlock(ctx, size);
  return ctx.getImageData(0, 0, size, size);
}

/** Het icoon met slotje, per maat; één keer getekend per start van de worker. */
export async function lockedIconData() {
  lockedIcons ??= Promise.all(
    Object.entries(defaultIconPaths()).map(async ([size, path]) => [size, await drawSize(Number(size), path)]),
  )
    .then(Object.fromEntries)
    .catch((err) => {
      lockedIcons = null;
      throw err;
    });
  return lockedIcons;
}

/** Zet het icoon met of zonder slotje. */
export async function setLockIcon(locked) {
  if (locked) await chrome.action.setIcon({ imageData: await lockedIconData() });
  else await chrome.action.setIcon({ path: defaultIconPaths() });
}
