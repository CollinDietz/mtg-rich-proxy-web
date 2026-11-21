import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDecklist, normalizeName, requestKey } from '../site/js/parser.js';

test('plain cards, quantities, explicit set and collector numbers', () => {
  const result = parseDecklist('1x Command Tower (trc) 521\n7 Island\n2x Arcane Signet');
  assert.equal(result.total, 10);
  assert.equal(result.entries.length, 3);
  assert.deepEqual(result.entries[0], {name:'Command Tower',quantity:1,set:'trc',collector:'521',line:1});
  assert.equal(result.entries[1].quantity, 7);
  assert.deepEqual(result.errors, []);
});

test('Archidekt markers and categories are parsed without polluting names', () => {
  const deck = [
    '1x Cormela, Glamour Thief (snc) 301 [Commander{top}]',
    '1x Past in Flames (who) 565 *F* [Added Recursion A]',
    '1x Scour for Scrap (eoe) 73 [Added Tutor A] ^Might Remove,#d6fa0d^',
    '1x Negate (tmt) 47 *E* [Counter B]',
    '1x Black Mage\'s Rod (fin) 90 [Wizard Engine A,Expensive{noPrice}]',
  ].join('\n');
  const result = parseDecklist(deck);
  assert.deepEqual(result.errors, []);
  assert.equal(result.total, 5);
  assert.equal(result.entries[1].collector, '565');
  assert.equal(result.entries[2].name, 'Scour for Scrap');
  assert.equal(result.entries[3].collector, '47');
});

test('maybeboard/removed/extras ignored but false secondary flags do not remove mainboard', () => {
  const deck = [
    '1x Added Card [Added Draw A]',
    '1x Original Card [Removal A,Maybeboard{noDeck}{noPrice}]',
    '1x Removed Card [Removed Draw D{noDeck}{noPrice},Maybeboard{noDeck}{noPrice}]',
    '1x Maybe Card [Maybe Burn B{noDeck}{noPrice},Maybeboard{noDeck}{noPrice}]',
    '1x Wizard (tfin) 15 [Tokens & Extras{noDeck}]',
    'Sideboard',
    '1x Counterspell',
  ].join('\n');
  const result = parseDecklist(deck);
  assert.equal(result.total, 2);
  assert.equal(result.ignored.length, 4);
  assert.equal(result.entries[1].name, 'Original Card');
});

test('printing-specific lookup keys and normalized names', () => {
  const settings = { printingMode:'latest', treatment:'standard', avoidTextless:true };
  assert.equal(normalizeName('  Blightstep Pathway//Searstep Pathway '), 'blightstep pathway // searstep pathway');
  assert.notEqual(requestKey({name:'Command Tower',set:'trc',collector:'521'}, settings), requestKey({name:'Command Tower',set:'clb',collector:'353'}, settings));
  assert.notEqual(requestKey({name:'Command Tower'}, settings), requestKey({name:'Command Tower'}, { ...settings, printingMode:'expensive' }));
});

test('invalid quantities and large decks produce errors', () => {
  assert.ok(parseDecklist('0x Island').errors.length);
  assert.ok(parseDecklist('600x Island').errors.length);
  assert.ok(parseDecklist('500x Island\n300x Mountain').errors.length);
});
