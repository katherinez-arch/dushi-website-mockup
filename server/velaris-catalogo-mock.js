'use strict';
/**
 * VELARIS de prueba con la forma de la API REAL (https://developers.velarisapp.com):
 * token, catálogo y facturación. Sirve para probar el checkout sin mandar facturas a Hacienda.
 * Todo vive en memoria. Uso: npm run dev:catalogo (o node velaris-catalogo-mock.js).
 *
 * Ayudas que solo existen aquí:
 *   POST /_mock/hacienda {"modo":"acepta"|"pendiente"|"rechaza"}  cómo responde "Hacienda" a las nuevas facturas
 *   POST /_mock/aceptar-pendientes                                 las facturas pendientes pasan a aceptadas
 *   POST /_mock/anular/{orderNumber}                               simula que la empresa anula una factura
 *   GET  /_mock/facturas                                           todas las facturas creadas
 *   POST /_mock/reset                                              vuelve al estado inicial
 */
const http = require('node:http');
const crypto = require('node:crypto');

const PORT = Number(process.env.VELARIS_CATALOGO_PORT || 4011);
const CLIENT_ID = 'dushi-web-test';
const CLIENT_SECRET = 'secreto-de-prueba-no-usar-en-produccion';

const sinIva = (n) => Math.round((n / 1.13) * 100) / 100;
const precio = (n) => ({ amount: n, amountWithoutTax: sinIva(n), currency: 'USD', taxIncluded: true });
const variante = (sku, attrs, monto, stock, oferta) => ({
  id: crypto.randomUUID(), sku, barcode: null, name: sku, available: stock > 0, price: precio(monto), images: [],
  attributes: Object.entries(attrs).map(([name, value]) => ({ name, value })),
  ...(oferta ? { salePrice: { amount: oferta } } : {}), _stock: stock,
});
const producto = (sku, name, cat, monto, variants, oferta) => ({
  id: crypto.randomUUID(), sku, status: 'active', barcode: null, name, descriptionFormat: 'plain', description: '',
  available: variants.some((v) => v._stock > 0), price: precio(monto), ...(oferta ? { salePrice: { amount: oferta } } : {}),
  category: { code: cat, name: cat }, brand: { name: 'DUSHI' }, images: [], hasVariants: true, variants,
  updatedAt: new Date().toISOString(),
});

let productos; let facturas; let modoHacienda; let consecutivo;
function reset() {
  productos = [
    producto('TOALLA-RAYAS', 'TOALLA DE PLAYA RAYAS', 'PLAYA', 12, [
      variante('TOALLA-RAYAS-FAM-AZUL', { GENERO: 'FAMILIA', COLOR: 'AZUL' }, 12, 10),
      variante('TOALLA-RAYAS-FAM-ROJO', { GENERO: 'FAMILIA', COLOR: 'ROJO' }, 12, 10),
    ]),
    producto('PULSERA-MADERA', 'PULSERA AJUSTABLE MADERA', 'PLAYA', 3, [
      variante('PULSERA-MADERA-MUJER-BEIGE', { GENERO: 'MUJER', COLOR: 'BEIGE' }, 3, 50),
    ]),
    producto('CHUMPA-IMPER', 'CHUMPA IMPERMEABLE', 'MONTAÑA', 45, ['S', 'M', 'L'].map((t) =>
      variante('CHUMPA-IMPER-HOMBRE-' + t, { GENERO: 'HOMBRE', TALLA: t }, 45, 5, 39)), 39),
    producto('MALETA-MANO', 'MALETA DE MANO', 'VIAJE', 80, [
      variante('MALETA-MANO-FAM-NEGRO', { GENERO: 'FAMILIA', COLOR: 'NEGRO' }, 80, 1),
    ]),
  ];
  facturas = new Map(); modoHacienda = 'acepta'; consecutivo = 0;
}
reset();

