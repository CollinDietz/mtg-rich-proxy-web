/** Minimal dependency-free PDF 1.4 writer for Scryfall card images and trim ticks.
 *  Embeds RGB JPEG image streams. PNG sources are decoded and converted in-browser
 *  at high JPEG quality, avoiding large third-party PDF libraries or CDNs.
 */
import { PAGE_WIDTH, PAGE_HEIGHT, getCardPositions, cropMarkSegments, imageMatrix, MARKS } from './layout.js';
const encoder = new TextEncoder();
const ascii = text => encoder.encode(text);
const format = value => Number(value.toFixed(5)).toString();
const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));

class DocumentWriter {
  constructor() { this.objects = [null]; }
  reserve() { this.objects.push(null); return this.objects.length - 1; }
  set(index, object) { this.objects[index] = object; }
  stream(dictionary, data) { const id = this.reserve(); this.set(id, { dictionary, data }); return id; }
  finish(catalog) {
    const chunks = [];
    let position = 0;
    const append = bytes => { chunks.push(bytes); position += bytes.length; };
    const appendText = text => append(ascii(text));
    appendText('%PDF-1.4\n%MTG-RICH-PROXY\n');
    const offsets = [0];
    for (let i = 1; i < this.objects.length; i++) {
      const object = this.objects[i];
      if (object === null) throw new Error(`Uninitialized PDF object ${i}`);
      offsets[i] = position;
      appendText(`${i} 0 obj\n`);
      if (typeof object === 'string') appendText(object + '\n');
      else {
        appendText(`<< ${object.dictionary} /Length ${object.data.length} >>\nstream\n`);
        append(object.data);
        appendText('\nendstream\n');
      }
      appendText('endobj\n');
    }
    const xrefAt = position;
    appendText(`xref\n0 ${this.objects.length}\n0000000000 65535 f \n`);
    for (let i = 1; i < offsets.length; i++) appendText(`${String(offsets[i]).padStart(10,'0')} 00000 n \n`);
    appendText(`trailer\n<< /Size ${this.objects.length} /Root ${catalog} 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);
    const result = new Uint8Array(position);
    let at = 0;
    for (const chunk of chunks) { result.set(chunk, at); at += chunk.length; }
    return result;
  }
}

function imageLoaded(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Browser could not decode a card image.')); };
    image.src = url;
  });
}
function canvasJpeg(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('JPEG encoding failed.')), 'image/jpeg', 0.97));
}

export async function prepareImage(blob) {
  let bitmap = null;
  let source = null;
  try {
    if ('createImageBitmap' in globalThis) bitmap = await createImageBitmap(blob);
    else source = await imageLoaded(blob);
    const width = bitmap?.width || source.naturalWidth;
    const height = bitmap?.height || source.naturalHeight;
    if (!width || !height) throw new Error('Image has invalid dimensions.');
    if (blob.type === 'image/jpeg' || blob.type === 'image/jpg') {
      return { bytes: new Uint8Array(await blob.arrayBuffer()), width, height };
    }
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D not supported.');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap || source, 0, 0);
    const jpeg = await canvasJpeg(canvas);
    return { bytes: new Uint8Array(await jpeg.arrayBuffer()), width, height };
  } finally { bitmap?.close?.(); }
}

/** `faces` is an expanded array of {id, blob} — duplicates deliberately share one XObject. */
export async function buildPrintablePdf(faces, { layout = 9, cropMarks = true } = {}, { signal, onProgress = () => {} } = {}) {
  if (!faces.length) throw new Error('No cards to print.');
  const { positions, rotate } = getCardPositions(Number(layout));
  const writer = new DocumentWriter();
  const pagesRoot = writer.reserve();
  const catalog = writer.reserve();
  const imageRefs = new Map();
  const unique = new Map(faces.map(face => [face.id, face]));
  let index = 0;
  for (const face of unique.values()) {
    if (signal?.aborted) throw new DOMException('Generation canceled.', 'AbortError');
    onProgress(`Preparing artwork ${++index} of ${unique.size}…`, index, unique.size);
    const asset = await prepareImage(face.blob);
    const id = writer.stream(`/Type /XObject /Subtype /Image /Width ${asset.width} /Height ${asset.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`, asset.bytes);
    imageRefs.set(face.id, id);
    if (index % 4 === 0) await nextFrame();
  }

  const pageIds = [];
  const count = Math.ceil(faces.length / Number(layout));
  for (let p = 0; p < count; p++) {
    if (signal?.aborted) throw new DOMException('Generation canceled.', 'AbortError');
    onProgress(`Laying out page ${p + 1} of ${count}…`, p + 1, count);
    const pageFaces = faces.slice(p * layout, (p + 1) * layout);
    const xobjects = new Map();
    const ops = ['q', '1 1 1 rg', 'Q'];
    for (let i = 0; i < pageFaces.length; i++) {
      const face = pageFaces[i];
      const ref = imageRefs.get(face.id);
      const localId = `Img${ref}`;
      xobjects.set(localId, ref);
      const matrix = imageMatrix(positions[i], rotate).map(format).join(' ');
      ops.push(`q\n${matrix} cm\n/${localId} Do\nQ`);
    }
    if (cropMarks) {
      ops.push(`0 G\n${format(MARKS.lineWidth)} w\n0 J`);
      for (const [x1,y1,x2,y2] of cropMarkSegments(positions, pageFaces.length)) {
        ops.push(`${format(x1)} ${format(y1)} m ${format(x2)} ${format(y2)} l S`);
      }
    }
    const stream = writer.stream('', ascii(ops.join('\n') + '\n'));
    const page = writer.reserve();
    writer.set(page, `<< /Type /Page /Parent ${pagesRoot} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /XObject << ${[...xobjects].map(([label, ref]) => `/${label} ${ref} 0 R`).join(' ')} >> >> /Contents ${stream} 0 R >>`);
    pageIds.push(page);
    await nextFrame();
  }
  writer.set(pagesRoot, `<< /Type /Pages /Kids [${pageIds.map(n => `${n} 0 R`).join(' ')}] /Count ${pageIds.length} >>`);
  writer.set(catalog, `<< /Type /Catalog /Pages ${pagesRoot} 0 R >>`);
  const bytes = writer.finish(catalog);
  onProgress(`PDF ready · ${count} ${count === 1 ? 'page' : 'pages'}`, count, count);
  return new Blob([bytes], { type: 'application/pdf' });
}
