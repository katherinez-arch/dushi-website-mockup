'use strict';
/**
 * Servidor de PRUEBA que imita la API REST de VELARIS (propuesta técnica del 31/10/2026).
 * Sirve para desarrollar y probar el sitio de Dushi antes de recibir el ambiente sandbox real.
 * Todo vive en memoria: al reiniciar, el inventario vuelve a los datos de data/products.json.
 *
 * Implementa: auth/token, productos, existencias, existencias/cambios, reservas, movimientos y tickets,
 * con alcances (scopes), Idempotency-Key, límite de 120 solicitudes/min, firma HMAC opcional y bitácora.
 */
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.VELARIS_PORT || 4010);
const CLIENT_ID = process.env.VELARIS_CLIENT_ID || 'dushi-web-test';
const CLIENT_SECRET = process.env.VELARIS_CLIENT_SECRET || 'secreto-de-prueba-no-usar-en-produccion';
const JWT_KEY = crypto.randomBytes(32);
const TOKEN_TTL = 15 * 60; // segundos
const RESERVA_MIN = Number(process.env.VELARIS_RESERVA_MIN || 15);
const RATE_LIMIT = Number(process.env.VELARIS_RATE_LIMIT || 120);
const REQUIRE_SIGNATURE = process.env.VELARIS_REQUIRE_SIGNATURE === '1';
const SCOPES = ['inventario.leer', 'inventario.escribir', 'tickets.crear'];

/* ---------- datos ---------- */
const productos = new Map(); // sku -> producto
const kardex = [];
const reservas = new Map(); // id -> reserva
const tickets = new Map(); // numeroPedido -> ticket
const idem = new Map(); // `${credencial}:${key}` -> {status, body, hash}
const bitacora = [];
const now = () => new Date().toISOString();

function cargar() {
  productos.clear();
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'products.json'), 'utf8'));
  for (const p of raw) productos.set(p.sku, { ...p, modificado: now() });
}
cargar();

/* ---------- utilidades ---------- */
const b64 = (b) => Buffer.from(b).toString('base64url');
const sign = (s) => crypto.createHmac('sha256', JWT_KEY).update(s).digest('base64url');
function emitirToken() {
  const payload = b64(JSON.stringify({ sub: CLIENT_ID, scope: SCOPES, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL }));
  return `${payload}.${sign(payload)}`;
}
function leerToken(tok) {
  const [p, s] = String(tok || '').split('.');
  if (!p || !s) return null;
  const esperado = Buffer.from(sign(p)); const dado = Buffer.from(s);
  if (esperado.length !== dado.length || !crypto.timingSafeEqual(esperado, dado)) return null;
  const data = JSON.parse(Buffer.from(p, 'base64url').toString());
  return data.exp * 1000 > Date.now() ? data : null;
}
function send(res, status, body, headers = {}) {
  const txt = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(txt), ...headers });
  res.end(txt);
  return status;
}
const err = (res, status, codigo, mensaje, extra = {}) => send(res, status, { error: { codigo, mensaje, ...extra } });
function leerCuerpo(req) {
  return new Promise((ok, fail) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 1e6) { req.destroy(); fail(new Error('cuerpo muy grande')); } });
    req.on('end', () => ok(raw));
    req.on('error', fail);
  });
}

