/** Exact coordinates ported from mtg_rich_proxy/src/proxy_deck/create_pdf.py. Units: PDF points. */
export const PAGE_WIDTH = 612; // US Letter: 8.5 inches
export const PAGE_HEIGHT = 792; // US Letter: 11 inches
export const CARD_WIDTH = 180; // 2.5 inches, NEVER rescale
export const CARD_HEIGHT = 252; // 3.5 inches, NEVER rescale

export const LAYOUTS = Object.freeze({
  6: { cols: 2, rows: 3, rotate: true, gapX: 20, gapY: 18 },
  8: { cols: 2, rows: 4, rotate: true, gapX: 20, gapY: 12 },
  9: { cols: 3, rows: 3, rotate: false, gapX: 0, gapY: 0 },
});
export const MARKS = Object.freeze({ length: 24, inset: 0.5, clearance: 1.5, lineWidth: 0.45 });

export function getCardPositions(layoutCount = 9) {
  const layout = LAYOUTS[layoutCount];
  if (!layout) throw new Error('Layout must be 6, 8, or 9 cards per sheet.');
  const width = layout.rotate ? CARD_HEIGHT : CARD_WIDTH;
  const height = layout.rotate ? CARD_WIDTH : CARD_HEIGHT;
  const gridW = layout.cols * width + (layout.cols - 1) * layout.gapX;
  const gridH = layout.rows * height + (layout.rows - 1) * layout.gapY;
  if (gridW > PAGE_WIDTH || gridH > PAGE_HEIGHT) throw new Error('Card grid does not fit US Letter paper.');
  const marginX = (PAGE_WIDTH - gridW) / 2;
  const marginY = (PAGE_HEIGHT - gridH) / 2;
  const positions = [];
  for (let row = 0; row < layout.rows; row++) {
    for (let col = 0; col < layout.cols; col++) {
      positions.push({
        x: marginX + col * (width + layout.gapX),
        y: PAGE_HEIGHT - marginY - height - row * (height + layout.gapY),
        width, height,
      });
    }
  }
  return { positions, rotate: layout.rotate, width, height, marginX, marginY };
}

export function cropMarkSegments(positions, occupied, { length = MARKS.length, inset = MARKS.inset, clearance = MARKS.clearance } = {}) {
  if (!positions.length || occupied <= 0) return [];
  const used = positions.slice(0, occupied);
  const left = Math.min(...positions.map(p => p.x));
  const right = Math.max(...positions.map(p => p.x + p.width));
  const bottom = Math.min(...positions.map(p => p.y));
  const top = Math.max(...positions.map(p => p.y + p.height));
  const xEdges = [...new Set(used.flatMap(p => [p.x, p.x + p.width]).map(n => Number(n.toFixed(8))))].sort((a, b) => a - b);
  const yEdges = [...new Set(used.flatMap(p => [p.y, p.y + p.height]).map(n => Number(n.toFixed(8))))].sort((a, b) => a - b);
  const leftEnd = Math.min(inset + length, left - clearance);
  const rightEnd = Math.max(PAGE_WIDTH - inset - length, right + clearance);
  const bottomEnd = Math.min(inset + length, bottom - clearance);
  const topEnd = Math.max(PAGE_HEIGHT - inset - length, top + clearance);
  if (Math.min(leftEnd - inset, PAGE_WIDTH - inset - rightEnd, bottomEnd - inset, PAGE_HEIGHT - inset - topEnd) <= 0) {
    throw new Error('Not enough margin for crop marks.');
  }
  return [
    ...xEdges.flatMap(x => [[x, inset, x, bottomEnd], [x, PAGE_HEIGHT - inset, x, topEnd]]),
    ...yEdges.flatMap(y => [[inset, y, leftEnd, y], [PAGE_WIDTH - inset, y, rightEnd, y]]),
  ];
}

/** PDF 6-element matrix for a portrait image. Landscape layouts rotate artwork 90° CCW. */
export function imageMatrix(position, rotate) {
  if (rotate) return [0, CARD_WIDTH, -CARD_HEIGHT, 0, position.x + CARD_HEIGHT, position.y];
  return [CARD_WIDTH, 0, 0, CARD_HEIGHT, position.x, position.y];
}
