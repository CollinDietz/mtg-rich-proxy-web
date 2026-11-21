import test from 'node:test';
import assert from 'node:assert/strict';
import { getCardPositions, cropMarkSegments, imageMatrix, PAGE_WIDTH, PAGE_HEIGHT } from '../site/js/layout.js';

for (const cards of [6,8,9]) {
  test(`${cards}-up exactly 2.5 x 3.5 inches, centered on Letter`, () => {
    const {positions,rotate,width,height,marginX,marginY} = getCardPositions(cards);
    assert.equal(positions.length,cards);
    assert.equal(width*height,180*252);
    assert.ok(Math.min(...positions.map(p => p.x)) >= 0);
    assert.ok(Math.max(...positions.map(p => p.x+p.width)) <= PAGE_WIDTH);
    assert.ok(Math.min(...positions.map(p => p.y)) >= 0);
    assert.ok(Math.max(...positions.map(p => p.y+p.height)) <= PAGE_HEIGHT);
    assert.ok(marginX > 0 && marginY > 0);
    const matrix = imageMatrix(positions[0],rotate);
    assert.equal(Math.abs(matrix[0]*matrix[3]-matrix[1]*matrix[2]),180*252);
  });
}
test('9-up shares a single cut at every internal edge, no gutters', () => {
  const {positions} = getCardPositions(9);
  assert.deepEqual([...new Set(positions.map(p=>p.x))],[36,216,396]);
  assert.deepEqual([...new Set(positions.map(p=>p.y))],[522,270,18]);
  const marks = cropMarkSegments(positions,9);
  assert.equal(marks.length,16);
  assert.equal(marks.filter(([x1,y1,x2,y2])=>x1===x2).length,8);
  assert.ok(marks.every(([x1,y1,x2,y2])=>[x1,y1,x2,y2].every(Number.isFinite)));
});
test('crop marks anchored 0.5 points from physical page perimeter', () => {
  const {positions}=getCardPositions(9);
  const marks=cropMarkSegments(positions,9);
  assert.ok(marks.every(([x1,y1,x2,y2]) =>
    x1===.5 || x1===611.5 || x2===.5 || x2===611.5 || y1===.5 || y1===791.5 || y2===.5 || y2===791.5));
  assert.equal(cropMarkSegments(positions,1).length,8);
});