/* ---------- inventario ---------- */
function purgarReservas() {
  const t = Date.now();
  for (const [id, r] of reservas) if (new Date(r.vence).getTime() <= t) { reservas.delete(id); tocar(r.items.map((i) => i.sku)); }
}
const tocar = (skus) => skus.forEach((s) => { const p = productos.get(s); if (p) p.modificado = now(); });
function reservado(variante) {
  let n = 0;
  for (const r of reservas.values()) for (const i of r.items) if (i.variante === variante) n += i.cantidad;
  return n;
}
function varianteDe(sku, codigo) {
  const p = productos.get(sku);
  if (!p) return { error: 'SKU_NO_EXISTE' };
  const v = codigo ? p.variantes.find((x) => x.codigo === codigo) : (p.variantes.length === 1 ? p.variantes[0] : null);
  if (!v) return { error: codigo ? 'VARIANTE_NO_EXISTE' : 'VARIANTE_REQUERIDA' };
  return { p, v };
}
const disponibleVar = (p, v) => Math.max(0, v.fisica - reservado(v.codigo) - (p.variantes.length === 1 ? p.stockSeguridad : 0));
function existencia(p) {
  const variantes = p.variantes.map((v) => ({
    codigo: v.codigo, talla: v.talla, color: v.color,
    fisica: v.fisica, reservada: reservado(v.codigo), disponible: disponibleVar(p, v),
  }));
  return { sku: p.sku, bodega: p.bodega, disponible: variantes.reduce((a, v) => a + v.disponible, 0), variantes, modificado: p.modificado };
}
function vistaProducto(p) {
  return {
    sku: p.sku, nombre: p.nombre, marca: p.marca, categoria: p.categoria,
    precio: p.precio, precioAnterior: p.precioAnterior || null, moneda: 'USD', precioIncluyeIVA: true,
    variantes: p.variantes.map((v) => ({ codigo: v.codigo, talla: v.talla, color: v.color })),
    imagen: null, modificado: p.modificado,
  };
}
function movimiento(p, v, tipo, cantidad, motivo, documento) {
  v.fisica += tipo === 'entrada' ? cantidad : -cantidad;
  p.modificado = now();
  const m = { id: 'MOV-' + String(kardex.length + 1).padStart(6, '0'), fecha: now(), sku: p.sku, variante: v.codigo, tipo, cantidad, motivo, documento };
  kardex.push(m);
  return m;
}

/* ---------- handlers ---------- */
const rutas = [];
const ruta = (metodo, patron, scope, fn, opts = {}) => rutas.push({ metodo, re: new RegExp('^' + patron.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '/?$'), scope, fn, ...opts });

ruta('GET', '/api/v1/productos', 'inventario.leer', ({ q, res }) => {
  purgarReservas();
  const page = Math.max(1, Number(q.get('page') || 1));
  const pageSize = Math.min(100, Math.max(1, Number(q.get('pageSize') || 50)));
  const cat = (q.get('categoria') || '').toLowerCase(); const busca = (q.get('q') || '').toLowerCase();
  const desde = q.get('modificadoDesde');
  let lista = [...productos.values()].filter((p) =>
    (!cat || p.categoria.toLowerCase() === cat) &&
    (!busca || (p.nombre + ' ' + p.marca + ' ' + p.sku).toLowerCase().includes(busca)) &&
    (!desde || p.modificado > desde));
  const total = lista.length;
  lista = lista.slice((page - 1) * pageSize, page * pageSize).map(vistaProducto);
  return send(res, 200, { page, pageSize, total, items: lista });
});
ruta('GET', '/api/v1/productos/:sku', 'inventario.leer', ({ params, res }) => {
  const p = productos.get(decodeURIComponent(params.sku));
  return p ? send(res, 200, vistaProducto(p)) : err(res, 404, 'SKU_NO_EXISTE', 'No existe ese SKU.');
});
ruta('GET', '/api/v1/existencias', 'inventario.leer', ({ q, res }) => {
  purgarReservas();
  const skus = (q.get('skus') || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!skus.length) return err(res, 400, 'SKUS_REQUERIDOS', 'Indica ?skus=A,B,C');
  return send(res, 200, { items: skus.map((s) => productos.get(s)).filter(Boolean).map(existencia), noEncontrados: skus.filter((s) => !productos.has(s)) });
});
ruta('GET', '/api/v1/existencias/cambios', 'inventario.leer', ({ q, res }) => {
  purgarReservas();
  const desde = q.get('desde');
  if (!desde || Number.isNaN(Date.parse(desde))) return err(res, 400, 'DESDE_INVALIDO', 'Indica ?desde=2026-11-01T10:00:00Z');
  const items = [...productos.values()].filter((p) => p.modificado > new Date(desde).toISOString()).map(existencia);
  return send(res, 200, { desde, hasta: now(), items });
});

