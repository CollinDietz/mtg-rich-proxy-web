import test from 'node:test';
import assert from 'node:assert/strict';
import { readable, nameMatches, cardImageUrls, resolveCard } from '../site/js/scryfall.js';
import { clearCache, putSelection } from '../site/js/cache.js';
import { requestKey } from '../site/js/parser.js';
const base = { name:'Command Tower', lang:'en', games:['paper'], promo:false, textless:false, full_art:false, border_color:'black', image_uris: { large:'https://example.test/a.jpg', png:'https://example.test/a.png' }};
const standard = { avoidTextless:true, treatment:'standard' };

test('normal printing allowed, textless rejected',()=>{
  assert.equal(readable(base,standard),true);
  assert.equal(readable({...base,textless:true},standard),false);
  assert.equal(readable({...base,promo:true},standard),false);
  assert.equal(readable({...base,full_art:true},standard),false);
  assert.equal(readable({...base,border_color:'borderless'},standard),false);
  assert.equal(readable({...base,frame_effects:['showcase']},standard),false);
  assert.equal(readable({...base,full_art:true},{...standard,treatment:'any'}),true);
});
test('names cannot resolve to a back face by accident',()=>{
  assert.equal(nameMatches({...base,name:'Blightstep Pathway // Searstep Pathway'},'Blightstep Pathway'),true);
  assert.equal(nameMatches({...base,name:'Blightstep Pathway // Searstep Pathway'},'Searstep Pathway'),false);
  assert.equal(nameMatches({...base,name:'Stensian Sanguinist // Exsanguinate'},'Exsanguinate'),false);
  assert.equal(nameMatches({...base,name:'Exsanguinate'},'Exsanguinate'),true);
});
test('double faced printings yield both image links',()=>{
  const card={card_faces:[{image_uris:{large:'front.jpg',png:'front.png'}},{image_uris:{large:'back.jpg',png:'back.png'}}]};
  assert.deepEqual(cardImageUrls(card,'large'),['front.jpg','back.jpg']);
  assert.deepEqual(cardImageUrls(card,'png'),['front.png','back.png']);
});


test('standard treatment excludes Secret Lair art even when flags and border look normal', () => {
  const marvel = { ...base, name:'Fabricate', set:'sld', set_name:'Secret Lair Drop', set_type:'box', promo:false, full_art:false, border_color:'black' };
  assert.equal(readable(marvel, standard), false);
  assert.equal(readable({...marvel, set:'xyz'}, standard), false, 'set name is also checked');
  assert.equal(readable({...marvel, set:'xyz', set_name:'Example', set_type:'promo'}, standard), false);
  assert.equal(readable(marvel, {...standard, treatment:'any'}), true, 'intentional special art remains selectable');
});

test('plain Fabricate uses Scryfall named default, never sorts all printings', async () => {
  await clearCache();
  const originalFetch = globalThis.fetch;
  const entry = { name:'Fabricate', quantity:1, set:null, collector:null };
  const settings = { printingMode:'latest', treatment:'standard', avoidTextless:true };
  // Scryfall's preferred result is authoritative; newer special releases are
  // not inspected or ranked by the website.
  const ordinary = { ...base, id:'scryfall-chosen-id', name:'Fabricate', set:'fic', set_type:'commander', collector_number:'314' };
  const urls = [];
  globalThis.fetch = async url => {
    urls.push(String(url));
    if (!String(url).includes('/cards/named?')) throw Error(`Unexpected search request ${url}`);
    return { ok:true, json:async () => ordinary };
  };
  try {
    const actual = await resolveCard(entry, settings);
    assert.equal(actual.card.id, 'scryfall-chosen-id');
    assert.equal(actual.cached, false);
    assert.equal(urls.length, 1);
    assert.match(urls[0], /\/cards\/named\?exact=Fabricate/);
    const cached = await resolveCard(entry, settings);
    assert.equal(cached.card.id, 'scryfall-chosen-id');
    assert.equal(cached.cached, true);
    assert.equal(urls.length, 1, 'no repeated lookup for cached selection');
  } finally {
    globalThis.fetch = originalFetch;
    await clearCache();
  }
});

