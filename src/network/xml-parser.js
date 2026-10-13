/**
 * Compacte XML-pull-parser.
 *
 * Waarom niet `DOMParser`: die bestaat niet in een MV3 service worker, en het
 * alternatief — een offscreen-document met reason `DOM_PARSER` — kost een extra
 * permissie die bij certificering apart verantwoord moet worden. Deze parser is
 * een directe port van de `XmlPullParser`-lus uit `FeedFetcher.kt` en dekt wat
 * RSS 2.0 en Atom nodig hebben: elementen, attributen, tekst, CDATA en entities.
 *
 * Bewust níét ondersteund: DTD's, externe entities en namespace-resolutie.
 * Externe entities overslaan is hier een feature — het sluit XXE-achtige
 * constructies in een feed van een derde partij uit.
 */

const NAMED_ENTITIES = {
  // Zonder prototype: `&constructor;` uit een feed mag geen functie opleveren.
  __proto__: null,
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  // HTML-entities die in beschrijvingen van feeds voorkomen (B-66): vaak
  // dubbel gecodeerd (`&amp;rsquo;`), dus pas zichtbaar na het strippen van HTML.
  lsquo: '‘', rsquo: '’', sbquo: '‚', ldquo: '“', rdquo: '”', bdquo: '„',
  laquo: '«', raquo: '»', ndash: '–', mdash: '—', hellip: '…', bull: '•',
  middot: '·', euro: '€', copy: '©', reg: '®', trade: '™', deg: '°', shy: '',
  eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë', aacute: 'á', agrave: 'à',
  acirc: 'â', auml: 'ä', iacute: 'í', igrave: 'ì', icirc: 'î', iuml: 'ï',
  oacute: 'ó', ograve: 'ò', ocirc: 'ô', ouml: 'ö', uacute: 'ú', ugrave: 'ù',
  ucirc: 'û', uuml: 'ü', ccedil: 'ç', ntilde: 'ñ', szlig: 'ß', oslash: 'ø',
  aring: 'å', aelig: 'æ',
  Eacute: 'É', Euml: 'Ë', Ouml: 'Ö', Uuml: 'Ü', Auml: 'Ä', Iuml: 'Ï',
};

/** Vervangt XML- en de meest voorkomende HTML-entities door hun teken. */
export function decodeEntities(text) {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, entity) => {
    if (entity[0] === '#') {
      const codePoint =
        entity[1] === 'x' || entity[1] === 'X'
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return match;
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return match;
      }
    }
    // Eerst hoofdlettergevoelig (`&Eacute;` ≠ `&eacute;`), dan ongevoelig.
    const named = NAMED_ENTITIES[entity] ?? NAMED_ENTITIES[entity.toLowerCase()];
    return named ?? match;
  });
}

function parseAttributes(raw) {
  // Zonder prototype: attribuutnamen komen uit de feed (ook `__proto__`).
  const attrs = { __proto__: null };
  const pattern = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match;
  while ((match = pattern.exec(raw)) !== null) {
    const value = match[3] ?? match[4] ?? '';
    attrs[match[1].toLowerCase()] = decodeEntities(value);
  }
  return attrs;
}

/** Naam zonder namespace-prefix: `dc:date` → `date`. */
function localName(name) {
  const colon = name.indexOf(':');
  return colon === -1 ? name : name.slice(colon + 1);
}

/**
 * Doorloopt het document en roept `handler` aan per gebeurtenis.
 * @param {string} xml
 * @param {{ onStart?: (name: string, attrs: object, rawName: string) => void,
 *           onEnd?: (name: string, rawName: string) => void,
 *           onText?: (text: string) => void }} handler
 */
export function parseXml(xml, handler) {
  const { onStart, onEnd, onText } = handler;
  let i = 0;
  const length = xml.length;

  while (i < length) {
    const lt = xml.indexOf('<', i);

    if (lt === -1) {
      if (onText) emitText(xml.slice(i));
      break;
    }

    if (lt > i && onText) emitText(xml.slice(i, lt));

    // <![CDATA[ ... ]]> — inhoud letterlijk, geen entity-decoding
    if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt + 9);
      const stop = end === -1 ? length : end;
      if (onText) onText(xml.slice(lt + 9, stop));
      i = end === -1 ? length : end + 3;
      continue;
    }

    // <!-- ... --> en <!DOCTYPE ...> worden overgeslagen
    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt + 4);
      i = end === -1 ? length : end + 3;
      continue;
    }
    if (xml.startsWith('<!', lt) || xml.startsWith('<?', lt)) {
      const end = xml.indexOf('>', lt + 2);
      i = end === -1 ? length : end + 1;
      continue;
    }

    const gt = findTagEnd(xml, lt + 1);
    if (gt === -1) break;

    const inner = xml.slice(lt + 1, gt).trim();
    i = gt + 1;

    if (inner.startsWith('/')) {
      const rawName = inner.slice(1).trim();
      if (onEnd) onEnd(localName(rawName), rawName);
      continue;
    }

    const selfClosing = inner.endsWith('/');
    const body = selfClosing ? inner.slice(0, -1).trim() : inner;
    const spaceAt = body.search(/\s/);
    const rawName = spaceAt === -1 ? body : body.slice(0, spaceAt);
    const attrs = spaceAt === -1 ? { __proto__: null } : parseAttributes(body.slice(spaceAt + 1));
    const name = localName(rawName);

    if (onStart) onStart(name, attrs, rawName);
    if (selfClosing && onEnd) onEnd(name, rawName);
  }

  function emitText(chunk) {
    const decoded = decodeEntities(chunk);
    if (decoded.trim()) onText(decoded);
  }
}

/** Zoekt de sluitende `>` en negeert daarbij `>` binnen attribuutwaarden. */
function findTagEnd(xml, from) {
  let quote = null;
  for (let i = from; i < xml.length; i += 1) {
    const ch = xml[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '>') {
      return i;
    }
  }
  return -1;
}