ruta('POST', '/api/v1/reservas', 'inventario.escribir', ({ body, res }) => {
  purgarReservas();
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) return err(res, 400, 'ITEMS_REQUERIDOS', 'Envía items: [{ sku, variante, cantidad }].');
  const resueltos = [];
  const faltan = [];
  const acumulado = {};
  for (const it of items) {
    const cant = Number(it.cantidad);
    if (!Number.isInteger(cant) || cant < 1) return err(res, 400, 'CANTIDAD_INVALIDA', `Cantidad inválida para ${it.sku}.`);
    const r = varianteDe(it.sku, it.variante);
    if (r.error) return err(res, 404, r.error, `${r.error} (${it.sku})`);
    acumulado[r.v.codigo] = (acumulado[r.v.codigo] || 0) + cant;
    resueltos.push({ sku: it.sku, variante: r.v.codigo, cantidad: cant, p: r.p, v: r.v });
  }
  for (const r of resueltos) {
    const disp = disponibleVar(r.p, r.v);
    if (acumulado[r.v.codigo] > disp && !faltan.find((f) => f.variante === r.v.codigo)) faltan.push({ sku: r.sku, variante: r.v.codigo, solicitado: acumulado[r.v.codigo], disponible: disp });
  }
  if (faltan.length) return err(res, 409, 'SIN_EXISTENCIA', 'No hay existencia suficiente.', { faltantes: faltan });
  const id = 'RES-' + crypto.randomBytes(5).toString('hex').toUpperCase();
  const vence = new Date(Date.now() + RESERVA_MIN * 60000).toISOString();
  const r = { id, creada: now(), vence, referencia: body.referencia || null, items: resueltos.map(({ sku, variante, cantidad }) => ({ sku, variante, cantidad })) };
  reservas.set(id, r);
  tocar(r.items.map((i) => i.sku));
  return send(res, 201, r);
}, { idem: true });
ruta('DELETE', '/api/v1/reservas/:id', 'inventario.escribir', ({ params, res }) => {
  const r = reservas.get(params.id);
  if (!r) return err(res, 404, 'RESERVA_NO_EXISTE', 'La reserva no existe o ya venció.');
  reservas.delete(params.id); tocar(r.items.map((i) => i.sku));
  return send(res, 200, { id: r.id, liberada: true });
}, { idem: true });

ruta('POST', '/api/v1/movimientos', 'inventario.escribir', ({ body, res }) => {
  const { sku, variante, tipo, cantidad, motivo, documento } = body;
  if (!['entrada', 'salida'].includes(tipo)) return err(res, 400, 'TIPO_INVALIDO', 'tipo debe ser "entrada" o "salida". La web no escribe existencias absolutas.');
  if (!motivo || !documento) return err(res, 400, 'MOTIVO_Y_DOCUMENTO', 'Todo movimiento lleva motivo y documento de respaldo.');
  const cant = Number(cantidad);
  if (!Number.isInteger(cant) || cant < 1) return err(res, 400, 'CANTIDAD_INVALIDA', 'cantidad debe ser un entero mayor a 0.');
  const r = varianteDe(sku, variante);
  if (r.error) return err(res, 404, r.error, r.error);
  purgarReservas();
  if (tipo === 'salida' && cant > disponibleVar(r.p, r.v)) return err(res, 409, 'SIN_EXISTENCIA', 'La salida excede la existencia disponible.');
  return send(res, 201, movimiento(r.p, r.v, tipo, cant, motivo, documento));
}, { idem: true });

