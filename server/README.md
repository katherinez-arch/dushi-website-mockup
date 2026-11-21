# Servidor de prueba VELARIS + backend del sitio

Sin dependencias: solo Node 20 o superior.

```bash
cd server
npm run dev            # VELARIS de prueba (propuesta del 31/10) en :4010 y el sitio con su backend en :4000
npm run dev:catalogo   # VELARIS de prueba con la forma de la API REAL en :4011 (catálogo + facturas) y el sitio en :4000
npm test               # prueba de punta a punta (48 verificaciones)
```

Abre http://127.0.0.1:4000. El catálogo, los precios y las existencias salen de VELARIS (de prueba).
Si abres `index.html` sin el backend, el sitio muestra el catálogo de ejemplo.

## Piezas

| Archivo | Qué es |
|---|---|
| `velaris-mock.js` | Imita la API de VELARIS según la propuesta del 31/10/2026: `auth/token`, `productos`, `existencias`, `existencias/cambios`, `reservas`, `movimientos`, `tickets` (+ anular). Alcances, `Idempotency-Key` obligatorio en escrituras, 120 solicitudes/min, firma HMAC opcional, reservas que vencen a los 15 min y bitácora. Todo en memoria. |
| `velaris-catalogo-mock.js` | Imita la API REAL de VELARIS (developers.velarisapp.com): token, catálogo con variantes y facturación (`/invoices`). 4 productos de ejemplo. Las facturas son de mentira: nada llega a Hacienda. |
| `data/products.json` | Inventario de ejemplo (8 productos con tallas). Reemplazable. |
| `web-backend.js` | Capa entre el navegador y VELARIS. Guarda las credenciales, mantiene caché del catálogo y consulta cambios cada 30 s. Sirve el sitio y expone `/api/catalogo`, `/api/stock`, `/api/reservas`, `/api/pedidos`. |
| `catalog-meta.json` | Lo que VELARIS no sabe: plan (playa, montaña…), género, foto y etiqueta de cada SKU. |
| `test.js` | Pruebas: permisos, reintentos sin duplicar, última unidad con dos compradores, precio, anulación, el flujo del sitio y la facturación con la API real. |

Ayudas que existen **solo en `velaris-mock.js`**: `POST /_mock/facturar/{pedido}` (simula que el personal factura el ticket), `POST /_mock/reset`, `GET /_mock/bitacora`, `GET /_mock/kardex`.

Ayudas que existen **solo en `velaris-catalogo-mock.js`**: `POST /_mock/hacienda {"modo":"acepta"|"pendiente"|"rechaza"}`, `POST /_mock/aceptar-pendientes`, `POST /_mock/anular/{numeroPedido}`, `GET /_mock/facturas`, `POST /_mock/reset`.

## VELARIS real

