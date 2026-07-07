# Fix: "Crear cabina" no hacía nada (usuarios NO-admin) — v0.16.0

Fecha: 2026-07-07 · Estado: en producción · Supabase: **solo local db-cls** (no Cloud)

## Síntoma reportado

En el editor de Equipos, al pulsar **"Crear cabina"** en el modal "Nueva cabina"
(caso real: Nombre `Cosmiatria 2`, Sucursal `Los Jardines`, Estado `Activa`), el
formulario se quedaba abierto y **no ocurría nada**: sin cierre del modal, sin
mensaje de éxito, sin mensaje de error, sin cabina creada. También en móvil/iPhone.

## Diagnóstico (causa raíz)

La nota "Verified" de v0.15.3 concluyó que la creación "funcionaba" y culpó a un
"bundle viejo en caché". Fue un **diagnóstico incompleto**: solo se probó como
**admin/owner**, donde el bug no ocurre. La causa real son **dos defectos acoplados**:

### B) Por qué NO se creaba la cabina — en la API/server action

`app/api/csl/_handlers.ts` → `case "saveMaintenanceCabin"` exigía
`await requireAdmin(user.id)`, que lanza `"Solo un administrador puede gestionar
usuarios"` para cualquier no-admin.

Pero:
- El botón **"+ Agregar cabina"** vive dentro del editor de **Equipos**.
- El menú `equipos` **sí** está asignado a perfiles no-admin (verificado: `Cibao`,
  `CARLOS`, encargadas de Los Jardines).
- Guardar un equipo (`saveEquipo` / `updateEquipoCampos`) **no** exige admin.

→ Una encargada podía editar equipos y elegir cabina, pero al crear una cabina el
servidor la rechazaba **antes del INSERT**. El INSERT en sí siempre funcionó
(db-cls, status 201; no era DB/constraint/RLS/`business_id`/UUID).

### A) Por qué "no pasaba nada" (sin mensaje) — capa visual

`components/toast-notification.tsx` se renderiza en el árbol normal con `z-50`.
El overlay del `Dialog` (Radix, portaleado al final de `<body>`) también es `z-50`
y, al ir **después** en el DOM, lo tapaba. Con el modal abierto, el toast de error
quedaba **detrás del overlay** → invisible → el formulario parecía "congelado".

## Cambios

| Archivo | Cambio |
|---|---|
| `app/api/csl/_handlers.ts` | Se quita `requireAdmin` de `saveMaintenanceCabin`. Sigue scopeado por `business_id` del contexto (nunca cruza CSL/Depicenter) y deduplica por negocio+sucursal+nombre. `requireAdmin` intacto en acciones admin-only. |
| `components/toast-notification.tsx` | `z-50` → `z-[200]` (sobre Dialog/Sheet/overlay `z-50` y toast primitivo `z-[100]`). `role="alert"` + `aria-live="assertive"`. |
| `components/equipos-page.tsx` | Botón muestra "Creando…" mientras guarda; mensaje de duplicado claro y no bloqueante (reutiliza y selecciona la existente). |
| `scripts/_test-cabina-noadmin-create.js` | Test de regresión e2e (nuevo). |

## Verificación

- **e2e** (`scripts/_test-cabina-noadmin-create.js`): usuario throwaway NO-admin →
  login → `POST saveMaintenanceCabin` crea "COSMIATRIA 2 / Los Jardines"
  (`ok:true`, `business_id`=CSL, sucursal ok, MAYÚSCULA, persistida). 2º POST
  idéntico → `reused` (doble clic no duplica). El mismo token NO-admin sigue
  bloqueado en `getUsers` (`"Solo un administrador…"`).
- **Navegador (Chrome)**: logueado como encargada NO-admin de Los Jardines, se
  creó "COSMIATRIA 2" desde el editor de Equipos: el botón respondió, el modal
  cerró (`data-state=closed`), apareció el toast "Cabina Cosmiatria 2 creada" y la
  cabina quedó seleccionada. Captura confirma que el toast se pinta **sobre** el
  overlay del modal. En DB: `created_by` = UUID del usuario NO-admin, `business_id`
  = CSL. Dato de prueba y usuario throwaway **eliminados**.
- `tsc --noEmit` (lint) OK · `next build` OK.

## Notas

- No se usó Supabase Cloud en ningún momento (`db-cls.cibao-cloude.com`).
- No se insertó ninguna cabina manualmente para ocultar el error: se corrigió el
  flujo real de creación.
- Si el negocio quiere "COSMIATRIA 2 / Los Jardines" de forma permanente, ahora se
  crea con un clic desde el editor de Equipos (se eliminó tras la prueba).