ruta('POST', '/api/v1/tickets', 'tickets.crear', ({ body, res }) => {
  purgarReservas();
  const { numeroPedido, cliente, lineas, formaPago, reservaId } = body;
  if (!numeroPedido) return err(res, 400, 'PEDIDO_REQUERIDO', 'numeroPedido es obligatorio.');
  if (tickets.has(numeroPedido)) return err(res, 409, 'PEDIDO_DUPLICADO', 'Ya existe un ticket con ese número de pedido.');
  if (!cliente || !cliente.nombre || !cliente.correo) return err(res, 400, 'CLIENTE_INCOMPLETO', 'cliente.nombre y cliente.correo son el mínimo.');
  if (!formaPago || !formaPago.tipo || !formaPago.referencia) return err(res, 400, 'PAGO_REQUERIDO', 'formaPago.tipo y formaPago.referencia son obligatorios.');
  if (!Array.isArray(lineas) || !lineas.length) return err(res, 400, 'LINEAS_REQUERIDAS', 'El ticket necesita al menos una línea.');
  const res_ = reservaId ? reservas.get(reservaId) : null;
  if (reservaId && !res_) return err(res, 409, 'RESERVA_VENCIDA', 'La reserva venció o no existe. Vuelve a reservar antes de registrar el ticket.');
  const rs = [];
  for (const l of lineas) {
    const r = varianteDe(l.sku, l.variante);
    if (r.error) return err(res, 404, r.error, `${r.error} (${l.sku})`);
    if (Number(l.precioUnitario) !== r.p.precio) return err(res, 422, 'PRECIO_DISTINTO', `El precio de ${l.sku} es ${r.p.precio.toFixed(2)}, no ${l.precioUnitario}.`, { sku: l.sku, precioVigente: r.p.precio });
    rs.push({ ...l, r, cantidad: Number(l.cantidad) });
  }
  // Si hay reserva, la salida consume esa reserva; si no, debe haber disponible.
  if (res_) reservas.delete(reservaId);
  for (const l of rs) {
    if (!res_ && l.cantidad > disponibleVar(l.r.p, l.r.v)) return err(res, 409, 'SIN_EXISTENCIA', `Sin existencia para ${l.sku}.`);
  }
  for (const l of rs) movimiento(l.r.p, l.r.v, 'salida', l.cantidad, 'Venta web', numeroPedido);
  const subtotal = rs.reduce((a, l) => a + l.cantidad * l.precioUnitario - (Number(l.descuento) || 0), 0);
  const t = {
    numeroPedido, estado: 'registrado', creado: now(), cliente, formaPago,
    lineas: rs.map(({ sku, variante, cantidad, precioUnitario, descuento }) => ({ sku, variante: variante || null, cantidad, precioUnitario, descuento: Number(descuento) || 0 })),
    envio: Number(body.envio) || 0, total: Math.round((subtotal + (Number(body.envio) || 0)) * 100) / 100, dte: null,
  };
  tickets.set(numeroPedido, t);
  return send(res, 201, t);
}, { idem: true });
ruta('GET', '/api/v1/tickets/:n', 'tickets.crear', ({ params, res }) => {
  const t = tickets.get(decodeURIComponent(params.n));
  return t ? send(res, 200, t) : err(res, 404, 'TICKET_NO_EXISTE', 'No existe ese ticket.');
});
ruta('POST', '/api/v1/tickets/:n/anular', 'tickets.crear', ({ params, res }) => {
  const t = tickets.get(decodeURIComponent(params.n));
  if (!t) return err(res, 404, 'TICKET_NO_EXISTE', 'No existe ese ticket.');
  if (t.estado === 'facturado') return err(res, 409, 'TICKET_FACTURADO', 'Un ticket facturado ya no se puede anular desde la web.');
  if (t.estado === 'anulado') return send(res, 200, t);
  for (const l of t.lineas) { const r = varianteDe(l.sku, l.variante); if (!r.error) movimiento(r.p, r.v, 'entrada', l.cantidad, 'Anulación de ticket web', t.numeroPedido); }
  t.estado = 'anulado';
  return send(res, 200, t);
}, { idem: true });

/* ---------- ayudas SOLO del mock (no existen en VELARIS) ---------- */
ruta('POST', '/_mock/facturar/:n', null, ({ params, res }) => {
  const t = tickets.get(decodeURIComponent(params.n));
  if (!t) return err(res, 404, 'TICKET_NO_EXISTE', 'No existe ese ticket.');
  t.estado = 'facturado'; t.dte = { tipo: '01', numeroControl: 'DTE-01-' + crypto.randomBytes(4).toString('hex').toUpperCase() };
  return send(res, 200, t);
});
ruta('POST', '/_mock/reset', null, ({ res }) => { reservas.clear(); tickets.clear(); kardex.length = 0; idem.clear(); cargar(); return send(res, 200, { reiniciado: true }); });
ruta('GET', '/_mock/bitacora', null, ({ res }) => send(res, 200, { total: bitacora.length, items: bitacora.slice(-100) }));
ruta('GET', '/_mock/kardex', null, ({ res }) => send(res, 200, { items: kardex }));

/* ---------- servidor ---------- */
const ventanas = new Map(); // credencial -> [timestamps]
function limite(cred) {
  const t = Date.now(); const arr = (ventanas.get(cred) || []).filter((x) => t - x < 60000);
  arr.push(t); ventanas.set(cred, arr);
  return arr.length > RATE_LIMIT;
}

