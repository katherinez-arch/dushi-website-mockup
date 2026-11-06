'use strict';
// Prueba de punta a punta: VELARIS de prueba + backend del sitio. Uso: npm test
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const MP = 4110; const WP = 4100;
const MOCK = `http://127.0.0.1:${MP}`; const WEB = `http://127.0.0.1:${WP}`;
const env = { ...process.env, VELARIS_PORT: String(MP), PORT: String(WP), VELARIS_URL: MOCK, VELARIS_LOG: '0', VELARIS_RESERVA_MIN: '0.05', STOCK_POLL_MS: '600000' };
const procs = ['velaris-mock.js', 'web-backend.js'].map((f) => spawn(process.execPath, [f], { cwd: __dirname, env, stdio: ['ignore', 'ignore', 'inherit'] }));
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const J = async (url, o = {}) => { const r = await fetch(url, o); let b = null; try { b = await r.json(); } catch { /* */ } return { status: r.status, body: b, headers: r.headers }; };
let tok; let n = 0;
const H = (idem) => ({ Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json', ...(idem ? { 'Idempotency-Key': idem } : {}) });
const post = (p, b, idem) => J(MOCK + '/api/v1' + p, { method: 'POST', headers: H(idem), body: JSON.stringify(b) });
const get = (p) => J(MOCK + '/api/v1' + p, { headers: H() });
const disp = async (sku, cod) => (await get('/existencias?skus=' + sku)).body.items[0].variantes.find((v) => v.codigo === cod).disponible;
const ok = (m) => console.log('  ✓ ' + m);
const prueba = async (nombre, fn) => { n++; console.log(`\n${nombre}`); await fn(); };

(async () => {
  for (let i = 0; i < 50; i++) { try { await fetch(MOCK + '/_mock/kardex'); await fetch(WEB + '/api/salud'); break; } catch { await dormir(100); } }
  await dormir(600);
  const CAM = 'DSH-CAM-001-M'; const MAL = 'RUM-MAL-001-ÚNICA';

  await prueba('1. Autenticación y permisos', async () => {
    assert.equal((await J(MOCK + '/api/v1/auth/token', { method: 'POST', body: JSON.stringify({ clientId: 'x', clientSecret: 'y' }) })).status, 401); ok('credenciales malas → 401');
    assert.equal((await J(MOCK + '/api/v1/productos')).status, 401); ok('sin token → 401');
    const t = await J(MOCK + '/api/v1/auth/token', { method: 'POST', body: JSON.stringify({ clientId: 'dushi-web-test', clientSecret: 'secreto-de-prueba-no-usar-en-produccion' }) });
    assert.equal(t.status, 200); tok = t.body.access_token; ok('token JWT emitido');
    assert.equal((await J(MOCK + '/api/v1/facturas', { headers: H() })).status, 404); ok('la API no expone facturación');
  });

  await prueba('2. Catálogo y existencias', async () => {
    const p = await get('/productos?pageSize=100'); assert.equal(p.body.total, 8); ok('8 productos');
    assert.equal((await get('/productos?categoria=Accesorios')).body.total, 2); ok('filtro por categoría');
    assert.equal((await get('/existencias?skus=NOEXISTE')).body.noEncontrados[0], 'NOEXISTE'); ok('SKU inexistente reportado');
  });

  await prueba('3. Reservas e idempotencia', async () => {
    assert.equal((await post('/reservas', { items: [{ sku: 'DSH-CAM-001', variante: CAM, cantidad: 1 }] })).status, 400); ok('escritura sin Idempotency-Key → 400');
    const antes = await disp('DSH-CAM-001', CAM);
    const a = await post('/reservas', { items: [{ sku: 'DSH-CAM-001', variante: CAM, cantidad: 2 }] }, 'k-1');
    const b = await post('/reservas', { items: [{ sku: 'DSH-CAM-001', variante: CAM, cantidad: 2 }] }, 'k-1');
    assert.equal(a.status, 201); assert.equal(a.body.id, b.body.id); assert.equal(b.headers.get('idempotent-replay'), 'true'); ok('mismo Idempotency-Key = misma reserva');
    assert.equal(await disp('DSH-CAM-001', CAM), antes - 2); ok('el reintento no apartó dos veces');
    assert.equal((await J(MOCK + '/api/v1/reservas/' + a.body.id, { method: 'DELETE', headers: H('k-2') })).status, 200);
    assert.equal(await disp('DSH-CAM-001', CAM), antes); ok('liberar la reserva devuelve la existencia');
    const c = await post('/reservas', { items: [{ sku: 'DSH-CAM-001', variante: CAM, cantidad: 1 }] }, 'k-3');
    await dormir(3400);
    assert.equal(await disp('DSH-CAM-001', CAM), antes); assert.ok(c.body.id); ok('la reserva vence sola');
  });

  await prueba('4. Última unidad: dos compradores a la vez', async () => {
    const [x, y] = await Promise.all([
      post('/reservas', { items: [{ sku: 'RUM-MAL-001', variante: MAL, cantidad: 2 }] }, 'u-1'),
      post('/reservas', { items: [{ sku: 'RUM-MAL-001', variante: MAL, cantidad: 2 }] }, 'u-2'),
    ]);
    assert.deepEqual([x.status, y.status].sort(), [201, 409]); ok('solo uno se lleva la existencia (maleta: 3 en bodega)');
    const perdedor = x.status === 409 ? x : y; assert.equal(perdedor.body.error.codigo, 'SIN_EXISTENCIA');
    await J(MOCK + '/api/v1/reservas/' + (x.status === 201 ? x : y).body.id, { method: 'DELETE', headers: H('u-3') });
  });

  await prueba('5. Ticket: precio, descuento de inventario, duplicados y anulación', async () => {
    const antes = await disp('DSH-CAM-001', CAM);
    const r = await post('/reservas', { items: [{ sku: 'DSH-CAM-001', variante: CAM, cantidad: 2 }] }, 't-r');
    const base = { numeroPedido: 'WEB-TEST-1', reservaId: r.body.id, cliente: { nombre: 'Ana', correo: 'ana@correo.com' }, formaPago: { tipo: 'tarjeta', referencia: 'REF1' } };
    const mal = await post('/tickets', { ...base, lineas: [{ sku: 'DSH-CAM-001', variante: CAM, cantidad: 2, precioUnitario: 1 }] }, 't-1');
    assert.equal(mal.status, 422); assert.equal(mal.body.error.codigo, 'PRECIO_DISTINTO'); ok('precio distinto al vigente → 422');
    const t = await post('/tickets', { ...base, lineas: [{ sku: 'DSH-CAM-001', variante: CAM, cantidad: 2, precioUnitario: 24 }] }, 't-2');
    assert.equal(t.status, 201); assert.equal(t.body.total, 48); ok('ticket registrado, total 48.00');
    assert.equal(await disp('DSH-CAM-001', CAM), antes - 2); ok('el inventario se descontó una sola vez');
    const rep = await post('/tickets', { ...base, lineas: [{ sku: 'DSH-CAM-001', variante: CAM, cantidad: 2, precioUnitario: 24 }] }, 't-2');
    assert.equal(rep.headers.get('idempotent-replay'), 'true'); assert.equal(await disp('DSH-CAM-001', CAM), antes - 2); ok('reintento del ticket no duplica nada');
    const dup = await post('/tickets', { ...base, reservaId: undefined, lineas: [{ sku: 'DSH-CAM-001', variante: CAM, cantidad: 1, precioUnitario: 24 }] }, 't-3');
    assert.equal(dup.status, 409); ok('mismo número de pedido con otra llave → 409');
    const an = await post('/tickets/WEB-TEST-1/anular', {}, 't-4');
    assert.equal(an.body.estado, 'anulado'); assert.equal(await disp('DSH-CAM-001', CAM), antes); ok('anular regresa las existencias');
    const r2 = await post('/reservas', { items: [{ sku: 'DSH-CAM-001', variante: CAM, cantidad: 1 }] }, 't-r2');
    await post('/tickets', { ...base, numeroPedido: 'WEB-TEST-2', reservaId: r2.body.id, lineas: [{ sku: 'DSH-CAM-001', variante: CAM, cantidad: 1, precioUnitario: 24 }] }, 't-5');
    await J(MOCK + '/_mock/facturar/WEB-TEST-2', { method: 'POST' });
    const f = await post('/tickets/WEB-TEST-2/anular', {}, 't-6');
    assert.equal(f.status, 409); assert.equal(f.body.error.codigo, 'TICKET_FACTURADO'); ok('un ticket facturado ya no se anula');
  });

  await prueba('6. Backend del sitio', async () => {
    const s = await J(WEB + '/api/salud'); assert.equal(s.body.productos, 8); ok('/api/salud: 8 productos en caché');
    const c = await J(WEB + '/api/catalogo'); assert.equal(c.body.productos.length, 8);
    const chu = c.body.productos.find((p) => p.sku === 'ALT-CHU-001');
    assert.equal(chu.etiqueta, '−17%'); assert.deepEqual(chu.tallas, ['S', 'M', 'L']); assert.ok(chu.planes.includes('montana')); ok('catálogo con descuento, tallas y plan/género');
    assert.ok(!JSON.stringify(c.body).includes('secreto')); ok('ninguna credencial viaja al navegador');
    const before = (await J(WEB + '/api/stock')).body.stock['DSH-GOR-001'].disponible;
    const res = await J(WEB + '/api/reservas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [{ sku: 'DSH-GOR-001', cantidad: 1 }] }) });
    assert.equal(res.status, 201); ok('reserva desde el sitio');
    const bad = await J(WEB + '/api/pedidos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reservaId: res.body.id, lineas: [{ sku: 'DSH-GOR-001', cantidad: 1 }], cliente: { nombre: 'Luis', correo: 'no-es-correo' } }) });
    assert.equal(bad.status, 400); ok('correo inválido → 400');
    const ped = await J(WEB + '/api/pedidos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reservaId: res.body.id, lineas: [{ sku: 'DSH-GOR-001', cantidad: 1, precioUnitario: 0.01 }], cliente: { nombre: 'Luis', correo: 'luis@correo.com' } }) });
    assert.equal(ped.status, 201); assert.match(ped.body.numeroPedido, /^WEB-/); assert.equal(ped.body.total, 19); ok('pedido creado; el precio lo puso VELARIS (19.00), no el navegador');
    await dormir(400);
    assert.equal((await J(WEB + '/api/stock')).body.stock['DSH-GOR-001'].disponible, before - 1); ok('el stock del sitio se actualizó tras la venta');
    assert.equal((await J(WEB + '/api/pedidos/' + ped.body.numeroPedido)).body.estado, 'registrado'); ok('estado del pedido consultable');
    assert.equal((await fetch(WEB + '/index.html')).status, 200); ok('sirve el sitio');
    assert.equal((await fetch(WEB + '/server/web-backend.js')).status, 404); assert.equal((await fetch(WEB + '/server/data/products.json')).status, 404); ok('no expone la carpeta server');
    assert.equal((await fetch(WEB + '/%2e%2e/%2e%2e/etc/hosts')).status, 404); ok('bloquea rutas fuera del sitio');
  });

  console.log(`\n✔ ${n} grupos de pruebas pasaron`);
})().then(() => { procs.forEach((p) => p.kill()); process.exit(0); }).catch((e) => { console.error('\n✘ FALLÓ:', e.message); console.error(e.stack.split('\n').slice(1, 4).join('\n')); procs.forEach((p) => p.kill()); process.exit(1); });
