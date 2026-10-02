'use strict';
// Stateless one-hop relay. No credential/session store or request logging.
const http = require('node:http');
const https = require('node:https');
const zlib = require('node:zlib');
const { urlParts, gatewayPath } = require('../miniprogram/services/login-probe');
const { PROTOCOL, RESPONSE_HEADERS, MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES } = require('../miniprogram/services/relay-protocol');
const REQUEST_HEADERS = ['cookie', 'content-type', 'accept', 'x-requested-with'];
function failure(code) { const error = new Error(code); error.code = code; return error; }
function validateRequest(payload) {
  if (!payload || payload.protocol !== PROTOCOL || !['GET', 'POST'].includes(payload.method) || typeof payload.url !== 'string' || payload.url.length > 16384 || typeof payload.data !== 'string' || (payload.method === 'GET' && payload.data !== '')) throw failure('BAD_REQUEST');
  let target;
  try { target = urlParts(payload.url); } catch (_) { throw failure('BAD_REQUEST'); }
  const supplied = payload.header;
  if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied)) throw failure('BAD_REQUEST');
  const headers = { 'accept-encoding': 'identity' };
  for (const name of Object.keys(supplied)) {
    const key = name.toLowerCase();
    if (!REQUEST_HEADERS.includes(key)) continue;
    if (typeof supplied[name] !== 'string' || /[\r\n\0]/.test(supplied[name])) throw failure('BAD_REQUEST');
    headers[key] = supplied[name];
  }
  return { hostname: target.host, path: target.url.slice(`https://${target.host}`.length), method: payload.method, headers, body: payload.data };
}
function collect(stream, limit, code) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    stream.on('data', chunk => {
      size += chunk.length;
      if (size > limit) {
        reject(failure(code));
        stream.destroy();
      } else chunks.push(chunk);
    });
    stream.once('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    stream.once('error', reject);
    stream.once('aborted', () => reject(failure('UPSTREAM_UNAVAILABLE')));
    stream.once('close', () => { if (!stream.readableEnded) reject(failure('UPSTREAM_UNAVAILABLE')); });
  });
}
function errorCode(error) {
  if (['BAD_REQUEST', 'REQUEST_TOO_LARGE', 'RESPONSE_TOO_LARGE', 'UPSTREAM_TIMEOUT'].includes(error.code)) return error.code;
  if (/CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER/.test(error.code || '')) return 'UPSTREAM_TLS_ERROR';
  return 'UPSTREAM_UNAVAILABLE';
}
function gatewayRequest(origin) {
  // This is a server-only setting for the existing local FRP visitor. Clients
  // cannot choose a gateway or an arbitrary upstream host.
  const match = /^http:\/\/127\.0\.0\.1:(\d{1,5})$/.exec(origin);
  if (!match || Number(match[1]) < 1 || Number(match[1]) > 65535) throw new Error('SLAI_RELAY_GATEWAY must be an HTTP loopback port');
  return (options, callback) => {
    const path = gatewayPath(`https://${options.hostname}${options.path}`);
    return http.request({ hostname: '127.0.0.1', port: Number(match[1]), path, method: options.method,
      headers: { ...options.headers, Host: 'openslai.cn' }, signal: options.signal }, callback);
  };
}
function oneHop(target, { request = https.request, timeoutMs = 20000, signal } = {}) {
  return new Promise((resolve, reject) => {
    let timer;
    const upstream = request({ hostname: target.hostname, servername: target.hostname, port: 443, path: target.path, method: target.method,
      headers: { ...target.headers, 'content-length': Buffer.byteLength(target.body) }, rejectUnauthorized: true, signal }, async response => {
      try {
        const header = {};
        for (const name of RESPONSE_HEADERS) if (response.headers[name] !== undefined) header[name] = response.headers[name];
        const encoding = String(response.headers['content-encoding'] || 'identity').toLowerCase();
        const decoder = encoding === 'gzip' ? zlib.createGunzip() : encoding === 'deflate' ? zlib.createInflate() : encoding === 'br' ? zlib.createBrotliDecompress() : null;
        if (encoding !== 'identity' && !decoder) throw failure('UPSTREAM_UNAVAILABLE');
        if (decoder) {
          response.once('error', error => decoder.destroy(error));
          response.once('aborted', () => decoder.destroy(failure('UPSTREAM_UNAVAILABLE')));
        }
        const data = await collect(decoder ? response.pipe(decoder) : response, MAX_RESPONSE_BYTES, 'RESPONSE_TOO_LARGE');
        resolve({ protocol: PROTOCOL, statusCode: response.statusCode, header, data });
      } catch (error) { reject(error); }
      finally { clearTimeout(timer); upstream.destroy(); }
    });
    upstream.once('error', error => { clearTimeout(timer); reject(error); });
    timer = setTimeout(() => { upstream.destroy(failure('UPSTREAM_TIMEOUT')); }, timeoutMs);
    upstream.end(target.body);
  });
}
function send(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(value));
}
function createRelayServer(options = {}) {
  const server = http.createServer(async (incoming, response) => {
    if (incoming.url === '/healthz' && incoming.method === 'GET') {
      send(response, 200, { protocol: PROTOCOL, ready: true });
      return;
    }
    // WeChat adds ?_wx_redirect=manual to the transport URL. The relay has no
    // query parameters; the school URL comes only from the validated JSON.
    if (incoming.url.split('?')[0] !== '/_slai/relay') { send(response, 404, { protocol: PROTOCOL, error: { code: 'BAD_REQUEST' } }); return; }
    if (incoming.method !== 'POST' || !/^application\/json(?:\s*;|$)/i.test(incoming.headers['content-type'] || '')) {
      send(response, 400, { protocol: PROTOCOL, error: { code: 'BAD_REQUEST' } });
      return;
    }
    const controller = new AbortController();
    response.once('close', () => { if (!response.writableEnded) controller.abort(); });
    try {
      // Keep oversized requests from being buffered or sent to school.
      if (Number(incoming.headers['content-length']) > MAX_REQUEST_BYTES) throw failure('REQUEST_TOO_LARGE');
      const raw = await collect(incoming, MAX_REQUEST_BYTES, 'REQUEST_TOO_LARGE');
      let payload;
      try { payload = JSON.parse(raw); } catch (_) { throw failure('BAD_REQUEST'); }
      const target = validateRequest(payload);
      const result = await oneHop(target, { ...options, signal: controller.signal });
      if (!response.destroyed) send(response, 200, result);
    } catch (error) {
      const code = errorCode(error);
      const status = code === 'BAD_REQUEST' ? 400 : code === 'REQUEST_TOO_LARGE' ? 413 : 200;
      if (!response.destroyed) send(response, status, { protocol: PROTOCOL, error: { code } });
    }
  });
  server.requestTimeout = 25000;
  server.headersTimeout = 10000;
  return server;
}
if (require.main === module) {
  const port = Number(process.env.SLAI_RELAY_PORT || 8787);
  const host = process.env.SLAI_RELAY_BIND || '127.0.0.1';
  const request = process.env.SLAI_RELAY_GATEWAY ? gatewayRequest(process.env.SLAI_RELAY_GATEWAY) : https.request;
  const server = createRelayServer({ request });
  server.on('error', () => { console.error('SLAI relay could not start. Check bind address and port.'); process.exitCode = 1; });
  server.listen(port, host, () => { console.log('SLAI relay ready.'); });
}
module.exports = { createRelayServer, validateRequest, gatewayRequest };
