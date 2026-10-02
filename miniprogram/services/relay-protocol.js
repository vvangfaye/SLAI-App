// School redirects and cookies travel inside JSON, never as HTTP redirects.
const PROTOCOL = 'slai-relay-v1';
const RELAY_ORIGIN = 'https://slai-api.wangfaye.cn';
const RELAY_URL = `${RELAY_ORIGIN}/_slai/relay`;
const RESPONSE_HEADERS = ['location', 'set-cookie', 'content-type'];
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
function connectionError(details) {
  const text = details && typeof details.errMsg === 'string' ? details.errMsg : '';
  const nativeCode = ['ERR_CONNECTION_RESET', 'ERR_CONNECTION_CLOSED', 'ERR_CONNECTION_REFUSED', 'ERR_CONNECTION_TIMED_OUT', 'ERR_TIMED_OUT', 'ERR_NAME_NOT_RESOLVED', 'ERR_CERT_AUTHORITY_INVALID', 'ERR_CERT_COMMON_NAME_INVALID', 'ERR_CERT_DATE_INVALID', 'ERR_SSL_PROTOCOL_ERROR', 'ERR_SSL_VERSION_OR_CIPHER_MISMATCH', 'ERR_INTERNET_DISCONNECTED', 'ERR_NETWORK_CHANGED', 'ERR_NETWORK_ACCESS_DENIED', 'ERR_ACCESS_DENIED', 'ERR_FAILED'].find(code => text.toUpperCase().includes(code));
  const number = /(?:errcode|cronet_error_code)\s*[:=]\s*(-?\d{1,4})\b|request:fail\s+(-?\d{1,4})\b/i.exec(text);
  const nativeNumber = number ? Number(number[1] || number[2]) : undefined;
  let code = 'RELAY_CONNECTION_FAILED';
  let message = '无法连接登录中转服务，请切换 Wi-Fi 或移动数据后检查连接';
  if (/url not in domain list|not in.*domain|合法域名/i.test(text)) {
    code = 'RELAY_DOMAIN_NOT_ALLOWED';
    message = `微信未允许访问中转域名，请确认 request 合法域名包含 ${RELAY_ORIGIN}，并重新扫码最新版`;
  } else if (/ssl|tls|certificate|cert_|证书/i.test(text)) {
    code = 'RELAY_TLS_ERROR';
    message = '手机与中转服务的 HTTPS 连接失败，请管理员检查证书与公网连接';
  } else if (/timeout|timed[ _]out|超时/i.test(text)) {
    code = 'RELAY_TIMEOUT';
    message = '连接登录中转服务超时，请切换网络后重试';
  } else if (/dns|resolve|name_not_resolved|域名解析/i.test(text)) {
    code = 'RELAY_DNS_ERROR';
    message = '当前网络无法解析中转域名，请切换网络后重试';
  } else if (/connection_(?:reset|closed)|connection (?:reset|closed)/i.test(text)) {
    code = 'RELAY_CONNECTION_RESET';
    message = '手机与中转服务的连接被关闭，请切换网络后检查连接';
  }
  // Never echo the native error text: it can contain URLs, tokens or headers.
  const errno = details && Number.isSafeInteger(details.errno) ? details.errno : undefined;
  const error = relayError(`${message}（${code}${nativeCode ? `，${nativeCode}` : ''}${nativeNumber === undefined ? '' : `，原生码 ${nativeNumber}`}${errno === undefined ? '' : `，微信码 ${errno}`}）`, code);
  if (errno !== undefined) error.errno = errno;
  if (nativeCode) error.nativeCode = nativeCode;
  if (nativeNumber !== undefined) error.nativeNumber = nativeNumber;
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
    return RESPONSE_HEADERS.includes(name) && (typeof h[key] === 'string' || (name === 'set-cookie' && Array.isArray(h[key]) && h[key].every(line => typeof line === 'string')));
  });
  if (response.statusCode !== 200 || !Number.isInteger(envelope.statusCode) || envelope.statusCode < 200 || envelope.statusCode > 599 || !validHeaders || typeof envelope.data !== 'string') {
    throw relayError('登录中转响应格式异常，已停止请求', 'RELAY_PROTOCOL_ERROR');
  }
  return { statusCode: envelope.statusCode, header: h, data: envelope.data };
}
module.exports = { PROTOCOL, RELAY_ORIGIN, RELAY_URL, RESPONSE_HEADERS, MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES, ERROR_MESSAGES, decodeResponse, connectionError };
