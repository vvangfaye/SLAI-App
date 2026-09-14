const { test } = require('node:test');
const assert = require('node:assert/strict');
const { monthCells, shiftMonth } = require('../miniprogram/utils/calendar');
test('月历按周一排列，完整覆盖闰年二月和六行月份', () => {
  const leap = monthCells('2024-02', [], '2024-02-10');
  assert.equal(leap[0].date,'2024-01-29'); assert.equal(leap.filter(c=>c.inMonth).length,29); assert.equal(leap.length % 7,0);
  const six = monthCells('2026-03',[]); assert.equal(six.length,42); assert.equal(six.filter(c=>c.inMonth).length,31);
  assert.equal(shiftMonth('2026-01',-1),'2025-12'); assert.equal(shiftMonth('2026-12',1),'2027-01');
});
test('月历区别学校未达标、待判定、无记录和未来日期', () => {
  const cells = monthCells('2026-09',[{date:'2026-09-01',minutes:0,qualified:false},{date:'2026-09-02',minutes:255,qualified:null},{date:'2026-09-03',minutes:360,qualified:true}], '2026-09-11');
  const at = date=>cells.find(c=>c.date===date);
  assert.equal(at('2026-09-01').state,'unqualified'); assert.equal(at('2026-09-01').caption,'0h');
  assert.equal(at('2026-09-02').state,'pending'); assert.equal(at('2026-09-02').caption,'4h15');
  assert.equal(at('2026-09-03').state,'qualified'); assert.equal(at('2026-09-11').state,'none');
  assert.equal(at('2026-09-11').today,true); assert.equal(at('2026-09-12').future,true);
});
