# Inventario de Productos — diseño

**Fecha:** 2026-08-15
**Estado:** aprobado por el usuario
**Módulos:** menú nuevo «Inventario de Productos» (catálogo, importación, reporte PDF, conteo físico)

---

## 1. Objetivo

Que el negocio pueda:

1. **Importar** el Excel de productos que exporta el proveedor externo (`productos_XXXX.xlsx`)
   y que el sistema conozca el catálogo y **la existencia de cada producto en cada sucursal**.
2. **Generar el PDF de existencias** con el formato del modelo
   (`INVENTARIO RAFAEL VIDAL MES JUNIO.pdf`), **seleccionando una o varias sucursales**.
3. **Hacer el conteo físico** de productos por sucursal — captura manual — y que al
   aprobarlo el stock del sistema quede igual a lo contado, con acta de diferencias.

Aplica a **CSL y a Depicenter** (multi-tenant, sin excepciones).

---

## 2. Decisiones tomadas

| Decisión | Elección |
|---|---|
| Alcance del conteo físico | **Solo captura manual** — sin escáner de código de barra, sin cola offline, sin evidencias fotográficas. Mismo patrón que el inventario de materiales que ya existe. |
| PDF multi-sucursal | **Una página por sucursal** + una **página de consolidado** al final. |
| Fuente de verdad del stock | **El Excel sobrescribe.** Cada importación reemplaza el stock y queda registrada (archivo, usuario, fecha, filas, mapeo). El conteo aprobado también escribe stock, pero la siguiente importación vuelve a mandar. |

### Fuera de alcance (deliberado)

- Exportar el reporte de existencias a Excel.
- Cualquier vínculo con los módulos de Compras o de Requisición de Materiales.
  Este módulo es de **productos de venta**; aquel es de **materiales de uso interno**.
- Movimientos de inventario (entradas/salidas por venta). El stock se mueve solo por
  importación o por conteo aprobado.
- Lotes, vencimientos y almacenes (existen en DermaLand; en CSL el modelo es
  producto × sucursal, sin lote).

---

## 3. El archivo de entrada

`productos_3552_1786823521.xlsx` — dos hojas, 17 columnas, misma cabecera en ambas:

| Columna | Uso |
|---|---|
| `SKU` | Clave del producto. La mayoría son códigos de barra EAN reales; algunos son internos (`3030`, `1111`) y en la hoja `Inactivos` viene **vacío**. |
| `Categoría`, `Marca`, `Formato`, `Descripción` | Catálogo. |
| `Costo`, `Precio venta externa`, `Precio venta interna` | Precios. |
| `Comisión`, `Tipo de comisión (0: %, 1: $)` | Comisión del producto. |
| `Estado` | `Activo` / `Inactivo`. |
| `Precio contiene IVA`, `% IVA (vacio por defecto)` | Fiscal. |
| `Stock <sucursal>` × N | **Una columna de existencia por sucursal.** Hoy: `Stock Cibao Spa Laser  Av. Rafael Vidal `, `Stock Cibao Spa Laser Los Jardines`, `Stock Cibao Spa Laser Villa Olga`. |

- Hoja `Productos`: 84 filas activas. Hoja `Inactivos`: 43 filas.
- Los nombres traen **espacios dobles y espacios al final** (`"ANESTESIA ENCAIN "`): hay que
  normalizar antes de comparar.
- El número de columnas de stock **no es fijo**: se detectan por prefijo, no por posición.

### Mapeo de columnas a sucursales

Se resuelve con `normalizeSucursal()` de `lib/normalize-pulse.ts`, que ya reconoce esos
títulos (`JARDINES` → `LOS JARDINES`, `RAFAEL`/`VIDAL` → `RAFAEL VIDAL`, `VILLA`+`OLGA` →
`VILLA OLGA`, `DEPICENTER`, `LA VEGA`). El mapeo propuesto **se muestra en pantalla y el
usuario lo confirma o lo corrige** antes de escribir nada. Una columna que no resuelva a una
sucursal del tenant activo queda sin asignar y se ignora — nunca se adivina.

---

## 4. Modelo de datos

Cuatro tablas nuevas en `db-cls`, todas con `business_id`, RLS deny-by-default con el patrón
de `202607250001_agendapro_treatments_domain.sql` (`public.current_business_id()` /
`public.is_superadmin()`), e índices por `business_id`.

### `csl_productos` — catálogo

```
id                uuid pk default gen_random_uuid()
business_id       uuid not null
clave             text not null   -- SKU normalizado; si viene vacío, el nombre normalizado
sku               text
nombre            text not null
nombre_norm       text not null   -- mayúsculas, sin acentos, espacios colapsados
categoria         text
marca             text
formato           text
descripcion       text
costo             numeric(12,2)
precio_externo    numeric(12,2)
precio_interno    numeric(12,2)
comision          numeric(12,2)
comision_tipo     smallint        -- 0 = %, 1 = $
precio_con_iva    boolean
iva_pct           numeric(6,2)
activo            boolean not null default true
created_at        timestamptz not null default now()
updated_at        timestamptz not null default now()

unique (business_id, clave)
```

