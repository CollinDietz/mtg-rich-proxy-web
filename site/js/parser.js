/** Parse plain-text and Archidekt-style decklists. Pure functions: safe to test in Node. */
const ANNOTATION = /\s*\^[^\n^]*\^\s*$/;
const FINISH = /\s+\*(?:F|E)\*\s*$/i;

export function normalizeName(name) {
  return String(name).trim().replace(/\s*\/\/\s*/g, ' // ').replace(/\s+/g, ' ').toLocaleLowerCase('en');
}

// Treat basic land names as known before looking anything up on Scryfall.
// Wastes and snow-covered basics are basic lands too; cards like Command Tower are not.
const BASIC_LAND_NAMES = new Set([
  'plains', 'island', 'swamp', 'mountain', 'forest', 'wastes',
  'snow-covered plains', 'snow-covered island', 'snow-covered swamp',
  'snow-covered mountain', 'snow-covered forest',
]);

export function isBasicLandName(name) {
  return BASIC_LAND_NAMES.has(normalizeName(name));
}

export function parseDecklist(input, { includeMaybeboard = false, includeBasics = true } = {}) {
  const entries = [];
  const errors = [];
  const ignored = [];
  let section = 'main';

  for (const [index, rawLine] of String(input).split(/\r?\n/).entries()) {
    const lineNo = index + 1;
    let line = rawLine.trim().replace(/^\uFEFF/, '');
    if (!line || /^\s*(?:#|\/\/|;)/.test(line)) continue;
    if (/^(?:\[\s*)?(?:maybeboard|sideboard|considering|maybe)(?:\s*\])?\s*:?$/i.test(line)) { section = 'maybe'; continue; }
    if (/^(?:\[\s*)?(?:mainboard|deck|commander|creatures|instants|sorceries|lands|artifacts|enchantments|planeswalkers)(?:\s*\])?\s*:?$/i.test(line)) { section = 'main'; continue; }
    if (/^\s*\[.*\]\s*$/.test(line)) continue;
    if (/^\s*(?:total|cards?|decks?)\s*:\s*\d+\s*$/i.test(line)) continue;

    // Archidekt allows a trailing color marker outside the category bracket.
    line = line.replace(ANNOTATION, '').trim();
    // Extract only the FINAL category block; card names may themselves contain brackets.
    let categories = [];
    const categoryMatch = line.match(/\s+\[([^\]]*)\]\s*$/);
    if (categoryMatch) {
      categories = categoryMatch[1].split(',').map(s => s.trim()).filter(Boolean);
      line = line.slice(0, categoryMatch.index).trim();
    }
    const primary = categories[0] || '';
    const sideboard = section === 'maybe' || /^\s*(?:maybe(?:\s|board|$)|removed(?:\s|$)|tokens?\s*&\s*extras|sideboard)/i.test(primary)
      || /\{noDeck\}/i.test(primary);
    if (sideboard && !includeMaybeboard) { ignored.push({ line: lineNo, reason: 'Maybeboard / Removed / Extras', quantity: 0 }); continue; }

    line = line.replace(FINISH, '').trim();
    let quantity = 1;
    const quantityMatch = line.match(/^(\d+)\s*[xX]?\s+(.+)$/);
    if (quantityMatch) {
      quantity = Number(quantityMatch[1]);
      line = quantityMatch[2].trim();
    } else if (/^\d+\s*[xX]?\s*$/.test(line) || /^\d+[xX]\S/.test(line)) {
      errors.push(`Line ${lineNo}: invalid quantity or card name`);
      continue;
    }
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 500) {
      errors.push(`Line ${lineNo}: quantity must be 1–500`);
      continue;
    }

    let name = line, set = null, collector = null;
    const printing = line.match(/^(.*?)\s+\(([a-zA-Z0-9]+)\)(?:\s+([A-Za-z0-9-]+))?$/);
    if (printing) {
      name = printing[1].trim();
      set = printing[2].toLowerCase();
      collector = printing[3] || null;
    }
    if (!name || /^\d+$/.test(name)) {
      errors.push(`Line ${lineNo}: missing card name`);
      continue;
    }
    if (collector && !set) {
      errors.push(`Line ${lineNo}: collector number requires a set code`);
      continue;
    }
    if (!includeBasics && isBasicLandName(name)) {
      ignored.push({ line: lineNo, reason: 'Basic land', quantity, name });
      continue;
    }
    entries.push({ name, quantity, set, collector, line: lineNo });
  }

  const total = entries.reduce((n, c) => n + c.quantity, 0);
  if (total > 700) errors.push('Deck exceeds the 700-card browser limit. Split it into smaller PDFs.');
  return { entries, errors, ignored, total };
}

export function requestKey(entry, settings) {
  return [normalizeName(entry.name), entry.set || '', String(entry.collector || '').toLowerCase(), settings.printingMode,
    settings.treatment, settings.avoidTextless ? 'no-textless' : 'textless-okay'].join('|');
}
