import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../site/index.html', import.meta.url), 'utf8');
const js = readFileSync(new URL('../site/js/app.js', import.meta.url), 'utf8');

test('tool defaults to 9-up and latest normal printing', () => {
  assert.match(html, /<option value="9" selected>/);
  assert.match(html, /<option value="latest" selected>/);
});

test('print basic lands is opt-in and connected to both preview and generation', () => {
  assert.match(html, /<input type="checkbox" id="printBasics"\s*\/>/);
  assert.match(js, /printBasics: \$\('printBasics'\)\.checked/);
  assert.match(js, /parseDecklist\(entryField\.value, \{ includeBasics: options\.printBasics \}\)/);
  assert.match(js, /\$\('printBasics'\)\.addEventListener\('change', renderSummary\)/);
});

test('app references existing UI element IDs', () => {
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
  const referenced = new Set([...js.matchAll(/\$\('([^']+)'\)/g)].map(m => m[1]));
  assert.deepEqual([...referenced].filter(x => !ids.has(x)), []);
});