`clave` es la identidad estable del producto: permite reimportar sin duplicar y permite que
un producto sin SKU (hoja `Inactivos`) siga siendo el mismo entre importaciones.

### `csl_producto_stock` — existencia por sucursal

```
id            uuid pk
business_id   uuid not null
producto_id   uuid not null references csl_productos(id) on delete cascade
sucursal      text not null       -- nombre canónico (normalizeSucursal)
cantidad      numeric(12,2) not null default 0
origen        text not null       -- 'importacion' | 'conteo'
actualizado_en timestamptz not null default now()

unique (business_id, producto_id, sucursal)
```

### `csl_producto_importaciones` — bitácora

```
id                    uuid pk
business_id           uuid not null
archivo               text
filas_leidas          int
productos_creados     int
productos_actualizados int
sucursales            jsonb   -- [{columna, sucursal, unidades}]
unidades_total        numeric(12,2)
usuario_id            uuid
usuario_nombre        text
created_at            timestamptz not null default now()
```

### `csl_conteos_productos` + `csl_conteos_productos_items` — conteo físico

```
csl_conteos_productos
  id, business_id, sucursal, fecha (date), estado, notas,
  responsable, creado_por, creado_por_nombre, created_at,
  aprobado_por, aprobado_por_nombre, aprobado_en, updated_at

  estado ∈ ('borrador','enviado','aprobado','rechazado')
  unique parcial (business_id, sucursal, fecha) where estado = 'borrador'

csl_conteos_productos_items
  id, business_id, conteo_id (fk on delete cascade), producto_id,
  nombre_snapshot, sku_snapshot,
  cantidad_sistema numeric,   -- stock congelado al abrir el conteo
  cantidad_contada numeric,
  observacion text
```

`diferencia` **no se almacena**: se deriva (`cantidad_contada − cantidad_sistema`) para que no
haya dos verdades. `cantidad_sistema` sí se congela, porque es lo que había cuando se contó.

---

## 5. Menús y permisos

Sección nueva **«Inventario de Productos»** en `lib/menus.ts`, `lib/types.ts` (`TabId`),
`components/sidebar.tsx` y el switch de `app/page.tsx`. Cada id de menú **es** su permiso —
así funciona el sistema hoy.

| id | Etiqueta | Contenido |
|---|---|---|
| `prod-catalogo` | Productos | Lista con buscador, filtro de categoría y activo/inactivo, columnas de stock por sucursal y total. Paginado en servidor. |
| `prod-importar` | Importar Excel | Subir → previsualizar (mapeo + resumen) → confirmar → resultado. |
| `prod-reporte` | Reporte de existencias | Selección múltiple de sucursales + umbral de stock bajo → PDF. |
| `prod-conteo` | Conteo físico | Abrir/continuar un conteo por sucursal y capturar cantidades. |
| `prod-conteo-historico` | Histórico de conteos | Lista, detalle con diferencias, PDF del acta. |

Permiso de acción extra (no navegable), en `csl_user_profiles.permissions`:

- `productos.aprobar_conteo` — permite aprobar/rechazar un conteo. Admin y superadmin lo
  tienen implícito. Sin él, el usuario solo puede contar y enviar.

---

## 6. Importador

**Cliente** (`components/productos/prod-importar-page.tsx`):

1. `loadXLSX()` (ya existe) parsea el archivo **en el navegador** — el archivo nunca se sube.
2. Detecta las hojas `Productos` e `Inactivos` por nombre; si no aparecen, usa la primera hoja.
3. Detecta las columnas de stock por prefijo `Stock ` y propone el mapeo a sucursales.
4. Muestra la previsualización: cuántas filas, cuántos productos nuevos vs existentes,
   unidades por sucursal y qué columnas quedaron sin mapear.
5. Al confirmar, envía en lotes de 200 filas a la acción `importProducts`.

**Servidor** (`lib/server/products-inventory.ts`):

- `importProducts(params, user)`:
  - Valida el lote con **zod** (`nombre` obligatorio; cantidades finitas ≥ 0; sucursal
    permitida para el tenant vía `sucursalAllowedForTenant`).
  - `upsert` de `csl_productos` por `(business_id, clave)`.
  - `upsert` de `csl_producto_stock` por `(business_id, producto_id, sucursal)` con
    `origen = 'importacion'` — **sobrescribe**.
  - Acumula el resumen; el último lote escribe la fila de `csl_producto_importaciones`.
- Todo pasa por `effectiveBusinessId()`; nunca por el `business_id` del perfil del usuario.
- Una fila cuya sucursal no pertenezca al tenant activo se **descarta y se reporta**, no se
  estampa con el negocio activo (es la causa histórica de contaminación cross-tenant).

---

## 7. Reporte PDF

