# AgendaPro — Referencia de la API Pública (para integrar en otro sistema)

Guía práctica y **verificada con datos reales** para conectarte a la API pública
de AgendaPro y traer **pagos, clientes, reservas y servicios**. Pensada para
integrar AgendaPro en cualquier sistema (Node, PHP, Python, etc.).

> Documentación oficial: <https://developers.agendapro.com/reference/getting-started-with-your-api>
> Ayuda: <https://ayuda.agendapro.com/es/articles/6541935-api-publica-para-que-y-como-usarla>

---

## 1. Base URL y autenticación

- **Base URL:** `https://agendapro.com/api/public/v1`
- **Autenticación:** **HTTP Basic Auth** — `Authorization: Basic base64(usuario:contraseña)`
- **Credenciales:** están en AgendaPro → **Configuración → Integraciones → API Pública**
  (campos `USER` y `PASSWORD`). Las MISMAS credenciales sirven para consultar la API
  y para recibir webhooks.
- **Siempre HTTPS.**

```bash
# Ejemplo con curl (reemplaza USUARIO y PASSWORD)
curl -u "USUARIO:PASSWORD" \
  "https://agendapro.com/api/public/v1/payments?filters[start_date]=2026-07-01&filters[end_date]=2026-07-27&page=1&per_page=100"
```

```js
// Node (fetch)
const auth = Buffer.from(`${USER}:${PASSWORD}`).toString("base64")
const res = await fetch(
  "https://agendapro.com/api/public/v1/payments?filters[start_date]=2026-07-01&filters[end_date]=2026-07-27&page=1&per_page=100",
  { headers: { Accept: "application/json", Authorization: `Basic ${auth}` } },
)
const data = await res.json()
```

### Límites (rate limit)
- **1.000 consultas por día por local** (plan Pro). Cada llamada cuenta.
- Recomendación: consultar por rango de fecha corto y **saltar lo ya procesado**
  para no gastar cuota (ver "Receta de integración").

---

## 2. Endpoints principales

