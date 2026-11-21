import test from 'node:test';
import assert from 'node:assert/strict';
import { readable, nameMatches, cardImageUrls } from '../site/js/scryfall.js';
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