test('Scryfall default selection honors a named set and explicit collector override', async () => {
  await clearCache();
  const originalFetch = globalThis.fetch;
  const settings = { printingMode:'latest', treatment:'standard', avoidTextless:true };
  const urls = [];
  globalThis.fetch = async url => {
    urls.push(String(url));
    return { ok:true, json:async () => ({ ...base, name:'Fabricate', id:'specific-print', set:'sld', collector_number:'7121', set_type:'box' }) };
  };
  try {
    const withSet = await resolveCard({ name:'Fabricate', set:'sld', collector:null }, settings);
    assert.equal(withSet.card.id, 'specific-print');
    assert.match(urls[0], /\/cards\/named\?exact=Fabricate&set=sld/);
    const exact = await resolveCard({ name:'Fabricate', set:'sld', collector:'7121' }, settings);
    assert.equal(exact.card.id, 'specific-print');
    assert.match(urls[1], /\/cards\/sld\/7121\/en/);
  } finally {
    globalThis.fetch = originalFetch;
    await clearCache();
  }
});

test('Scryfall default retains the textless opt-out', async () => {
  await clearCache();
  const originalFetch = globalThis.fetch;
  let count = 0;
  globalThis.fetch = async () => {
    count++;
    return { ok:true, json:async () => ({ ...base, name:'Fabricate', id:'textless-id', textless:true }) };
  };
  try {
    const entry = { name:'Fabricate', set:null, collector:null };
    const settings = { printingMode:'latest', treatment:'standard', avoidTextless:true };
    await assert.rejects(resolveCard(entry, settings), /textless/);
    const permitted = await resolveCard(entry, { ...settings, avoidTextless:false });
    assert.equal(permitted.card.id, 'textless-id');
    assert.equal(count, 4, 'named + two fallback searches + unfiltered named lookup');
  } finally {
    globalThis.fetch = originalFetch;
    await clearCache();
  }
});


test('Brain Freeze: textless Scryfall default falls back to a readable standard paper printing and caches it', async () => {
  await clearCache();
  const originalFetch = globalThis.fetch;
  const settings = { printingMode:'latest', treatment:'standard', avoidTextless:true };
  const entry = { name:'Brain Freeze', set:null, collector:null };
  const textless = { ...base, id:'brain-textless', oracle_id:'brain-oracle', name:'Brain Freeze', textless:true, set:'sld', collector_number:'2' };
  const readablePrinting = { ...base, id:'brain-normal', oracle_id:'brain-oracle', name:'Brain Freeze', textless:false, set:'scg', collector_number:'29' };
  const urls = [];
  globalThis.fetch = async url => {
    const u = String(url);
    urls.push(u);
    if (u.includes('/cards/named?')) return { ok:true, json:async () => textless };
    if (u.includes('/cards/search?')) return { ok:true, json:async () => ({ data:[textless, readablePrinting], has_more:false }) };
    throw new Error(`Unexpected request: ${u}`);
  };
  try {
    const chosen = await resolveCard(entry, settings);
    assert.equal(chosen.card.id, 'brain-normal');
    assert.match(chosen.note, /excluded/i);
    assert.match(urls[1], /oracleid%3Abrain-oracle/);
    assert.match(urls[1], /is%3Adefault/);
    assert.equal(urls.length, 2, 'search only because default is disallowed');
    const cached = await resolveCard(entry, settings);
    assert.equal(cached.card.id, 'brain-normal');
    assert.equal(cached.cached, true);
    assert.equal(urls.length, 2, 'fallback selection should be cached');
  } finally {
    globalThis.fetch = originalFetch;
    await clearCache();
  }
});

