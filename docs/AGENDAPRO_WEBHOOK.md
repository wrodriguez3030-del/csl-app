# Webhook de Pagos de AgendaPro — csl-app

> Estado: **backend implementado y verificado** (52 tests en memoria + 12 E2E en
> vivo contra db-cls). Pendiente: panel Admin, activar en producción (env vars).

Sistema que recibe los **pagos** de AgendaPro y los convierte en compras/paquetes
de sesiones + consentimiento pendiente dentro de csl-app, de forma **idempotente**
y **aislada por tenant**. NO reemplaza al webhook de **clientes** existente
(`/api/integrations/agendapro/webhook`), que queda intacto.

## Endpoint

```
POST /api/integrations/agendapro/payments?token=<AGENDAPRO_WEBHOOK_SECRET>
GET  /api/integrations/agendapro/payments        (health-check, sin secretos)
```

- **Auth**: `?token=` debe igualar `AGENDAPRO_WEBHOOK_SECRET` (comparación en tiempo
  constante). Si AgendaPro envía `x-agendapro-signature`, se valida HMAC-SHA256 del
  body con el mismo secreto.
- **Content-Type**: `application/json`. Tamaño máx: 512 KB. Rate-limit básico por IP.
- **Respuestas** (§19): `200 processed` · `200 already_processed` · `202 requires_mapping`
  · `400 invalid` · `401 auth` · `429 rate` · `500 error`. Nunca stack traces ni PII.

## Variables de entorno

| Variable | Uso | Obligatoria |
|---|---|---|
| `AGENDAPRO_WEBHOOK_SECRET` | Secreto del `?token=` (y clave HMAC) | **Sí** (activar) |
| `AGENDAPRO_WEBHOOK_ENABLED` | `false` deshabilita el endpoint (default `true`) | No |
| `AGENDAPRO_LOG_PAYLOADS` | `true` guarda el payload completo (protegido) en el evento | No |
| `AGENDAPRO_DEFAULT_TENANT_ID` | business_id fallback para eventos sin sucursal mapeada (default = business `csl`) | No |
| `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Acceso service-role a db-cls | **Sí** |

> Ningún secreto va en el código ni en Git. Configurar en Vercel (Production) y en
> `.env.local` para desarrollo.

## Arquitectura

```
route.ts  →  processAgendaProPayment(payload, repo)  →  createSupabaseRepo() → db-cls
             (lib/server/agendapro-payments.ts)
             usa lógica pura de agendapro-payments-core.ts
```

- **`lib/server/agendapro-payments-core.ts`** — funciones puras (sin DB): validación,
  extracción de servicios (`bookings/mock_bookings/memberships/products/giftcards`),
  transacciones/recibos, normalización, `service_identifier`, máscaras PII, fecha RD.
- **`lib/server/agendapro-payments.ts`** — orquestador + `AgendaProPaymentRepo`
  (interfaz inyectable). Implementación real = `createSupabaseRepo` (service-role).
- **`app/api/integrations/agendapro/payments/route.ts`** — HTTP + seguridad.

## Tablas (migración `202607250001_agendapro_treatments_domain.sql`, aplicada a db-cls)

| Tabla | Rol |
|---|---|
| `csl_agendapro_location_map` | `location_id` AgendaPro → sucursal interna (+ tenant). UNIQUE(`agendapro_location_id`). |
| `csl_agendapro_service_map` | nombre de servicio → servicio/categoría/consentimiento + `sessions_quantity`. UNIQUE(`business_id`,`normalized_service_name`). |
| `csl_agendapro_webhook_events` | bitácora idempotente. UNIQUE(`business_id`,`agendapro_payment_id`). |
| `csl_paquetes` | ledger de compras (sesiones adquiridas/disponibles). UNIQUE parcial(`business_id`,`agendapro_payment_id`,`service_identifier`). |
| `csl_cesiones` | cesión de sesiones entre clientes. |
| `csl_consent_depilacion_laser` (+cols) | `origen`,`paquete_id`,`agendapro_payment_id`,`service_identifier` para el consentimiento pendiente. |

Todas con `business_id` + RLS (`current_business_id()`/`is_superadmin()`) + grants a `service_role`.

## Flujo de procesamiento

1. **Tenant por `location_id`** vía `csl_agendapro_location_map`. Sin mapeo → `requires_mapping`, se registra el evento pero NO se crea cliente/compra.
2. **Idempotencia**: si el evento (tenant, `payment_id`) ya está `processed` → `already_processed`.
3. **Cliente** (dedup, scoped al tenant, en orden): `agendapro_client_id` → correo → teléfono (con/sin código país, últimos 10) → cédula. Si no existe, se crea; nombres en MAYÚSCULAS; **nunca** pisa un cliente de otro tenant que comparta la clave global `cliente_id` (se sufija).
4. **Servicios**: combina `bookings/mock_bookings/memberships/products/giftcards`. Cada servicio se mapea (normalizado) vía `csl_agendapro_service_map`. Sin mapeo → paquete con `requiere_revision=true`, sin consentimiento.
5. **Compra**: fila en `csl_paquetes` (`sesiones_disponibles == sesiones_adquiridas`; **NUNCA consume**, §17). Guarda método de pago, factura, recibo, transacción, montos, fecha (UTC + fecha RD).
6. **Consentimiento pendiente**: para `depilacion-laser`, fila en `csl_consent_depilacion_laser` con `estado='Pendiente'`, `origen='AgendaPro'`, ligada al paquete. Idempotente por (tenant, pago, servicio).

## Idempotencia y aislamiento

- Idempotencia por `payment.id`: reenviar el mismo pago no duplica cliente/compra/consentimiento (200 `already_processed`).
- Aislamiento: toda búsqueda incluye `business_id`. El mismo correo/teléfono/cédula puede existir en Cibao y Depicenter sin mezclarse.

## Privacidad (§23)

- Logs con cédula/teléfono/correo **enmascarados** (`402******44`, `******2179`, `j*****a@gmail.com`).
- El payload completo solo se guarda si `AGENDAPRO_LOG_PAYLOADS=true`, en `payload_json` (solo service_role / superadmin).

## Pruebas

```bash
pnpm test:agendapro                                  # 52 casos en memoria (§24)
node --import tsx scripts/_e2e-agendapro-webhook-live.mjs   # 12 E2E en vivo (con limpieza)
```

## Configurar el webhook en AgendaPro (§29.14)

1. Definir `AGENDAPRO_WEBHOOK_SECRET` (≥16 chars) en Vercel (Production) y `.env.local`.
2. En AgendaPro, apuntar el webhook de **pagos** a:
   `https://<dominio-csl>/api/integrations/agendapro/payments?token=<AGENDAPRO_WEBHOOK_SECRET>`
3. Verificar con `GET` al mismo endpoint (`webhookConfigured: true`).
4. Registrar los mapeos de sucursal (`location_id`) y servicio en Administración →
   Integración AgendaPro (pendiente de UI; hoy se siembran vía migración/SQL).

## Probar con el JSON real (§29.15)

Usar el fixture del pago `58431059` (en `scripts/test-agendapro-webhook.mjs`). En vivo,
`scripts/_e2e-agendapro-webhook-live.mjs` lo procesa contra db-cls y **limpia** las filas
de prueba al terminar.