`lib/inventario-productos-pdf.ts` — función pura que recibe datos + `Business` y devuelve el
HTML; se imprime con `window.print()` en un popup. Mismo motor que
`lib/inventario-materiales-pdf.ts`.

**Réplica del modelo:**

- Encabezado con el logo y el color del negocio; título `INVENTARIO <SUCURSAL> <PERIODO>`;
  subtítulo `<Negocio> | Sucursal <X> | Reporte profesional de productos con existencia`.
- Tres KPIs: **productos con stock**, **unidades totales**, **alerta stock bajo**.
- Tabla `#` · `Nombre` · `Cantidad` · `Nota`, ordenada por cantidad descendente y, a igualdad,
  por nombre.
- Nota **«Stock bajo»** cuando `cantidad ≤ umbral`. **Umbral por defecto: 2**, ajustable en la
  pantalla. (Verificado contra el modelo: 19 productos, 204 unidades, 6 en alerta.)
- Solo productos **con existencia** (`cantidad > 0`) en esa sucursal.
- Pie: `Fuente: archivo de productos cargado. Solo se incluyen productos con existencia en
  <sucursal>. Generado para <negocio>` + fecha/hora y usuario.

**Multi-sucursal:** una página por sucursal seleccionada (`page-break-after: always`) y una
página final de **consolidado**: producto × sucursales seleccionadas + columna total, ordenada
por total descendente, con sus propios KPIs.

El «periodo» del título lo escribe el usuario (por defecto el mes en curso, ej. `MES AGOSTO`),
igual que el modelo.

---

## 8. Conteo físico

**Abrir un conteo** (`prod-conteo`): sucursal + fecha + responsable. El sistema carga los
productos activos de esa sucursal con su **`cantidad_sistema` congelada** en ese momento.
Toggle para incluir también los que están en cero.

**Capturar:** buscador por nombre/SKU, campo de cantidad por producto, observación opcional.
La diferencia (`contada − sistema`) se muestra en vivo con color: verde cuadra, ámbar sobra,
rojo falta. Se guarda **borrador** con la misma mecánica de reanudar de
`getInventoryDraft`/`saveInventory` (un borrador vivo por sucursal+fecha, sin duplicar).

**Estados:** `borrador` → `enviado` → `aprobado` | `rechazado`.

**Al aprobar** (requiere `productos.aprobar_conteo`, admin o superadmin):

1. Se escribe `csl_producto_stock.cantidad = cantidad_contada` con `origen = 'conteo'`
   para cada ítem contado de esa sucursal.
2. El conteo queda **inmutable** con `aprobado_por` / `aprobado_en`.
3. Queda el acta de diferencias, exportable a PDF con el mismo motor.

Un conteo aprobado no se edita. Rechazar lo devuelve a `borrador` con el motivo.

---

## 9. Multi-tenant y seguridad

- Toda lectura y escritura filtra por `effectiveBusinessId()` dentro de
  `runWithBusinessContext`. Nunca por el `business_id` del perfil.
- RLS deny-by-default en las cinco tablas nuevas + `grant all ... to service_role`.
- Las cantidades entran validadas con zod; nada de `Number(x)` a pelo sobre input del usuario.
- Ninguna variable de entorno nueva. Ningún `NEXT_PUBLIC_`.
- Etiquetas legibles siempre: nunca UUID ni JSON crudo en pantalla.
- Las listas usan paginación explícita en servidor — sin `.range()` PostgREST corta en 1000
  filas **en silencio**.
- El nombre del proveedor externo no aparece en texto visible; el módulo habla de
  «archivo de productos».

---

## 10. Verificación

- `pnpm lint` (que es `tsc --noEmit`) en verde antes de cada commit.
- `pnpm build` en verde.
- Script `scripts/test-productos-inventario.mjs` (patrón `scripts/test-gift-certificates.mjs`,
  `node:assert/strict`), sobre funciones puras, sin tocar la base:
  1. El parser detecta las 3 columnas de stock del archivo real y las mapea a las 3 sucursales.
  2. Normalización de nombres: `"ANESTESIA ENCAIN "` y `"ANESTESIA  ENCAIN"` son el mismo producto.
  3. Filas sin nombre o con cantidad no numérica se descartan.
  4. El armador del reporte reproduce el modelo: 19 productos, 204 unidades, 6 en alerta
     con umbral 2, orden descendente correcto.
  5. El cálculo de diferencias del conteo: contada − sistema, incluidos negativos y ceros.
- Prueba manual en la app con el archivo real antes de desplegar.

---

## 11. Etapas de construcción

1. **Base + importador + catálogo** — migración SQL, `lib/server/products-inventory.ts`,
   parser puro, pantallas Productos e Importar.
2. **Reporte PDF** — `lib/inventario-productos-pdf.ts` y pantalla de reporte multi-sucursal.
3. **Conteo físico** — captura, aprobación con ajuste de stock, histórico y acta en PDF.

Cada etapa cierra con `pnpm lint`, `pnpm build`, commit, bump SemVer y entrada en `CHANGELOG.md`.
