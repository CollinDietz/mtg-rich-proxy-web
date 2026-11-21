import { parseDecklist, requestKey } from './parser.js';
import { resolveCard, downloadCardImages } from './scryfall.js?v=20261121-readable-fallback-v2';
import { clearCache } from './cache.js';
import { buildPrintablePdf } from './pdf.js';

const $ = id => document.getElementById(id);
const entryField = $('decklist');
const generateButton = $('generate');
const cancelButton = $('cancel');
const exampleButton = $('example');
const clearButton = $('clearCache');
const resultList = $('results');
const logList = $('log');
const progress = $('progress');
const progressFill = $('progressFill');
const statusLabel = $('statusLabel');
const statusText = $('statusText');
const notice = $('notice');
const downloadLink = $('download');
let controller = null;
let currentDownloadUrl = null;

const SAMPLE = `1x Command Tower\n1x Arcane Signet\n1x Blightstep Pathway // Searstep Pathway (khm) 251\n2x Island\n1x Ponder`;

function settings() {
  return {
    layout: Number($('layout').value),
    printingMode: $('printingMode').value,
    treatment: $('treatment').value,
    quality: $('quality').value,
    doubleFaces: $('doubleFaces').value,
    cropMarks: $('cropMarks').checked,
    avoidTextless: $('avoidTextless').checked,
    printBasics: $('printBasics').checked,
  };
}
function showNotice(message, tone = 'info') {
  notice.textContent = message;
  notice.dataset.tone = tone;
  notice.hidden = !message;
}
function addLog(text, tone = '') {
  const li = document.createElement('li');
  li.textContent = text;
  if (tone) li.dataset.tone = tone;
  logList.appendChild(li);
  if (logList.children.length > 80) logList.firstChild.remove();
}
function setProgress(message, current = 0, total = 0) {
  statusText.textContent = message;
  const pct = total ? Math.min(100, Math.round(current / total * 100)) : 0;
  progressFill.style.width = `${pct}%`;
  progress.setAttribute('aria-valuenow', String(pct));
}
function setBusy(busy) {
  generateButton.disabled = busy;
  cancelButton.hidden = !busy;
  clearButton.disabled = busy;
  exampleButton.disabled = busy;
  entryField.readOnly = busy;
  for (const el of document.querySelectorAll('.settings input,.settings select,.option-list input')) el.disabled = busy;
  statusLabel.textContent = busy ? 'GENERATING' : (downloadLink.hidden ? 'READY' : 'COMPLETE');
  $('statusDot').classList.toggle('active', busy);
}
function resetDownload() {
  downloadLink.hidden = true;
  if (currentDownloadUrl) URL.revokeObjectURL(currentDownloadUrl);
  currentDownloadUrl = null;
}
function renderSummary() {
  const options = settings();
  const { entries, errors, ignored, total } = parseDecklist(entryField.value, { includeBasics: options.printBasics });
  const estimatedFaces = entries.reduce((n, e) => n + e.quantity * (options.doubleFaces === 'both' && e.name.includes('//') ? 2 : 1), 0);
  const pages = Math.ceil(estimatedFaces / options.layout);
  const layoutGrid = $('cardGrid');
  layoutGrid.dataset.layout = String(options.layout);
  layoutGrid.replaceChildren(...Array.from({length: options.layout}, () => document.createElement('span')));
  $('templateLabel').textContent = `${options.layout}-UP PRINT TEMPLATE`;
  $('cutNote').textContent = options.layout === 9 ? 'With 9-up, cards share cut lines.' : 'Landscape layouts use separate crop marks and gutters.';
  $('cardCount').textContent = total;
  $('pageCount').textContent = pages;
  $('basicCount').textContent = ignored.filter(e => e.reason === 'Basic land').reduce((n, e) => n + e.quantity, 0);
  $('ignoredCount').textContent = ignored.filter(e => e.reason !== 'Basic land').length;
  $('parsedCount').textContent = entries.length ? `${entries.length} entries parsed` : 'Paste cards to begin';
  if (errors.length) showNotice(errors.slice(0, 4).join(' • '), 'error');
  else if (notice.dataset.tone === 'error' && !controller) showNotice('');
}
function fileName() {
  const base = $('fileName').value.trim() || 'mtg-rich-proxies';
  const safe = base.replace(/[^a-zA-Z0-9_.-]+/g,'-').replace(/^\.+/,'').slice(0, 80) || 'mtg-rich-proxies';
  return safe.toLowerCase().endsWith('.pdf') ? safe : `${safe}.pdf`;
}
function printSummary(rows) {
  resultList.replaceChildren();
  const fragment = document.createDocumentFragment();
  for (const row of rows) {
    const li = document.createElement('li');
    const title = document.createElement('span');
    title.textContent = `${row.entry.quantity}× ${row.entry.name}`;
    const metadata = document.createElement('span');
    metadata.className = 'result-meta';
    metadata.textContent = `${row.card.set?.toUpperCase() || '??'} #${row.card.collector_number || '?'}${row.card.prices?.usd ? ` · $${row.card.prices.usd}` : ''}${row.note ? ' · substituted' : ''}`;
    li.append(title, metadata);
    if (row.note) li.title = row.note;
    fragment.appendChild(li);
  }
  resultList.appendChild(fragment);
  $('resultsHeading').textContent = `${rows.length} printings resolved`;
}