La API que entregó VELARIS (https://developers.velarisapp.com/?lang=es) tiene **catálogo** (productos y categorías, sin cantidades: solo si hay o no hay) y **facturación**. No tiene reservas. El backend la detecta sola cuando `VELARIS_URL` apunta a `velarisapp.com` (o con `VELARIS_API=catalogo`):

```bash
cp .env.example .env   # y completar VELARIS_URL=https://velarisapi.velarisapp.com, Client ID y Client Secret
npm run web            # lee server/.env si no hay variables exportadas
```

> **Con las credenciales reales, cada pedido es una factura REAL ante Hacienda** y descuenta el inventario real.
> Para probar el checkout usa `npm run dev:catalogo`, que no toca VELARIS ni Hacienda.

- Plan = categoría de VELARIS (PLAYA, MONTAÑA, VIAJE). Género = atributo GENERO de las variantes.
- Disponibilidad: VELARIS solo dice si hay o no hay, así que el sitio no muestra «Quedan N».
- Fotos: se usa la marcada como principal. Si un producto no tiene, se puede poner `imagen` por SKU en `catalog-meta.json`; sin foto sale el icono del plan.
- **Precio por variante:** algunas variantes valen distinto que su producto (por ejemplo, tallas de una sandalia de $30 que valen $25). `/api/catalogo` trae `variantes[].precio`: el carrito debe mostrar ese, porque es el que se factura.
- `/api/reservas` responde 501 en este modo.

## Facturación: cómo llama el checkout al backend

### `POST /api/pedidos`

El backend cobra (hoy la pasarela es simulada), manda el pedido a VELARIS y responde con la factura. **El navegador no manda precios**: VELARIS pone los del catálogo.

```json
{
  "claveOrden": "8f0c2a4e-…",
  "tipo": "01",
  "lineas": [
    { "sku": "TOALLA-RAYAS", "variante": "TOALLA-RAYAS-FAM-AZUL", "cantidad": 2 },
    { "sku": "PULSERA-MADERA", "cantidad": 1 }
  ],
  "cliente": {
    "nombre": "Ana Pérez",
    "correo": "ana@correo.com",
    "telefono": "77778888",
    "tipoDocumento": "13",
    "documento": "04567890-3",
    "direccion": { "departamento": "06", "municipio": "23", "distrito": "03", "detalle": "Calle El Mirador #45, Col. Escalón" }
  }
}
```

- `claveOrden`: un `crypto.randomUUID()` que el checkout genera **una vez** al abrirse y reusa si el cliente vuelve a apretar «Pagar». Con la misma clave nunca sale una segunda factura ni un segundo cobro. Después de una compra que salió bien, la siguiente compra lleva una clave nueva.
- `tipo`: `"01"` factura (consumidor final, el normal) o `"03"` crédito fiscal (empresas).
- `lineas[].variante`: el `codigo` de la variante elegida (talla, color), el mismo que guarda el carrito. Si el producto tiene una sola variante se puede omitir.
- `cliente` para la **01**: `tipoDocumento` (13 DUI, 02 carnet de residente, 03 pasaporte, 36 NIT, 37 otro; si no se manda, DUI) y `documento`.
- `cliente` para la **03**: en lugar de documento, `nit`, `nrc`, `actividad` (código de actividad económica, CAT-019) y opcional `nombreComercial`; `nombre` es la razón social. En la 03 los precios van sin IVA más 13 %, así que el total cambia unos centavos.
- `direccion`: códigos de Hacienda de departamento (CAT-012), municipio (CAT-013) y distrito, más la dirección escrita. El checkout necesita listas para escogerlos.

Respuesta **201** (aceptada por Hacienda) o **202** (pendiente: Hacienda no respondió y VELARIS reintenta sola):

```json
{
  "numeroPedido": "WEB-3F9A1C2B7D4E5F60",
  "estado": "aceptada",
  "tipo": "01",
  "total": 27,
  "factura": { "numeroControl": "DTE-01-M001P901-000000000000001", "codigoGeneracion": "9F7F…", "consultaHacienda": "https://admin.factura.gob.sv/consultaPublica?…", "fecha": "2026-11-21T…" },
  "lineas": [{ "sku": "TOALLA-RAYAS-FAM-AZUL", "nombre": "…", "cantidad": 2, "precioUnitario": 12, "total": 24 }]
}
```

Al cliente le llega la factura por correo. `consultaHacienda` es la consulta pública (la misma del QR del PDF).

Errores: `{ "numeroPedido": "…", "error": { "codigo", "mensaje", "campo"?, "producto"?, "detalle"? } }`. `mensaje` ya viene listo para mostrar.

| HTTP | `codigo` | Qué pasó |
|---|---|---|
| 400 | `DATOS_DE_FACTURA` | Falta o está mal un dato del cliente; `campo` dice cuál (`cliente.documento`, `cliente.direccion`, `cliente.nrc`…). No se cobró. |
| 400 | `FALTA_VARIANTE` | Un producto con tallas o colores sin elegir; `producto.sku` dice cuál. No se cobró. |
| 404 | `SKU_NO_EXISTE`, `VARIANTE_NO_EXISTE` | El carrito tiene algo que ya no está en el catálogo. No se cobró. |
| 409 | `OUT_OF_STOCK` | Se agotó `producto` (sku y variante). No se facturó y el cobro se reversa. |
| 422 | `TOTAL_MISMATCH` | Los precios cambiaron; `detalle` trae el total de VELARIS. No se facturó y el cobro se reversa. |
| 422 | `HACIENDA_REJECTED` | Hacienda rechazó; `detalle` trae el motivo. Se corrige y se reenvía con la **misma** `claveOrden`. |
| 503 | `FACTURA_SIN_CONFIRMAR` | Se cobró pero VELARIS no respondió. No reintentar con otra clave: consultar `GET /api/pedidos/{numeroPedido}`. |

### `GET /api/pedidos/{numeroPedido}`

Devuelve lo mismo que el POST con el estado actual: `aceptada`, `pendiente`, `rechazada` o `anulada` (la empresa la invalidó en VELARIS). No muestra datos del cliente.

## Pasar al VELARIS de la propuesta

1. Pedir a VELARIS la URL de pruebas, el Client ID y el Client Secret.
2. Exportar `VELARIS_URL`, `VELARIS_CLIENT_ID` y `VELARIS_CLIENT_SECRET` (ver `.env.example`) y correr solo `npm run web`.
3. Si VELARIS activa la firma, `VELARIS_SIGN=1`.
4. Si usan lista blanca de IP, el backend debe correr en un servidor con IP fija.
5. Completar `catalog-meta.json` con los SKU reales (o acordar categorías en VELARIS que lo reemplacen).

## Pendiente (no está hecho)

- Pasarela de pago real: `cobrar()` y `reversarCobro()` en `web-backend.js` son simulaciones. Con la real conviene autorizar, facturar y capturar; si la factura no sale, liberar la autorización.
- Checkout en la interfaz: el carrito ya existe (`assets/cart.js`), pero «Finalizar compra» todavía solo avisa que el pago llega pronto; falta el formulario con los datos de facturación y conectarlo a `POST /api/pedidos`.
- Envío: VELARIS lo factura como un producto más; Dushi tiene que crearlo en VELARIS como servicio y publicarlo en el catálogo.
- Crédito fiscal (03): probado solo contra el VELARIS de prueba. Con gran contribuyente VELARIS retiene 1 % arriba de $100 y el total no cuadra (`TOTAL_MISMATCH`).
- Autenticación para consultar pedidos.
