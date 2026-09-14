function number(value) {
  if (!['number', 'string'].includes(typeof value) || String(value).trim() === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 366 ? n : null;
}
function verdict(value) { return [true, 'true', 1, '1', '是'].includes(value) ? true : [false, 'false', 0, '0', '否'].includes(value) ? false : null; }
function parse(stats) {
  const s = stats && typeof stats === 'object' && !Array.isArray(stats) ? stats : {};
  const required = number(s.requiredPunches) === null ? number(s.totalWorkdays) : number(s.requiredPunches);
  // 总计必须来自服务器。只有两个分项都完整时才相加，缺项不当作零。
  const work = number(s.actualWorkdayPunches), rest = number(s.actualRestdayPunches);
  const effective = number(s.totalValidPunches) === null ? work !== null && rest !== null ? work + rest : null : number(s.totalValidPunches);
  return clean({ required, effective, qualified: verdict(s.isMonthlyQualified) });
}
function clean(s) { return { required: number(s && s.required), effective: number(s && s.effective), qualified: verdict(s && s.qualified) }; }
function view(s) {
  const result = clean(s);
  const complete = result.required !== null && result.effective !== null;
  return { ...result, hasStats: result.required !== null || result.effective !== null || result.qualified !== null, complete,
    requiredText: result.required === null ? '—' : result.required, effectiveText: result.effective === null ? '—' : result.effective,
    remaining: complete ? Math.max(0, result.required - result.effective) : null,
    percent: complete && result.required > 0 ? Math.min(100, Math.round(result.effective / result.required * 100)) : 0,
    status: result.qualified === null ? '待判定' : result.qualified ? '合格' : '未达标' };
}
module.exports = { parse, clean, view };
