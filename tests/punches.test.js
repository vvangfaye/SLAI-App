const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parsePage, fetchDay } = require('../miniprogram/services/punches');
const row = (id, date = '2026-09-11', time = '08:30:15') => ({ id, swipeTime: `${date} ${time}`, eventType: '进门', channelName: '东门', openingResult: '成功' });
test('打卡分页全部读取，按时间排序并保留同一时间的不同刷卡', async () => {
  const requests = [];
  const rows = await fetchDay(async query => { requests.push(query); return query.startsWith('page=1&') ? { code: 0, count: 3, data: [row('b', undefined, '12:00:00'), row('a')] } : { code: 0, count: 3, data: [row('c')] }; }, '2026-09-11');
  assert.equal(requests.length, 2); assert.deepEqual(rows.map(r=>r.id), ['a','c','b']); assert.equal(rows[0].time, '08:30:15'); assert.equal(rows[0].channel, '东门');
});
test('日期筛选为空时全量分页并按日期过滤', async () => {
  const rows = await fetchDay(async query => query.includes('startTime=2026') ? { code: 0, count: 0, data: [] } : { code: 0, count: 2, data: [row('a'), row('b', '2026-09-10')] }, '2026-09-11');
  assert.deepEqual(rows.map(r=>r.id), ['a']);
});
test('重复分页、未完整返回、计数变化与坏时间都不伪装完整明细', async () => {
  await assert.rejects(fetchDay(async () => ({ code: 0, count: 2, data: [row('a')] }), '2026-09-11'), /重复/);
  await assert.rejects(fetchDay(async () => ({ code: 0, count: 2, data: [] }), '2026-09-11'), /未返回完整/);
  assert.throws(()=>parsePage({ code: 0, count: 1, data: [{swipeTime:'2026-02-30 12:00'}] }));
  assert.throws(()=>parsePage({ code: 0, data: [] }));
});