test('Scryfall default fallback prefers ordinary printings over special art', async () => {
  await clearCache();
  const originalFetch = globalThis.fetch;
  const settings = { printingMode:'latest', treatment:'standard', avoidTextless:true };
  const entry = { name:'Brain Freeze', set:null, collector:null };
  const named = { ...base, id:'named', oracle_id:'oracle-1', name:'Brain Freeze', textless:true };
  const special = { ...base, id:'sld', oracle_id:'oracle-1', name:'Brain Freeze', set:'sld', set_name:'Secret Lair Drop', textless:false };
  const normal = { ...base, id:'normal', oracle_id:'oracle-1', name:'Brain Freeze', set:'scg', textless:false };
  globalThis.fetch = async url => ({ ok:true, json:async () => String(url).includes('/cards/named?')
    ? named : { data:[special, normal], has_more:false } });
  try {
    const chosen = await resolveCard(entry, settings);
    assert.equal(chosen.card.id, 'normal');
  } finally {
    globalThis.fetch = originalFetch;
    await clearCache();
  }
});

test('Scryfall default fallback only relaxes special treatment if no standard choice exists', async () => {
  await clearCache();
  const originalFetch = globalThis.fetch;
  const settings = { printingMode:'latest', treatment:'standard', avoidTextless:true };
  const entry = { name:'Brain Freeze', set:null, collector:null };
  const named = { ...base, id:'named', oracle_id:'oracle-1', name:'Brain Freeze', textless:true };
  const special = { ...base, id:'special', oracle_id:'oracle-1', name:'Brain Freeze', set:'sld', set_name:'Secret Lair Drop', textless:false };
  let searches = 0;
  globalThis.fetch = async url => ({ ok:true, json:async () => {
    if (String(url).includes('/cards/named?')) return named;
    searches++;
    return String(url).includes('is%3Adefault')
      ? { data:[], has_more:false }
      : { data:[special], has_more:false };
  } });
  try {
    const chosen = await resolveCard(entry, settings);
    assert.equal(chosen.card.id, 'special');
    assert.equal(searches, 2);
  } finally {
    globalThis.fetch = originalFetch;
    await clearCache();
  }
});

test('Scryfall default fallback honors explicit set before searching other sets', async () => {
  await clearCache();
  const originalFetch = globalThis.fetch;
  const settings = { printingMode:'latest', treatment:'standard', avoidTextless:true };
  const entry = { name:'Brain Freeze', set:'soa', collector:'13' };
  const named = { ...base, id:'named', oracle_id:'oracle-1', name:'Brain Freeze', textless:true, set:'soa' };
  const withinSet = { ...base, id:'in-set', oracle_id:'oracle-1', name:'Brain Freeze', textless:false, set:'soa', collector_number:'78' };
  const urls = [];
  globalThis.fetch = async url => {
    urls.push(String(url));
    return { ok:true, json:async () => String(url).includes('/cards/search?')
      ? { data:[withinSet], has_more:false } : named };
  };
  try {
    const chosen = await resolveCard(entry, settings);
    assert.equal(chosen.card.id, 'in-set');
    assert.match(urls[1], /set%3Asoa/);
  } finally {
    globalThis.fetch = originalFetch;
    await clearCache();
  }
});

test('most-expensive mode still searches and chooses highest priced eligible printing', async () => {
  await clearCache();
  const originalFetch = globalThis.fetch;
  const entry = { name:'Fabricate', set:null, collector:null };
  const settings = { printingMode:'expensive', treatment:'standard', avoidTextless:true };
  const urls = [];
  const identity = {...base, name:'Fabricate', oracle_id:'fabricate-oracle', id:'named'};
  const marvel = {...identity, id:'marvel', set:'sld', set_name:'Secret Lair Drop', set_type:'box', prices:{usd:'90'}};
  const normal = {...identity, id:'normal', set:'fic', set_type:'commander', prices:{usd:'10'}};
  globalThis.fetch = async url => {
    urls.push(String(url));
    return { ok:true, json:async () => String(url).includes('/cards/search?')
      ? { data:[marvel, normal], has_more:false } : identity };
  };
  try {
    const selected = await resolveCard(entry, settings);
    assert.equal(selected.card.id, 'normal');
    assert.equal(urls.length, 2);
    assert.ok(urls[1].includes('order=usd'));
  } finally {
    globalThis.fetch = originalFetch;
    await clearCache();
  }
});