async function generate(event) {
  event.preventDefault();
  if (controller) return;
  const options = settings();
  const parsed = parseDecklist(entryField.value, { includeBasics: options.printBasics });
  if (parsed.errors.length) { showNotice(parsed.errors.join(' • '), 'error'); return; }
  if (!parsed.entries.length) { showNotice('No cards to print. Paste a decklist or enable “Print basic lands” if your list contains only basics.', 'error'); return; }
  const abort = new AbortController();
  controller = abort;
  resetDownload();
  logList.replaceChildren(); resultList.replaceChildren();
  showNotice(''); $('resultsHeading').textContent = 'Resolved printings';
  setBusy(true);
  const { signal } = abort;
  const uniqueEntries = new Map();
  // Deduplicate exact lookup requests but preserve all quantities and order.
  for (const entry of parsed.entries) {
    const key = requestKey(entry, options);
    if (!uniqueEntries.has(key)) uniqueEntries.set(key, entry);
  }
  const resolved = new Map();
  const failures = [];
  try {
    let index = 0;
    for (const [key, entry] of uniqueEntries) {
      if (signal.aborted) throw new DOMException('Generation canceled.', 'AbortError');
      setProgress(`Finding printings · ${index + 1}/${uniqueEntries.size}`, index, uniqueEntries.size);
      try {
        const match = await resolveCard(entry, options, signal);
        resolved.set(key, match);
        addLog(`${match.cached ? 'Cached' : 'Matched'} · ${entry.name} → ${match.card.set?.toUpperCase()} ${match.card.collector_number}`);
        if (match.note) addLog(`${entry.name}: ${match.note}`, 'warning');
      } catch (error) {
        if (signal.aborted || error.name === 'AbortError') throw error;
        failures.push(`${entry.name} (line ${entry.line}): ${error.message}`);
        addLog(`ERROR · ${entry.name}: ${error.message}`, 'error');
      }
      index++;
    }
    if (failures.length) throw new Error(`${failures.length} card lookup${failures.length===1?'':'s'} failed. No incomplete PDF was created. ${failures.slice(0,3).join(' · ')}`);
    const matches = parsed.entries.map(entry => ({ entry, ...resolved.get(requestKey(entry, options)) }));
    printSummary(matches);
    $('resolvedDetails').open = true;

    const imageGroups = new Map();
    index = 0;
    for (const match of matches) {
      if (signal.aborted) throw new DOMException('Generation canceled.', 'AbortError');
      const key = `${match.card.id}:${options.quality}`;
      if (!imageGroups.has(key)) {
        setProgress(`Downloading images · ${index + 1}`, index, matches.length);
        const blobs = await downloadCardImages(match.card, options.quality, signal, cached => {
          if (!cached) addLog(`Downloaded artwork · ${match.entry.name}`);
        });
        imageGroups.set(key, blobs);
      }
      index++;
    }
    const faces = [];
    for (const match of matches) {
      const set = imageGroups.get(`${match.card.id}:${options.quality}`);
      const selectedFaces = options.doubleFaces === 'front' ? set.slice(0,1) : set;
      for (let n = 0; n < match.entry.quantity; n++) faces.push(...selectedFaces);
    }
    $('pageCount').textContent = Math.ceil(faces.length / options.layout);
    setProgress(`Creating PDF · ${faces.length} card faces`, 0, faces.length);
    const pdf = await buildPrintablePdf(faces, options, {
      signal,
      onProgress: (text, current, total) => setProgress(text, current, total),
    });
    if (signal.aborted) throw new DOMException('Generation canceled.', 'AbortError');
    currentDownloadUrl = URL.createObjectURL(pdf);
    downloadLink.href = currentDownloadUrl;
    downloadLink.download = fileName();
    downloadLink.hidden = false;
    addLog(`Ready · ${faces.length} printable faces · ${(pdf.size/1048576).toFixed(1)} MB`, 'success');
    showNotice('Your PDF is ready. Download it and print at Actual size / 100% (not “Fit to page”).', 'success');
    statusLabel.textContent = 'COMPLETE';
    $('statusDot').classList.remove('active');
    downloadLink.click();
  } catch (error) {
    if (signal.aborted || error.name === 'AbortError') {
      setProgress('Canceled. You can run it again.', 0, 0);
      addLog('Canceled by user.', 'warning');
      showNotice('Generation canceled.', 'info');
    } else {
      setProgress('Could not finish · review the details below', 0, 0);
      addLog(error.message, 'error');
      $('activityDetails').open = true;
      showNotice(error.message, 'error');
    }
  } finally {
    controller = null;
    setBusy(false);
    if (downloadLink.hidden) statusLabel.textContent = 'READY';
  }
}

$('form').addEventListener('submit', generate);
cancelButton.addEventListener('click', () => controller?.abort());
exampleButton.addEventListener('click', () => { entryField.value = SAMPLE; renderSummary(); entryField.focus(); });
entryField.addEventListener('input', renderSummary);
$('layout').addEventListener('change', renderSummary);
$('doubleFaces').addEventListener('change', renderSummary);
$('printBasics').addEventListener('change', renderSummary);
clearButton.addEventListener('click', async () => {
  if (!confirm('Clear your browser’s cached card images and printing selections?')) return;
  await clearCache();
  showNotice('Browser cache cleared. The next PDF will download card artwork again.', 'success');
});
renderSummary();
