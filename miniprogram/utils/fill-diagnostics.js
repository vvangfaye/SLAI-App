const fields = ['username', 'password'];
const events = ['focus', 'blur', 'input', 'change', 'submit'];

// Only presence flags enter the trace. Never retain values, lengths or event objects.
function record(trace, field, type, value) {
  if (!fields.includes(field) || !events.includes(type)) return;
  const hasValue = typeof value === 'string' && value.length > 0;
  const last = trace[trace.length - 1];
  // Coalesce repeated keystrokes so the trace does not expose typed character counts.
  if (last && last.field === field && last.type === type && last.hasValue === hasValue) return;
  trace.push({ field, type, hasValue });
  if (trace.length > 24) trace.shift();
}
function readTrace(encoded) {
  try {
    const input = JSON.parse(decodeURIComponent(encoded || ''));
    if (!Array.isArray(input)) return [];
    return input.slice(-24).filter(row => row && fields.includes(row.field) && events.includes(row.type) && typeof row.hasValue === 'boolean')
      .map(({ field, type, hasValue }) => ({ field, type, hasValue }));
  } catch (_) { return []; }
}
function describe(trace) {
  return trace.length ? trace.map(row => `${row.field === 'username' ? '账号' : '密码'} ${row.type}: ${row.hasValue ? '有值' : '空'}`).join('\n') : '未收到输入事件';
}
function available() {
  try { return ['develop', 'trial'].includes(wx.getAccountInfoSync().miniProgram.envVersion); }
  catch (_) { return false; }
}
module.exports = { record, readTrace, describe, available };
