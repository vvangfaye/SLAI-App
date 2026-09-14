const d = require('../utils/domain');
function parsePage(payload) {
  if (!payload || ![0, '0'].includes(payload.code) || !Array.isArray(payload.data) || !Number.isSafeInteger(Number(payload.count)) || Number(payload.count) < 0) throw new Error('打卡明细格式变化，请稍后重试');
  const records = payload.data.map(row => {
    const match = /^(\d{4}-\d{2}-\d{2})[ T]([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(String(row.swipeTime || ''));
    if (!match) throw new Error('打卡时间格式变化，未显示不完整明细');
    d.parseDate(match[1]);
    const text = key => typeof row[key] === 'string' ? row[key].slice(0, 120) : '';
    return { id: String(row.id || [row.swipeTime, row.eventType, row.channelName, row.swipeType, row.openingResult].join('|')), date: match[1], time: `${match[2]}:${match[3]}${match[4] ? ':' + match[4] : ''}`, event: text('eventType') || '方向未提供', channel: text('channelName'), place: text('swipeType'), result: text('openingResult') };
  });
  return { count: Number(payload.count), records };
}
async function fetchDay(request, date) {
  d.parseDate(date);
  async function read(filtered) {
    const rows = new Map(); let expected;
    for (let page = 1; page <= 100; page++) {
      const query = `page=${page}&limit=100&startTime=${filtered ? date : ''}&endTime=${filtered ? date : ''}`;
      const parsed = parsePage(await request(query));
      if (expected !== undefined && expected !== parsed.count) throw new Error('打卡记录正在更新，请重新展开加载');
      expected = parsed.count;
      if (expected > 10000) throw new Error('记录量过大，请稍后重试日期筛选');
      if (parsed.records.some(row => rows.has(row.id))) throw new Error('打卡分页重复，请重新加载');
      parsed.records.forEach(row => rows.set(row.id, row));
      if (rows.size === expected) return [...rows.values()].filter(row => row.date === date).sort((a,b) => a.time.localeCompare(b.time));
      if (!parsed.records.length || rows.size > expected) throw new Error('打卡分页未返回完整记录，请重试');
    }
    throw new Error('打卡明细未加载完整，请重试');
  }
  const rows = await read(true);
  // Some school deployments ignore date filters or return zero for the date format.
  return rows.length ? rows : read(false);
}
module.exports = { parsePage, fetchDay };
