// School redirects and cookies travel inside JSON, never as HTTP redirects.
const PROTOCOL = 'slai-relay-v1';
const RELAY_URL = 'https://openslai.cn/_slai/relay';
const MAX_REQUEST_BYTES = 256 * 1024;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const ERROR_MESSAGES = {
  UPSTREAM_TLS_ERROR: '中转服务无法验证学校证书，请检查服务器证书信任链',
  UPSTREAM_TIMEOUT: '学校响应超时，请稍后重试',
  UPSTREAM_UNAVAILABLE: '中转服务暂时无法连接学校，请检查校园网络通道',
  RESPONSE_TOO_LARGE: '学校响应超过中转接口限制，未覆盖本地数据',
  BAD_REQUEST: '中转请求格式不正确，请更新小程序与服务器',
  REQUEST_TOO_LARGE: '中转请求超过接口限制'
};
function relayError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}
function decodeResponse(response) {
  let envelope;
  try { envelope = typeof response.data === 'string' ? JSON.parse(response.data) : response.data; } catch (_) { /* reject below */ }
  if (!envelope || envelope.protocol !== PROTOCOL) {
    throw relayError(response.statusCode >= 500 ? '登录中转服务暂时不可用，请检查服务器' : '代理登录接口尚未部署或版本不匹配，请先更新服务器', response.statusCode >= 500 ? 'RELAY_UNAVAILABLE' : 'RELAY_UPGRADE_REQUIRED');
  }
  if (envelope.error && Object.prototype.hasOwnProperty.call(ERROR_MESSAGES, envelope.error.code)) {
    throw relayError(ERROR_MESSAGES[envelope.error.code], envelope.error.code);
  }
  const h = envelope.header;
  const validHeaders = h && typeof h === 'object' && !Array.isArray(h) && Object.keys(h).every(key => {
    const name = key.toLowerCase();
    return ['location', 'content-type', 'set-cookie'].includes(name) && (typeof h[key] === 'string' || (name === 'set-cookie' && Array.isArray(h[key]) && h[key].every(line => typeof line === 'string')));
  });
  if (response.statusCode !== 200 || !Number.isInteger(envelope.statusCode) || envelope.statusCode < 200 || envelope.statusCode > 599 || !validHeaders || typeof envelope.data !== 'string') {
    throw relayError('登录中转响应格式异常，已停止请求', 'RELAY_PROTOCOL_ERROR');
  }
  return { statusCode: envelope.statusCode, header: h, data: envelope.data };
}
module.exports = { PROTOCOL, RELAY_URL, MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES, ERROR_MESSAGES, decodeResponse };
