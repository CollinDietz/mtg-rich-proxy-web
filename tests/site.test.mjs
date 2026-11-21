import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const html = readFileSync(new URL('../site/index.html', import.meta.url), 'utf8');
const js = readFileSync(new URL('../site/js/app.js', import.meta.url), 'utf8');

test("tool defaults to 9-up and Scryfall default printing", () => {
  assert.match(html, /<option value="9" selected>/);
  assert.match(html, /<option value="latest" selected>Scryfall default<\/option>/);
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


test('site references a fresh stylesheet that ships in the repository', () => {
  const stylesheet = html.match(/<link rel="stylesheet" href="\.\/(.*?)"/);
  assert.ok(stylesheet, 'missing stylesheet link');
  assert.notEqual(stylesheet[1], 'styles.css', 'reuse of old stylesheet URL can cause cached CSS/HTML mismatch');
  const actualPath = new URL(`../site/${stylesheet[1]}`, import.meta.url);
  assert.ok(existsSync(actualPath), 'stylesheet path does not exist');
  const css = readFileSync(actualPath, 'utf8');
  assert.match(css, /\.workspace\s*\{/);
  assert.match(css, /\.panel-heading\s*\{/);
  assert.match(css, /\.input-footer\s*\{/);
});

test('generate action is adjacent to the sheet summary, not below the settings', () => {
  const summary = html.indexOf('class="panel summary-panel"');
  const generate = html.indexOf('id="generate"');
  const generation = html.indexOf('class="panel output-panel"');
  assert.ok(summary >= 0 && summary < generate && generate < generation);
});
