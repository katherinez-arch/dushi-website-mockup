# Servidor de prueba VELARIS + backend del sitio

Sin dependencias: solo Node 20 o superior.

```bash
cd server
npm run dev     # VELARIS de prueba en :4010 y el sitio con su backend en :4000
npm test        # prueba de punta a punta (30 verificaciones)
```

Abre http://127.0.0.1:4000. El catálogo, los precios y las existencias salen de VELARIS (de prueba).
Si abres `index.html` sin el backend, el sitio muestra el catálogo de ejemplo.

## Piezas

| Archivo | Qué es |
|---|---|
| `velaris-mock.js` | Imita la API de VELARIS según la propuesta del 31/10/2026: `auth/token`, `productos`, `existencias`, `existencias/cambios`, `reservas`, `movimientos`, `tickets` (+ anular). Alcances, `Idempotency-Key` obligatorio en escrituras, 120 solicitudes/min, firma HMAC opcional, reservas que vencen a los 15 min y bitácora. Todo en memoria. |
| `data/products.json` | Inventario de ejemplo (8 productos con tallas). Reemplazable. |
| `web-backend.js` | Capa entre el navegador y VELARIS. Guarda las credenciales, mantiene caché del catálogo y consulta cambios de existencias cada 30 s. Sirve el sitio y expone `/api/catalogo`, `/api/stock`, `/api/reservas`, `/api/pedidos`. |
| `catalog-meta.json` | Lo que VELARIS no sabe: plan (playa, montaña…), género, foto y etiqueta de cada SKU. |
| `test.js` | Pruebas: permisos, reintentos sin duplicar, última unidad con dos compradores, precio, anulación, y el flujo del sitio. |

Ayudas que existen **solo en el mock**: `POST /_mock/facturar/{pedido}` (simula que el personal factura el ticket), `POST /_mock/reset`, `GET /_mock/bitacora`, `GET /_mock/kardex`.

## Pasar al VELARIS real

1. Pedir a VELARIS la URL de pruebas, el Client ID y el Client Secret.
2. Exportar `VELARIS_URL`, `VELARIS_CLIENT_ID` y `VELARIS_CLIENT_SECRET` (ver `.env.example`) y correr solo `npm run web`.
3. Si VELARIS activa la firma, `VELARIS_SIGN=1`.
4. Si usan lista blanca de IP, el backend debe correr en un servidor con IP fija.
5. Completar `catalog-meta.json` con los SKU reales (o acordar categorías en VELARIS que lo reemplacen).

## Pendiente (no está hecho)

- Pasarela de pago real: `cobrar()` en `web-backend.js` es una simulación que siempre aprueba.
- Carrito y checkout en la interfaz (hoy «Agregar» solo suma el contador).
- Autenticación para consultar pedidos, y datos de Crédito Fiscal (NIT, NRC) si se piden en el checkout.
- Entregas: la propuesta de VELARIS las deja fuera.
