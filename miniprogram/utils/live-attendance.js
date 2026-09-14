const d = require('./domain');
const clean = value => String(value || '').trim();
function direction(event) {
  const value = clean(event).toLowerCase();
  if (['进门', '进入', '入校', '进校', '进', '入', 'in'].includes(value)) return 'in';
  if (['出门', '离开', '出校', '离校', '出', 'out'].includes(value)) return 'out';
  return '';
}
function rowDirection(row) {
  const event = clean(row.event);
  if (event && event !== '方向未提供') return direction(event);
  const match = /-[东西南北]\d+-([入出])(?:_|$)/.exec(clean(row.channel));
  return match ? match[1] === '入' ? 'in' : 'out' : '';
}
function classify(row) {
  const place = clean(row.place), channel = clean(row.channel), result = clean(row.result).toLowerCase();
  // swipeType is the school's location category; dormitory takes precedence over channel names.
  if (/宿舍|公寓|寝室|dorm/i.test(place + channel)) return 'dorm';
  if (['失败', '开门失败', '拒绝', '未通过', 'fail', 'failed', 'denied'].includes(result)) return 'failed';
  const campus = /^(教学楼|学院|校园|校门)$/.test(place) || (!place && (
    /学院|校门|教学楼/.test(channel) || /^闸机-[东西南北]\d*-[入出](?:_|$)/.test(channel) || /^[东西南北]门(?:$|[-_])/.test(channel)
  ));
  if (!campus || !['成功', '开门成功', '通过', 'success'].includes(result) || !rowDirection(row)) return 'unknown';
  return 'campus';
}
function seconds(time) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(time || '');
  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] || 0) : null;
}
function clock(value) {
  return `${String(Math.floor(value / 3600)).padStart(2, '0')}:${String(Math.floor(value / 60) % 60).padStart(2, '0')}`;
}

// Today's estimate only. Never infer an entry at midnight or write this into school summaries.
function estimate(rows, date, now = new Date(), targetHours = 6) {
  if (date !== d.dateKey(now)) return null;
  const current = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  const counts = { dorm: 0, failed: 0, unknown: 0, unmatched: 0, conflict: 0 };
  const ordered = [];
  rows.filter(row => row.date === date).forEach(row => {
    const at = seconds(row.time);
    if (at !== null && at > current) return;
    const kind = classify(row);
    if (kind === 'dorm' || kind === 'failed') { counts[kind]++; return; }
    if (at === null) { counts.unknown++; ordered.push({ at: current, kind: 'unknown' }); return; }
    if (kind === 'unknown') counts.unknown++;
    ordered.push({ at, kind, direction: rowDirection(row) });
  });
  ordered.sort((a, b) => a.at - b.at);
  let open = null, total = 0, state = 'outside';
  const sessions = [];
  for (let i = 0; i < ordered.length;) {
    const at = ordered[i].at, group = [];
    while (i < ordered.length && ordered[i].at === at) group.push(ordered[i++]);
    const directions = new Set(group.filter(row => row.kind === 'campus').map(row => row.direction));
    // Opposite directions in the same second have no reliable order. Stop the open estimate.
    if (group.some(row => row.kind === 'unknown') || directions.size > 1) {
      if (directions.size > 1) counts.conflict++;
      open = null; state = 'unknown'; continue;
    }
    if (directions.has('in')) { if (open === null) open = at; state = 'inside'; }
    if (directions.has('out')) {
      if (open !== null) {
        total += at - open;
        sessions.push({ id: String(open), start: clock(open), end: clock(at), duration: d.duration(Math.floor((at - open) / 60)), ongoing: false });
        open = null;
      } else counts.unmatched++;
      state = 'outside';
    }
  }
  const completedSeconds = total;
  if (open !== null) {
    total += current - open;
    sessions.push({ id: String(open), start: clock(open), end: '现在', duration: d.duration(Math.floor((current - open) / 60)), ongoing: true });
  }
  const minutes = Math.floor(total / 60), targetSeconds = targetHours * 3600;
  const remainingMinutes = Math.max(0, Math.ceil((targetSeconds - total) / 60));
  const partial = counts.unknown + counts.unmatched + counts.conflict > 0;
  const notes = [];
  if (counts.unknown) notes.push(`${counts.unknown} 条地点、方向或开门结果未识别`);
  if (counts.unmatched) notes.push(`${counts.unmatched} 条出门缺少对应进门（可能跨日或漏刷）`);
  if (counts.conflict) notes.push('同一时间存在相反方向');
  const etaSeconds = current + Math.max(0, targetSeconds - total);
  let targetText = remainingMinutes ? `距个人目标还差 ${d.duration(remainingMinutes)}` : '已达到个人目标';
  if (state === 'inside' && remainingMinutes && !partial && etaSeconds < 86400) targetText += ` · 预计 ${clock(Math.ceil(etaSeconds / 60) * 60)} 达到`;
  return {
    state, status: { inside: '出勤中', outside: '未出勤', unknown: '待核对' }[state],
    minutes, hours: Math.floor(minutes / 60), minutePart: minutes % 60, duration: d.duration(minutes),
    completedDuration: d.duration(Math.floor(completedSeconds / 60)), partial,
    progress: Math.min(100, Math.round(total / targetSeconds * 100)), targetText,
    hint: state === 'inside' ? `现在离开，今日${partial ? '至少' : '累计'} ${d.duration(minutes)}` : state === 'outside' ? '已累计完成的学院进出时段' : '暂不能确定是否在学院内',
    warning: notes.length ? notes.join('；') + '。仅累计可确认时段。' : '',
    ignoredText: [counts.dorm ? `忽略宿舍 ${counts.dorm} 条` : '', counts.failed ? `忽略失败 ${counts.failed} 条` : ''].filter(Boolean).join(' · '),
    sessions, counts
  };
}
module.exports = { estimate, classify };
