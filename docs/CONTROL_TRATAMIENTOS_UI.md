# Pantalla "Control Digital de Tratamientos" — csl-app

> Estado: **construida y typechea** (`tsc --noEmit` = 0 errores). Pendiente:
> verificación visual en `pnpm dev` + sidebar navy (§4.1) + responsive fino.

Ficha operativa por cliente que reúne, en una sola vista, sus paquetes, sesiones,
cesiones, consentimientos pendientes y actividad reciente. Es una **vista nueva**
del SPA (no una ruta): se selecciona por `activeTab = "control-tratamientos"`.

## Dónde vive / cableado

| Pieza | Archivo |
|---|---|
| Componente | `components/control-tratamientos-page.tsx` (`"use client"`) |
| Tab id | `lib/types.ts` → `TabId` `"control-tratamientos"` |
| Menú | `lib/menus.ts` (sección "Clientes y Consentimientos") + `components/sidebar.tsx` |
| Render | `app/page.tsx` → `case "control-tratamientos"` |
| Título | `components/header.tsx` → `pageMeta` |
| Datos | acción `getControlTratamientos` en `app/api/csl/_handlers.ts` |

## Datos (una sola llamada)

`apiJsonp("/api/csl", { action: "getControlTratamientos", clienteId })` devuelve, todo
**scoped por `business_id`** (mismo blindaje IDOR que `getClienteHistorial`):

- `cliente` — de `csl_cosmiatria_clientes`.
- `kpis` — `sesiones_disponibles`, `sesiones_adquiridas`, `tratamientos_realizados`,
  `sesiones_cedidas`, `firmas_pendientes` (todos calculados con datos reales).
- `paquetes` — `csl_paquetes` (badge **AgendaPro** cuando `origen = agendapro_webhook`).
- `cesiones` — `csl_cesiones` (donde el cliente cede o recibe).
- `firmasPendientes` — consentimientos `Pendiente`/`Pendiente de revisión` (las 4 tablas
  `csl_consent_*`).
- `actividadReciente` — tratamientos realizados de `csl_sesiones_cliente` (ligados por
  **nombre de texto**, criterio heredado del historial de Clientes).

## Definición de los KPIs

- **Sesiones disponibles** = Σ `paquetes.sesiones_disponibles`.
- **Sesiones adquiridas** = Σ `paquetes.sesiones_adquiridas`.
- **Tratamientos realizados** = nº de sesiones ejecutadas (`csl_sesiones_cliente`).
- **Sesiones cedidas** = Σ `cesiones.sesiones_cedidas` donde el cliente es quien cede.
- **Firmas pendientes** = nº de consentimientos pendientes.

## Estructura de la pantalla

- **Encabezado del cliente**: avatar, "Cliente actual", nombre, teléfono/correo/sucursal
  + botones **Cambiar cliente** (buscador real), **Registrar sesión** (navega a Clientes),
  **Exportar** (CSV real del expediente).
- **5 tarjetas KPI** (turquesa/navy) con datos reales.
- **Pestañas**: Resumen (default) · Sesiones y Tratamientos · Actividad Reciente · Historial.
  - **Resumen**: paquetes adquiridos (tabla paginada) · actividad reciente (timeline) ·
    firmas pendientes (empty-state "Este cliente no tiene firmas pendientes") · cesiones.
- La pestaña seleccionada y el cliente se conservan (localStorage) mientras se trabaja.

## Notas / pendientes

- **Datos históricos (46/41 del mockup)**: NO están en los criterios de aceptación;
  la vista muestra lo que entra por el webhook de AgendaPro + registro manual. Un
  backfill histórico (p. ej. desde el sistema "Improve") sería una fase futura opcional.
- **Sidebar navy (§4.1)**: cambio global; se aplicará con previsualización en dev.
- **Registrar sesión / Exportar**: acciones reales (navegación a Clientes / descarga CSV);
  el destino de "Registrar sesión" se puede afinar al flujo exacto que prefieras.
