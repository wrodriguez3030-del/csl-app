# Guía de operación — Integración AgendaPro (Control Digital de Tratamientos)

Guía práctica (no técnica) para el día a día. Solo la ven **admin/superadmin**.

## ¿Qué hace?
Cuando un cliente **paga en AgendaPro**, el pago llega solo a csl-app y se convierte en:
**cliente** → **compra (paquete de sesiones)** → **consentimiento pendiente de firma**.
La sesión **NO se descuenta** al pagar; solo cuando registras el tratamiento.

## Dónde está
- **Ver por cliente:** Menú → **Control Digital de Tratamientos**
- **Administrar:** Menú → **Administración → Integración AgendaPro**

---

## 1) Ver el control de un cliente
1. Menú → **Control Digital de Tratamientos**.
2. Botón **Cambiar cliente** → busca por nombre, teléfono o cédula.
3. Verás 5 tarjetas (disponibles · adquiridas · realizados · cedidas · firmas pendientes)
   y pestañas (Resumen, Sesiones, Actividad, Historial).
4. Los paquetes que llegaron por AgendaPro llevan la etiqueta **AgendaPro**.

## 2) Revisar los eventos (que todo entre bien)
**Administración → Integración AgendaPro → pestaña Eventos.**
Cada pago recibido aparece con un estado:
- 🟢 **processed** — procesado OK.
- 🟠 **requires_mapping** — falta mapear la **sucursal** o el **servicio** (ver pasos 3 y 4).
- 🔴 **failed** — hubo un error (abre **Ver** para el detalle).
- ⚪ **duplicate** — ya se había procesado (normal si AgendaPro reenvía; no duplica nada).

En la pestaña **Estado** ves el resumen: total, procesados, requieren mapeo, fallidos.

## 3) Mapear una SUCURSAL (cuando un evento dice "requiere mapeo")
1. Pestaña **Sucursales** → **Agregar**.
2. **location_id de AgendaPro**: el número que muestra el evento (columna "Location").
3. **Sucursal interna**: el nombre de tu sede (ej. `Rafael Vidal`, `Los Jardines`).
4. **Guardar**. (Es de una sola vez por cada sucursal.)

## 4) Mapear un SERVICIO (cuando un evento dice "requiere mapeo")
1. Pestaña **Servicios** → **Agregar**.
2. **Nombre del servicio en AgendaPro**: tal cual llega (ej. `Depilación Láser  1 sesión`).
3. **Servicio interno** y **Categoría**: cómo lo llamas tú.
4. **Consentimiento**: elige el tipo. *Depilación Láser* crea el consentimiento pendiente.
5. **Sesiones que otorga**: cuántas sesiones da ese servicio (ej. `1`).
6. **Guardar**. (De una sola vez por cada servicio.)

## 5) Reprocesar un evento
Después de agregar el mapeo que faltaba:
1. Ve a **Eventos**, busca el evento en 🟠/🔴.
2. Pulsa el botón **↻ (reprocesar)** de esa fila → ahora sí creará la compra + consentimiento.

> **Para que "reprocesar" funcione**, el sistema necesita haber guardado el pago. Pide
> activar la variable `AGENDAPRO_LOG_PAYLOADS=true` en Vercel (guarda el pago de forma
> **protegida**, solo visible para superadmin). Si está apagada, el botón avisará que no
> hay payload; en ese caso AgendaPro lo reintenta solo, o se vuelve a enviar el pago.

---

## Reglas de oro (para tu tranquilidad)
- 💳 **El pago NO consume la sesión** — eso pasa solo al registrar el tratamiento.
- 🔁 **Nunca se duplica** — reenviar el mismo pago no crea nada nuevo.
- 🏢 **Cibao y Depicenter nunca se mezclan** — se separan por `location_id`.
- 🔒 **Solo admin/superadmin** ven este panel; el pago completo (con datos personales)
  solo lo ve superadmin.

## Si algo falla
- **Un pago no aparece** → míralo en *Eventos*. Si dice **requires_mapping**, agrega el
  mapeo (paso 3 o 4) y **reprocesa** (paso 5).
- **Varios "failed" con mensaje de "token"** → avísale al equipo técnico: es el secreto
  del webhook, se corrige en segundos.
- **Verificar que el webhook está vivo:** abrir en el navegador
  `https://csl-app-eta.vercel.app/api/integrations/agendapro/payments` → debe decir
  `"webhookConfigured": true`.
