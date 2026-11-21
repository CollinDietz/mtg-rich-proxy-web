import { normalizeName, requestKey } from './parser.js';
import { getSelection, putSelection, getImage, putImage } from './cache.js';

const API = 'https://api.scryfall.com';
const API_INTERVAL_MS = 600; // Deliberately below Scryfall's rate limit for search/named endpoints.
let lastRequest = 0;
let requestQueue = Promise.resolve();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function abortError() { return new DOMException('Generation canceled.', 'AbortError'); }
async function pause(ms, signal) {
  if (!ms) return;
  if (signal?.aborted) throw abortError();
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    function onAbort() { clearTimeout(timer); reject(abortError()); }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
async function respectRateLimit(signal) {
  // Serialize only the *start* of API calls (not the full download).
  const previous = requestQueue;
  let release;
  requestQueue = new Promise(resolve => { release = resolve; });
  await previous;
  try {
    await pause(Math.max(0, API_INTERVAL_MS - (Date.now() - lastRequest)), signal);
    lastRequest = Date.now();
  } finally { release(); }
}

async function fetchWithRetry(url, { signal, api = true } = {}) {
  for (let attempt = 0; attempt < 4; attempt++) {
    if (api) await respectRateLimit(signal);
    try {
      // Preserve browser User-Agent; forbidden header in frontend JS.
      const response = await fetch(url, { signal, mode: 'cors', headers: api ? { Accept: 'application/json' } : undefined });
      if (response.status === 429 || response.status === 502 || response.status === 503 || response.status === 504) {
        if (attempt < 3) { await pause(1500 * (2 ** attempt), signal); continue; }
      }
      return response;
    } catch (error) {
      if (signal?.aborted || error.name === 'AbortError') throw error;
      if (attempt === 3) {
        throw new Error(`${api ? 'Scryfall API' : 'Card image'} connection failed (network/CORS). ${error.message}`);
      }
      await pause(1100 * (2 ** attempt), signal);
    }
  }
  throw new Error('Request retries exhausted.');
}

async function apiJson(url, signal) {
  const response = await fetchWithRetry(url, { signal, api: true });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.object === 'error') {
    throw new Error(json.details || `${response.status} ${response.statusText}`);
  }
  return json;
}

function isBasicLand(card) { return /\bBasic\b/.test((card.type_line || '').split('—')[0]) && /\bLand\b/.test((card.type_line || '').split('—')[0]); }

// Some special-release cards have an ordinary-looking border and aren't flagged
// as promos/full-art in the metadata. Their release date must NOT make them the
// "latest normal" choice. Most notably this includes Secret Lair printings.
function isSpecialRelease(card) {
  const set = (card.set || '').toLowerCase();
  const setName = card.set_name || '';
  const setType = (card.set_type || '').toLowerCase();
  return set === 'sld' || /^secret lair(?:\b|\s)/i.test(setName) ||
    ['promo', 'masterpiece', 'memorabilia', 'token', 'vanguard', 'minigame'].includes(setType);
}

export function readable(card, settings) {
  if (!card || card.lang !== 'en' || !card.games?.includes('paper')) return false;
  const parts = [card, ...(card.card_faces || [])];
  if (settings.avoidTextless && parts.some(part => part.textless)) return false;
  if (settings.treatment === 'standard') {
    if (isSpecialRelease(card)) return false;
    if (card.promo) return false;
    if (card.border_color === 'borderless') return false;
    if (parts.some(p => p.full_art) && !isBasicLand(card)) return false;
    if ((card.frame_effects || []).some(f => ['showcase', 'extendedart', 'inverted', 'fullart'].includes(f))) return false;
  }
  return true;
}

/** Exact full identity first; a bare front-face name is allowed if unambiguous. */
export function nameMatches(card, name) {
  const requested = normalizeName(name);
  const actual = normalizeName(card.name);
  if (requested === actual) return true;
  return !requested.includes('//') && actual.includes('//') && normalizeName(actual.split('//')[0]) === requested;
}

async function namedCard(name, signal, set = null) {
  // Let Scryfall pick the printing, rather than sorting every printing locally.
  const urlFor = requestedName => {
    const params = new URLSearchParams({ exact: requestedName });
    if (set) params.set('set', set);
    return `${API}/cards/named?${params}`;
  };
  try { return await apiJson(urlFor(name), signal); }
  catch (error) {
    if (!name.includes('//')) throw error;
    const firstFace = name.split('//')[0].trim();
    const candidate = await apiJson(urlFor(firstFace), signal);
    if (!nameMatches(candidate, name)) throw error;
    return candidate;
  }
}

function acceptableScryfallDefault(card, settings) {
  // "Scryfall default" does not apply our own promo/set/artwork ranking.
  // The user's explicit "Avoid textless" preference still applies.
  return card?.lang === 'en' && card.games?.includes('paper') &&
    (!settings.avoidTextless || ![card, ...(card.card_faces || [])].some(part => part.textless));
}