const tokens = new Map();
const enviar = (res, status, body) => {
  const t = JSON.stringify(body); const requestId = 'req_' + crypto.randomBytes(12).toString('hex');
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'X-Request-Id': requestId });
  res.end(t);
};
const fallo = (res, status, code, message, field) => enviar(res, status, { error: { code, message, ...(field ? { field } : {}), retryable: status >= 500, requestId: 'req_' + crypto.randomBytes(12).toString('hex') } });
async function leer(req) { let raw = ''; for await (const c of req) raw += c; return raw ? JSON.parse(raw) : {}; }
// Lo que empieza con _ es interno del mock (existencias, huella del pedido) y no sale en las respuestas.
const publico = (p) => JSON.parse(JSON.stringify(p, (k, v) => (k.startsWith('_') ? undefined : v)));
const digitos = (v) => String(v ?? '').replace(/\D/g, '');
function duiValido(v) {
  const d = digitos(v); if (d.length !== 9) return false;
  let s = 0; for (let i = 0; i < 8; i++) s += Number(d[i]) * (9 - i);
  return (10 - (s % 10)) % 10 === Number(d[8]);
}
function buscarId(id) {
  for (const p of productos) {
    if (p.id === id) return { modelo: p };
    const v = p.variants.find((x) => x.id === id); if (v) return { variante: v };
  }
  return {};
}
// Devuelve [campo, mensaje] si algo falta o está mal, igual que la validación de VELARIS.
function validarCliente(tipo, c) {
  if (!c || typeof c !== 'object') return ['customer', 'customer is required'];
  const a = c.address || {};
  for (const k of ['department', 'municipality', 'district']) if (!/^\d{2}$/.test(a[k] || '')) return ['customer.address.' + k, k + ' must be a 2-digit code'];
  if (!a.line) return ['customer.address.line', 'line is required'];
  if (!c.name) return ['customer.name', 'name is required'];
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email || '')) return ['customer.email', 'email is not valid'];
  if (tipo === '01') {
    if (!['13', '02', '03', '36', '37'].includes(c.documentType)) return ['customer.documentType', 'documentType is not valid'];
    if (c.documentType === '13' && !duiValido(c.document)) return ['customer.document', 'DUI is not valid'];
    if (!c.document || String(c.document).length < 3 || String(c.document).length > 20) return ['customer.document', 'document is not valid'];
  } else {
    if (![9, 14].includes(digitos(c.nit).length) || /\D/.test(c.nit)) return ['customer.nit', 'nit must be 9 or 14 digits'];
    if (!/^\d{2,8}$/.test(c.nrc || '')) return ['customer.nrc', 'nrc must be 2 to 8 digits'];
    if (!c.activityCode) return ['customer.activityCode', 'activityCode is required'];
  }
  return null;
}