const server = http.createServer(async (req, res) => {
  const inicio = Date.now();
  const url = new URL(req.url, 'http://x');
  let status = 500; let cred = '-';
  try {
    if (req.method === 'POST' && url.pathname === '/api/v1/auth/token') {
      const raw = await leerCuerpo(req); let b = {};
      try { b = JSON.parse(raw || '{}'); } catch { /* vacío */ }
      if (b.clientId !== CLIENT_ID || b.clientSecret !== CLIENT_SECRET) status = err(res, 401, 'CREDENCIAL_INVALIDA', 'clientId o clientSecret incorrectos.');
      else status = send(res, 200, { access_token: emitirToken(), token_type: 'Bearer', expires_in: TOKEN_TTL, scope: SCOPES.join(' ') });
      cred = b.clientId || '-';
      return;
    }
    const m = rutas.find((r) => r.metodo === req.method && r.re.test(url.pathname));
    if (!m) { status = err(res, 404, 'RUTA_NO_EXISTE', `No existe ${req.method} ${url.pathname}`); return; }
    if (m.scope) {
      const tok = leerToken((req.headers.authorization || '').replace(/^Bearer /i, ''));
      if (!tok) { status = err(res, 401, 'TOKEN_INVALIDO', 'Falta el token o venció. Pide uno en POST /api/v1/auth/token.'); return; }
      cred = tok.sub;
      if (!tok.scope.includes(m.scope)) { status = err(res, 403, 'SIN_PERMISO', `Esta credencial no tiene el alcance ${m.scope}.`); return; }
      if (limite(cred)) { status = send(res, 429, { error: { codigo: 'LIMITE_EXCEDIDO', mensaje: `Máximo ${RATE_LIMIT} solicitudes por minuto.` } }, { 'Retry-After': '60' }); return; }
    }
    const raw = ['POST', 'PUT', 'DELETE'].includes(req.method) ? await leerCuerpo(req) : '';
    if (m.scope && REQUIRE_SIGNATURE && raw) {
      const firma = crypto.createHmac('sha256', CLIENT_SECRET).update(raw).digest('hex');
      if (req.headers['x-signature'] !== firma) { status = err(res, 401, 'FIRMA_INVALIDA', 'X-Signature no coincide con el cuerpo.'); return; }
    }
    let body = {};
    if (raw) { try { body = JSON.parse(raw); } catch { status = err(res, 400, 'JSON_INVALIDO', 'El cuerpo no es JSON válido.'); return; } }
    let clave = null; let hash = null;
    if (m.idem && m.scope) {
      const key = req.headers['idempotency-key'];
      if (!key) { status = err(res, 400, 'IDEMPOTENCY_KEY_REQUERIDA', 'Toda escritura necesita el encabezado Idempotency-Key.'); return; }
      clave = `${cred}:${key}`; hash = crypto.createHash('sha256').update(req.method + url.pathname + raw).digest('hex');
      const previo = idem.get(clave);
      if (previo) {
        if (previo.hash !== hash) { status = err(res, 422, 'IDEMPOTENCY_KEY_REUSADA', 'Esa Idempotency-Key ya se usó con otra solicitud.'); return; }
        status = send(res, previo.status, previo.body, { 'Idempotent-Replay': 'true' }); return;
      }
    }
    const grabar = res.end.bind(res); let cuerpoSalida = '';
    if (clave) {
      const w = res.write.bind(res);
      res.write = (c, ...a) => { cuerpoSalida += c; return w(c, ...a); };
      res.end = (c, ...a) => { if (c) cuerpoSalida += c; return grabar(c, ...a); };
    }
    const params = { ...(url.pathname.match(m.re)?.groups || {}) };
    const out = await m.fn({ req, res, body, q: url.searchParams, params });
    status = out || res.statusCode;
    if (clave && status < 300) idem.set(clave, { status, body: JSON.parse(cuerpoSalida || 'null'), hash });
  } catch (e) {
    status = err(res, 500, 'ERROR_INTERNO', 'Ocurrió un error inesperado.');
    console.error(e);
  } finally {
    const reg = { fecha: now(), credencial: cred, metodo: req.method, endpoint: url.pathname, estado: status, ms: Date.now() - inicio };
    bitacora.push(reg); if (bitacora.length > 2000) bitacora.shift();
    if (process.env.VELARIS_LOG !== '0') console.log(`[velaris-mock] ${reg.metodo} ${reg.endpoint} → ${reg.estado} (${reg.ms} ms)`);
  }
});

if (require.main === module) {
  server.listen(PORT, '127.0.0.1', () => console.log(`VELARIS mock escuchando en http://127.0.0.1:${PORT}  (clientId: ${CLIENT_ID})`));
}
module.exports = { server };