| Acción | Método | Endpoint | Doc |
|---|---|---|---|
| **Listar pagos** | GET | `/payments` | [ver-pagos](https://developers.agendapro.com/reference/ver-pagos) |
| **Ver un pago** | GET | `/payments/{id}` | [ver-un-pago](https://developers.agendapro.com/reference/ver-un-pago) |
| **Crear un pago** | POST | `/payments` | [crear-un-pago](https://developers.agendapro.com/reference/crear-un-pago) |
| **Listar clientes** | GET | `/clients` (o `/clients?search=`) | — |
| **Listar reservas** | GET | `/bookings` | [ver-reservas](https://developers.agendapro.com/reference/ver-reservas) |
| **Servicios por prestador** | GET | `/providers/{id}/services` | [listar-servicios](https://developers.agendapro.com/reference/listar-servicios-para-un-prestador) |
| **Horas disponibles** | GET | (según servicio) | [horas-disponibles](https://developers.agendapro.com/reference/listar-horas-disponibles-para-un-servicio) |

> Los paths exactos de reservas/servicios pueden variar por versión; confírmalos en la
> doc oficial. **Pagos y clientes están verificados.**

---

## 3. Pagos — Listar (`GET /payments`)

### Parámetros (query string)
| Parámetro | Tipo | Descripción |
|---|---|---|
| `filters[start_date]` | `YYYY-MM-DD` | Fecha inicial del rango |
| `filters[end_date]` | `YYYY-MM-DD` | Fecha final del rango |
| `filters[location_id]` | número | Filtrar por local/sucursal |
| `filters[client_id]` | número | Filtrar por cliente |
| `filters[provider_id]` | número | Filtrar por prestador |
| `filters[service_id]` | número | Filtrar por servicio |
| `filters[status_id]` | número | Filtrar por estado |
| `page` | número | Página (default 1) |
| `per_page` | número | Resultados por página (default 20, **máx 100**) |

> **Nota:** el formato `filters[campo]=valor` (estilo Rails) está **verificado** —
> es el que usa nuestra integración funcionando.

La respuesta es un arreglo (o un objeto que lo envuelve, p. ej. `{ "payments": [...] }`).
Cada elemento es un **objeto Pago** (ver §5). Para el detalle completo y garantizado,
pide `GET /payments/{id}`.

---

## 4. Pagos — Ver uno (`GET /payments/{id}`)

Devuelve el **objeto Pago completo** (misma forma que §5). Es la fuente autoritativa.

---

## 5. Estructura del objeto **Pago** (verificada con datos reales)

```jsonc
{
  "id": 58431059,                       // ID único del pago (idempotencia)
  "payment_date": "2026-05-05T18:33:00.000Z", // UTC (ISO 8601)
  "location_id": 3586,                  // sucursal (mapea a tu sucursal interna)
  "location_name": "Cibao Spa Laser  Av. Rafael Vidal ",
  "amount": 2000,
  "paid_amount": 2000,
  "change_amount": 0,
  "employee_code_id": null,
  "employee_code_name": "",

  "client": {
    "id": 44453171,
    "first_name": "NOMBRE",
    "last_name": "APELLIDO",
    "email": "correo@ejemplo.com",
    "identification_number": "00000000000", // cédula
    "phone": "+18290000000",
    "second_phone": "",
    "age": 22,
    "birth_day": 10, "birth_month": 3, "birth_year": 2003,
    "record_number": "8290000000",
    "address": "DIRECCIÓN",
    "district": "SANTIAGO",
    "city": "SANTIAGO"
  },

  // El servicio comprado puede venir en CUALQUIERA de estos arreglos:
  "bookings": [],        // reservas/citas reales
  "mock_bookings": [     // servicios comprados SIN reserva previa (¡muy común!)
    {
      "service": "Depilación Láser  1 sesión",
      "price": 2000,
      "discount": 0,
      "provider": null,
      "payment_id": 58431059,
      "receipt_id": 68886125
    }
  ],
  "memberships": [],     // planes/membresías
  "products": [          // productos de venta (ej. cremas)
    // { "name": "RADIOCARE CREMA", "price": 900, ... }
  ],
  "giftcards": [],       // gift cards

  "down_payments": [     // formas de pago (puede haber varias transacciones)
    {
      "payment_transactions": [
        {
          "number": "2105",
          "amount": 2000,
          "installments": 0,
          "payment_method": "Tarjeta ",
          "payment_method_type": "",
          "bank": ""
        }
      ]
    }
  ],

  "receipts": [          // comprobantes (facturas/recibos)
    {
      "id": 68886125,
      "amount": 2000,
      "date": "2026-05-05",
      "number": "B020000005810",
      "receipt_type": "Factura"
    }
  ]
}
```

### Reglas importantes al parsear
- **El servicio NO siempre está en `bookings`.** Si `bookings` está vacío, el
  servicio suele estar en **`mock_bookings[].service`** (venta sin cita). Combina
  siempre: `bookings + mock_bookings + memberships + products + giftcards`.
- **Nombres de servicio con espacios dobles y acentos** → normaliza (minúsculas,
  quitar acentos, colapsar espacios, trim) antes de comparar/mapear.
- **`receipt_id`** en el item enlaza con `receipts[].id` para obtener nº de factura
  y tipo de comprobante.
- **Método de pago** viene en `down_payments[].payment_transactions[].payment_method`
  (puede haber varias transacciones; la suma debe cuadrar con `paid_amount`).
- **Fechas** en UTC → convierte a tu zona (RD = `America/Santo_Domingo`, UTC-4).

---

## 6. Clientes (`GET /clients`)

- `GET /clients?search={término}` — búsqueda por nombre/teléfono/etc.
- `GET /clients` — listado (paginado).
- Campos del cliente: los mismos del objeto `client` de §5 (`id`, `first_name`,
  `last_name`, `email`, `identification_number`, `phone`, `second_phone`,
  `birth_day/month/year`, `address`, `district`, `city`, `record_number`).

---

## 7. Receta de integración recomendada (pull de pagos)

AgendaPro tiene webhooks, **pero pueden no dispararse de forma fiable** para todos
los tipos de pago. El método robusto es **jalar por API**:

1. **Listar** los pagos del rango: `GET /payments?filters[start_date]=…&filters[end_date]=…&page=1&per_page=100`. Pagina hasta que una página traiga < `per_page`.
2. Por cada pago, si **ya lo procesaste** (guarda los `payment.id` procesados), **sáltalo** (no gastes cuota en el detalle).
3. Si es nuevo, pide el detalle: `GET /payments/{id}`.
4. **Idempotencia:** usa `payment.id` como clave única. Reenviar/reprocesar el mismo pago NO debe duplicar nada. Recomendado: `UNIQUE (tenant_id, payment_id)`.
5. **Multi-negocio:** resuelve el tenant/sucursal por **`location_id`** (mapea `location_id` → tu sucursal). Nunca mezcles negocios por nombre.
6. **No consumas sesiones al pagar.** Un pago = compra; la sesión se consume cuando se realiza el tratamiento.
7. **Automatiza** con un cron cada X minutos (ventana ayer+hoy) o un botón manual.

### Truco útil: "N sesiones" en el nombre
Servicios como `Depilación Láser N sesiones` traen la cantidad en el nombre.
Extrae el número con `/(\d+)\s*sesion/i` y úsalo como sesiones compradas — así no
tienes que mapear cada variante (1, 2, 4, 5, 10, 20, 50, 100…).

---

## 8. Webhooks (alternativa/complemento)

AgendaPro → **Integraciones → Webhooks → Crear Webhook** → pega una URL (el campo
ya trae `https://`). Enviará POST con el payload de §5. Doc:
<https://developers.agendapro.com/reference/getting-started-with-your-api-1>

Seguridad recomendada en tu receptor: secreto compartido en la URL o header,
validación de tamaño/content-type, idempotencia por `payment.id`, y **responder
rápido** (200) para que AgendaPro no reintente.

> Si ves que el webhook **no llega** (0 solicitudes con pagos reales), usa el
> **pull por API** de §7 — no dependes de que AgendaPro dispare.

---

## 9. Códigos de respuesta típicos
- `200` OK · `401` credenciales inválidas · `404` no encontrado · `422` parámetros inválidos · `429` límite de cuota.

---

*Referencia construida y verificada contra datos reales de la API de pagos de
AgendaPro (julio 2026). Los ejemplos usan valores genéricos — sin datos reales de
clientes.*