async function facturar(req, res) {
  const b = await leer(req);
  if (!/^[A-Za-z0-9\-_./#]{1,64}$/.test(b.orderNumber || '')) return fallo(res, 400, 'VALIDATION_ERROR', 'orderNumber is not valid', 'orderNumber');
  if (!['01', '03'].includes(b.documentType)) return fallo(res, 400, 'VALIDATION_ERROR', 'documentType must be 01 or 03', 'documentType');
  const huella = crypto.createHash('sha256').update(JSON.stringify(b)).digest('hex');
  const previa = facturas.get(b.orderNumber);
  if (previa) return previa._huella === huella ? enviar(res, 200, publico(previa)) : fallo(res, 409, 'ORDER_NUMBER_CONFLICT', 'orderNumber already used with different content', 'orderNumber');
  const mal = validarCliente(b.documentType, b.customer); if (mal) return fallo(res, 400, 'VALIDATION_ERROR', mal[1], mal[0]);
  if (!['01', '02', '03', '05', '08'].includes(b.paymentMethod)) return fallo(res, 400, 'VALIDATION_ERROR', 'paymentMethod is not valid', 'paymentMethod');
  if (!Array.isArray(b.items) || !b.items.length) return fallo(res, 400, 'VALIDATION_ERROR', 'items is required', 'items');
  // Un producto repetido en dos líneas se factura en una sola.
  const juntas = new Map();
  for (const [i, it] of b.items.entries()) {
    const q = Number(it?.quantity); if (!(q > 0)) return fallo(res, 400, 'VALIDATION_ERROR', 'quantity must be greater than 0', `items[${i}].quantity`);
    const { modelo, variante: v } = buscarId(it.productId);
    if (modelo) return fallo(res, 422, 'VARIANT_REQUIRED', 'Send the variant id, not the model id', `items[${i}].productId`);
    if (!v) return fallo(res, 422, 'PRODUCT_NOT_FOUND', 'Product not found', `items[${i}].productId`);
    juntas.set(v.id, { v, q: (juntas.get(v.id)?.q || 0) + q });
  }
  for (const { v, q } of juntas.values()) if (v._stock < q) return fallo(res, 409, 'OUT_OF_STOCK', `Not enough stock for ${v.sku}`, v.id);
  const lines = [...juntas.values()].map(({ v, q }) => {
    const conIva = v.salePrice?.amount ?? v.price.amount;
    const unit = b.documentType === '01' ? conIva : (v.salePrice ? sinIva(v.salePrice.amount) : v.price.amountWithoutTax);
    return { productId: v.id, sku: v.sku, name: v.name, quantity: q, unitPrice: unit, discount: 0, total: Math.round(unit * q * 100) / 100 };
  });
  const sub = lines.reduce((a, l) => a + Math.round(l.total * 100), 0);
  const iva = b.documentType === '01' ? Math.round(sub - sub / 1.13) : Math.round(sub * 0.13);
  const total = (b.documentType === '01' ? sub : sub + iva) / 100;
  if (Math.round(Number(b.expectedTotal) * 100) !== Math.round(total * 100)) return fallo(res, 422, 'TOTAL_MISMATCH', `Velaris total is ${total.toFixed(2)}`, 'expectedTotal');
  if (modoHacienda === 'rechaza') return fallo(res, 422, 'HACIENDA_REJECTED', 'Hacienda rechazó el documento: [mock] receptor no válido', null);
  for (const { v, q } of juntas.values()) { v._stock -= q; v.available = v._stock > 0; }
  const codGen = crypto.randomUUID().toUpperCase(); const hoy = new Date(Date.now() - 6 * 3600000).toISOString().slice(0, 10);
  const pendiente = modoHacienda === 'pendiente';
  const f = {
    id: crypto.randomUUID(), orderNumber: b.orderNumber, documentType: b.documentType, status: pendiente ? 'pending' : 'accepted',
    ...(pendiente ? { message: '[mock] Hacienda no respondió; se reintenta sola' } : {}),
    generationCode: codGen, controlNumber: `DTE-${b.documentType}-M001P901-${String(++consecutivo).padStart(15, '0')}`,
    receptionStamp: pendiente ? null : crypto.randomBytes(20).toString('hex').toUpperCase(),
    issuedAt: new Date().toISOString(), consultUrl: `https://admin.factura.gob.sv/consultaPublica?ambiente=00&codGen=${codGen}&fechaEmi=${hoy}`,
    customer: { name: b.customer.name, email: b.customer.email, ...(b.documentType === '01' ? { documentType: b.customer.documentType, document: digitos(b.customer.document) || b.customer.document } : { nit: b.customer.nit, nrc: b.customer.nrc }) },
    currency: 'USD', subtotal: sub / 100, discount: 0, tax: iva / 100, taxWithheld: 0, total, paymentMethod: b.paymentMethod, lines,
    createdAt: new Date().toISOString(), _huella: huella,
  };
  facturas.set(f.orderNumber, f);
  return enviar(res, pendiente ? 202 : 201, publico(f));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'); const p = url.pathname;
  try {
    // ----- ayudas del mock -----
    if (p === '/_mock/reset' && req.method === 'POST') { reset(); return enviar(res, 200, { ok: true }); }
    if (p === '/_mock/hacienda' && req.method === 'POST') { const b = await leer(req); modoHacienda = b.modo; return enviar(res, 200, { modo: modoHacienda }); }
    if (p === '/_mock/aceptar-pendientes' && req.method === 'POST') {
      for (const f of facturas.values()) if (f.status === 'pending') { f.status = 'accepted'; delete f.message; f.receptionStamp = crypto.randomBytes(20).toString('hex').toUpperCase(); }
      return enviar(res, 200, { ok: true });
    }
    let m;
    if (req.method === 'POST' && (m = p.match(/^\/_mock\/anular\/(.+)$/))) { const f = facturas.get(decodeURIComponent(m[1])); if (!f) return fallo(res, 404, 'NOT_FOUND', 'Invoice not found.'); f.status = 'voided'; return enviar(res, 200, publico(f)); }
    if (p === '/_mock/facturas') return enviar(res, 200, [...facturas.values()].map((f) => publico(f)));

    // ----- API -----
    if (req.method === 'POST' && p === '/api/oauth/token') {
      const b = await leer(req);
      if (b.clientId !== CLIENT_ID || b.clientSecret !== CLIENT_SECRET) return fallo(res, 401, 'INVALID_CLIENT', 'Invalid client credentials.');
      const t = crypto.randomBytes(24).toString('hex'); tokens.set(t, Date.now() + 1200000);
      return enviar(res, 200, { accessToken: t, tokenType: 'Bearer', expiresIn: 1200, scope: 'catalog invoices' });
    }
    const t = (req.headers.authorization || '').replace(/^Bearer /, '');
    if (!tokens.has(t) || tokens.get(t) < Date.now()) return fallo(res, 401, 'UNAUTHORIZED', 'Missing or expired token.');
    if (req.method === 'GET' && p === '/api/v1/catalog/products') {
      return enviar(res, 200, { data: productos.map(publico), hasMore: false, nextCursor: null, serverTime: new Date().toISOString() });
    }
    if (req.method === 'POST' && p === '/api/v1/invoices') return await facturar(req, res);
    if (req.method === 'GET' && p === '/api/v1/invoices') {
      const f = facturas.get(url.searchParams.get('orderNumber') || '');
      return f ? enviar(res, 200, publico(f)) : fallo(res, 404, 'NOT_FOUND', 'Invoice not found.');
    }
    if (req.method === 'GET' && (m = p.match(/^\/api\/v1\/invoices\/([\w-]+)$/))) {
      const f = [...facturas.values()].find((x) => x.id === m[1]);
      return f ? enviar(res, 200, publico(f)) : fallo(res, 404, 'NOT_FOUND', 'Invoice not found.');
    }
    return fallo(res, 404, 'NOT_FOUND', 'Route not found.');
  } catch (e) {
    return fallo(res, e instanceof SyntaxError ? 400 : 500, e instanceof SyntaxError ? 'INVALID_JSON' : 'INTERNAL_ERROR', e.message);
  }
});

if (require.main === module) server.listen(PORT, '127.0.0.1', () => console.log(`VELARIS de prueba (API real: catálogo + facturas) en http://127.0.0.1:${PORT}`));
module.exports = { server };