/** Select a specific printing directly, or search all printings by resolved Oracle identity. */
export async function resolveCard(entry, settings, signal) {
  const key = requestKey(entry, settings);
  const cached = await getSelection(key, settings.printingMode);
  if (cached && nameMatches(cached.card, entry.name) &&
      (settings.printingMode === 'latest'
        ? acceptableScryfallDefault(cached.card, settings)
        : readable(cached.card, settings))) {
    return { card: cached.card, note: cached.note, cached: true };
  }
  if (signal?.aborted) throw abortError();
  const { name, set, collector } = entry;

  if (settings.printingMode === 'latest') {
    // No printings search, date sort, or custom "normal art" ranking: this is
    // precisely Scryfall's /cards/named default. A specified set/collector is
    // still an intentional override supplied by the user.
    const chosen = set && collector
      ? await apiJson(`${API}/cards/${encodeURIComponent(set)}/${encodeURIComponent(collector)}/en`, signal)
      : await namedCard(name, signal, set);
    if (!nameMatches(chosen, name)) {
      throw new Error(`Scryfall returned '${chosen.name}', not '${name}'.`);
    }
    if (!acceptableScryfallDefault(chosen, settings)) {
      throw new Error(`Scryfall's selected printing for '${name}' is not an English paper printing or is textless. Disable “Avoid textless printings” to use it.`);
    }
    await putSelection(key, chosen);
    return { card: chosen, note: '', cached: false };
  }

  let direct = null;
  if (set && collector) {
    direct = await apiJson(`${API}/cards/${encodeURIComponent(set)}/${encodeURIComponent(collector)}/en`, signal);
    if (!nameMatches(direct, name)) throw new Error(`Requested (${set}) ${collector} is '${direct.name}', not '${name}'.`);
    if (readable(direct, settings)) {
      await putSelection(key, direct);
      return { card: direct, note: '', cached: false };
    }
  }

  const identity = direct || await namedCard(name, signal);
  if (!nameMatches(identity, name)) throw new Error(`Scryfall returned '${identity.name}', not '${name}'.`);
  const query = identity.oracle_id
    ? `oracleid:${identity.oracle_id} game:paper lang:en${set ? ` set:${set}` : ''}`
    : `!"${name.replaceAll('"', '')}" game:paper lang:en${set ? ` set:${set}` : ''}`;
  const params = new URLSearchParams({ q: query, unique: 'prints', order: 'usd', dir: 'desc' });
  let nextUrl = `${API}/cards/search?${params.toString()}`;
  let selected = null;
  let unpriced = null;
  let sawMatch = false;
  // Search is ordered by USD or release date; first fully eligible result is the winner.
  while (nextUrl) {
    let result;
    try { result = await apiJson(nextUrl, signal); }
    catch (error) {
      if (set && !direct && /No cards found/i.test(error.message)) throw new Error(`No printing of '${name}' found in set '${set}'.`);
      throw error;
    }
    for (const card of result.data || []) {
      if (!nameMatches(card, name) || !card.games?.includes('paper') || card.lang !== 'en') continue;
      sawMatch = true;
      if (!readable(card, settings)) continue;
      if (card.prices?.usd != null && Number.isFinite(Number(card.prices.usd))) { selected = card; break; }
      unpriced ??= card;
    }
    if (selected) break;
    nextUrl = result.has_more ? result.next_page : null;
  }
  selected ??= unpriced;
  let note = '';
  if (!selected && direct && set) {
    // Filtering may exclude every printing within the requested set.
    // Search across all sets as a fallback, but never silently use a textless printing.
    const relaxed = await resolveCard({ ...entry, set: null, collector: null }, settings, signal);
    selected = relaxed.card;
    note = `Requested printing (${set}) ${collector} is excluded; using (${selected.set}) ${selected.collector_number} instead.`;
  }
  if (!selected) {
    throw new Error(sawMatch
      ? `No eligible printing found. Try “Allow special treatments” or turn off the textless filter.`
      : `No matching English paper printing found.`);
  }
  if (direct && selected.id !== direct.id) {
    note = `Requested printing (${set}) ${collector} is excluded; using (${selected.set}) ${selected.collector_number} instead.`;
  }
  await putSelection(key, selected, note);
  return { card: selected, note, cached: false };
}

export function cardImageUrls(card, quality) {
  const imageType = quality === 'png' ? 'png' : 'large';
  const one = card.image_uris?.[imageType] || card.image_uris?.large || card.image_uris?.png;
  if (one) return [one];
  const faces = card.card_faces || [];
  const urls = faces.map(face => face.image_uris?.[imageType] || face.image_uris?.large || face.image_uris?.png);
  if (urls.length && urls.every(Boolean)) return urls;
  throw new Error(`Scryfall has no downloadable card image for '${card.name}'.`);
}

export async function downloadCardImages(card, quality, signal, onImage = () => {}) {
  const urls = cardImageUrls(card, quality);
  const blobs = [];
  for (let face = 0; face < urls.length; face++) {
    if (signal?.aborted) throw abortError();
    const key = `${card.id}:${face}:${quality}`;
    let blob = await getImage(key);
    if (!blob) {
      const response = await fetchWithRetry(urls[face], { signal, api: false });
      if (!response.ok) throw new Error(`Image download failed: HTTP ${response.status}`);
      blob = await response.blob();
      if (!blob.size || (!blob.type.startsWith('image/') && !/\.(jpg|jpeg|png)(\?|$)/i.test(urls[face]))) {
        throw new Error(`Invalid image response for '${card.name}'`);
      }
      await putImage(key, blob);
      onImage(false);
    } else onImage(true);
    blobs.push({ id: key, blob, name: card.name, face });
  }
  return blobs;
}
