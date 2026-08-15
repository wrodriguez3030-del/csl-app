# Inventario de Productos — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un menú «Inventario de Productos» que importa el Excel de productos, mantiene el stock por sucursal, imprime el reporte de existencias con el formato del modelo para una o varias sucursales, y permite el conteo físico manual que al aprobarse ajusta el stock.

**Architecture:** Cinco tablas nuevas en `db-cls` (`csl_productos`, `csl_producto_stock`, `csl_producto_importaciones`, `csl_conteos_productos`, `csl_conteos_productos_items`) con RLS por tenant. El Excel se parsea **en el navegador** con `loadXLSX()` y se envía por lotes a un módulo de servidor nuevo (`lib/server/products-inventory.ts`) que hace upsert y sobrescribe stock. El PDF es una función pura que devuelve HTML y se imprime con `window.print()`, igual que `lib/inventario-materiales-pdf.ts`. El conteo físico replica la mecánica de borrador/finalizar del inventario de materiales, sin escáner.

**Tech Stack:** Next.js 16 · TypeScript · React · Supabase self-hosted (`db-cls`) · zod · SheetJS vía `loadXLSX()` · pnpm

**Spec:** `docs/superpowers/specs/2026-08-15-inventario-productos-design.md`

## Global Constraints

- **Gestor de paquetes: `pnpm`.** Nunca npm ni yarn.
- **`pnpm lint` es `tsc --noEmit`.** No hay ESLint ni framework de tests: las pruebas son scripts `scripts/test-*.mjs` que se corren con `node --import tsx` y usan `node:assert/strict`. Patrón de referencia: `scripts/test-gift-certificates.mjs`.
- **Base de datos: Supabase self-hosted `db-cls`.** DDL con `node scripts/db-query.js --file <ruta.sql>`. Todo archivo SQL termina con `notify pgrst, 'reload schema';`.
- **Multi-tenant obligatorio.** Toda lectura y escritura filtra por `effectiveBusinessId()` / `getBusinessContext()`, **nunca** por el `business_id` del perfil del usuario. Aplica a **CSL y Depicenter**.
- **RLS deny-by-default** en toda tabla nueva, con el patrón exacto de `supabase/migrations/202607250001_agendapro_treatments_domain.sql:218-241`.
- **Sin `.range()` PostgREST corta en 1000 filas EN SILENCIO.** Toda lectura de lista pagina explícitamente.
- **Ninguna variable de entorno nueva. Ningún `NEXT_PUBLIC_`.**
- **Etiquetas legibles.** Nunca mostrar UUID, claves internas ni JSON crudo al usuario.
- **Nombres neutrales.** El proveedor externo nunca se nombra en la interfaz: se dice «archivo de productos».
- **Umbral de stock bajo: `≤ 2` por defecto**, ajustable en la pantalla del reporte.
- Al terminar: bump SemVer en `package.json` + entrada en `CHANGELOG.md` + push a `origin` y deploy a producción.

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `supabase/migrations/202608150001_productos_inventario.sql` | Las 5 tablas, índices y RLS. |
| `lib/productos-client.ts` | Tipos compartidos cliente/servidor y helpers de formato. Sin imports de servidor. |
| `lib/productos-import.ts` | **Puro.** Parseo del Excel ya convertido a matriz: detección de columnas de stock, normalización de nombres, filas válidas. |
| `lib/inventario-productos-pdf.ts` | **Puro.** Arma el HTML del reporte (por sucursal + consolidado) y del acta de conteo. |
| `lib/server/products-inventory.ts` | Catálogo, importación, stock y conteo físico. Server-only. |
| `components/productos/prod-catalogo-page.tsx` | Pantalla Productos. |
| `components/productos/prod-importar-page.tsx` | Pantalla Importar Excel. |
| `components/productos/prod-reporte-page.tsx` | Pantalla Reporte de existencias. |
| `components/productos/prod-conteo-page.tsx` | Pantalla Conteo físico. |
| `components/productos/prod-conteo-historico-page.tsx` | Pantalla Histórico de conteos. |
| `scripts/test-productos-inventario.mjs` | Pruebas de las funciones puras. |
| `lib/types.ts`, `lib/menus.ts`, `components/sidebar.tsx`, `app/page.tsx`, `app/api/csl/_handlers.ts` | Registro del menú y dispatch de acciones. |

---

## Etapa 1 — Base de datos, importador y catálogo

### Task 1: Migración de base de datos

**Files:**
- Create: `supabase/migrations/202608150001_productos_inventario.sql`

**Interfaces:**
- Produces: tablas `csl_productos`, `csl_producto_stock`, `csl_producto_importaciones`, `csl_conteos_productos`, `csl_conteos_productos_items`.

- [ ] **Step 1: Escribir la migración**

```sql
-- 5 tablas del módulo Inventario de Productos. Aditiva e idempotente.
create table if not exists public.csl_productos (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  clave text not null,
  sku text,
  nombre text not null,
  nombre_norm text not null,
  categoria text, marca text, formato text, descripcion text,
  costo numeric(12,2), precio_externo numeric(12,2), precio_interno numeric(12,2),
  comision numeric(12,2), comision_tipo smallint,
  precio_con_iva boolean, iva_pct numeric(6,2),
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists csl_productos_clave_uidx on public.csl_productos (business_id, clave);
create index if not exists csl_productos_business_idx on public.csl_productos (business_id);
create index if not exists csl_productos_nombre_idx on public.csl_productos (business_id, nombre_norm);

create table if not exists public.csl_producto_stock (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  producto_id uuid not null references public.csl_productos(id) on delete cascade,
  sucursal text not null,
  cantidad numeric(12,2) not null default 0,
  origen text not null default 'importacion',
  actualizado_en timestamptz not null default now()
);
create unique index if not exists csl_producto_stock_uidx on public.csl_producto_stock (business_id, producto_id, sucursal);
create index if not exists csl_producto_stock_suc_idx on public.csl_producto_stock (business_id, sucursal);

create table if not exists public.csl_producto_importaciones (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  archivo text,
  filas_leidas int default 0,
  productos_creados int default 0,
  productos_actualizados int default 0,
  sucursales jsonb,
  unidades_total numeric(12,2) default 0,
  usuario_id uuid, usuario_nombre text,
  created_at timestamptz not null default now()
);
create index if not exists csl_producto_importaciones_idx on public.csl_producto_importaciones (business_id, created_at desc);

create table if not exists public.csl_conteos_productos (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  sucursal text not null,
  fecha date not null,
  estado text not null default 'borrador',
  notas text, responsable text,
  creado_por uuid, creado_por_nombre text,
  aprobado_por uuid, aprobado_por_nombre text, aprobado_en timestamptz,
  motivo_rechazo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists csl_conteos_productos_borrador_uidx
  on public.csl_conteos_productos (business_id, sucursal, fecha) where estado = 'borrador';
create index if not exists csl_conteos_productos_idx on public.csl_conteos_productos (business_id, fecha desc);

create table if not exists public.csl_conteos_productos_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  conteo_id uuid not null references public.csl_conteos_productos(id) on delete cascade,
  producto_id uuid,
  nombre_snapshot text not null,
  sku_snapshot text,
  cantidad_sistema numeric(12,2) not null default 0,
  cantidad_contada numeric(12,2) not null default 0,
  observacion text
);
create index if not exists csl_conteos_productos_items_idx on public.csl_conteos_productos_items (conteo_id);
```

Cerrar con el bloque RLS `do $$ ... foreach t in array array[...5 tablas...]` copiado literal de `202607250001_agendapro_treatments_domain.sql:218-241`, y terminar el archivo con `notify pgrst, 'reload schema';`.

- [ ] **Step 2: Aplicar a db-cls**

Run: `node scripts/db-query.js --file supabase/migrations/202608150001_productos_inventario.sql`
Expected: sin error.

- [ ] **Step 3: Verificar que las tablas existen y responden**

Run: `node scripts/db-query.js "select count(*) from csl_productos"`
Expected: `0`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/202608150001_productos_inventario.sql
git commit -m "feat(productos): tablas de inventario de productos con RLS por tenant"
```

---

### Task 2: Parser puro del Excel

**Files:**
- Create: `lib/productos-import.ts`
- Create: `lib/productos-client.ts`
- Create: `scripts/test-productos-inventario.mjs`

**Interfaces:**
- Produces:
  ```ts
  // lib/productos-client.ts
  export interface ProductoRow { clave: string; sku: string; nombre: string; nombreNorm: string
    categoria: string; marca: string; formato: string; descripcion: string
    costo: number | null; precioExterno: number | null; precioInterno: number | null
    comision: number | null; comisionTipo: number | null
    precioConIva: boolean | null; ivaPct: number | null; activo: boolean
    stock: Record<string, number> }          // sucursal canónica → cantidad
  export interface StockColumn { columna: string; sucursal: string }
  export function normalizeProductName(v: unknown): string
  export function fmtQty(n: unknown): string

  // lib/productos-import.ts
  export function detectStockColumns(header: string[]): StockColumn[]
  export function parseProductSheet(rows: unknown[][], opts: { activo: boolean }): ProductoRow[]
  export function summarizeImport(rows: ProductoRow[]): { productos: number; unidades: number; porSucursal: Record<string, number> }
  ```
- `normalizeProductName`: mayúsculas, sin acentos, espacios colapsados, sin espacios extremos.
- `detectStockColumns` usa `normalizeSucursal` de `lib/normalize-pulse.ts` sobre las cabeceras que empiezan por `stock` (case-insensitive); descarta las que no resuelvan.
- `parseProductSheet` descarta filas sin nombre; cantidades no numéricas cuentan como `0`; `clave` = SKU sin espacios si existe, si no `nombreNorm`.

- [ ] **Step 1: Escribir el test que falla**

```js
// scripts/test-productos-inventario.mjs
import assert from "node:assert/strict"
import { detectStockColumns, parseProductSheet } from "../lib/productos-import.ts"
import { normalizeProductName } from "../lib/productos-client.ts"

const HEADER = ["SKU","Categoría","Marca","Nombre","Formato","Costo","Precio venta externa",
  "Precio venta interna","Comisión","Tipo de comisión (0: %, 1: $)","Descripción","Estado",
  "Precio contiene IVA","% IVA (vacio por defecto)","Stock Cibao Spa Laser  Av. Rafael Vidal ",
  "Stock Cibao Spa Laser Los Jardines","Stock Cibao Spa Laser Villa Olga"]

const cols = detectStockColumns(HEADER)
assert.equal(cols.length, 3, "detecta las 3 columnas de stock")
assert.deepEqual(cols.map((c) => c.sucursal), ["RAFAEL VIDAL", "LOS JARDINES", "VILLA OLGA"])

assert.equal(normalizeProductName("ANESTESIA ENCAIN "), "ANESTESIA ENCAIN")
assert.equal(normalizeProductName("ANESTESIA  ENCAIN"), "ANESTESIA ENCAIN")

const rows = parseProductSheet([
  HEADER,
  ["3030","Otros","Otros","ANESTESIA ENCAIN ","100 ml","700","1000","700","100","0","x","Activo","Inactivo","0.0","0","0","0"],
  ["","Otros","Otros","","","","","","","","","Activo","","","1","0","0"],       // sin nombre → fuera
  ["1111","Otros","Otros","BOXER DESECHABLES","Otros","80","100","80","0","0","","Activo","Inactivo","","4","0","0"],
], { activo: true })
assert.equal(rows.length, 2, "descarta la fila sin nombre")
assert.equal(rows[0].clave, "3030")
assert.equal(rows[1].stock["RAFAEL VIDAL"], 4)
console.log("✓ parser")
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `node --import tsx scripts/test-productos-inventario.mjs`
Expected: FAIL — `Cannot find module '../lib/productos-import.ts'`.

- [ ] **Step 3: Implementar `lib/productos-client.ts` y `lib/productos-import.ts`**

Sin dependencias de servidor: `productos-import.ts` solo importa de `./normalize-pulse` y `./productos-client`.

- [ ] **Step 4: Correr el test y verlo pasar**

Run: `node --import tsx scripts/test-productos-inventario.mjs`
Expected: PASS.

- [ ] **Step 5: `pnpm lint` y commit**

```bash
pnpm lint
git add lib/productos-client.ts lib/productos-import.ts scripts/test-productos-inventario.mjs
git commit -m "feat(productos): parser puro del archivo de productos + pruebas"
```

---

### Task 3: Módulo de servidor — catálogo, importación y stock

**Files:**
- Create: `lib/server/products-inventory.ts`
- Modify: `app/api/csl/_handlers.ts` (import + casos del switch)

**Interfaces:**
- Consumes: `ProductoRow` de la Task 2.
- Produces:
  ```ts
  export function getProductBranches(): { ok: true; records: string[]; canPickAll: boolean }
  export async function getProductos(params: ActionParams): Promise<{ ok: true; records: ProductoWithStock[]; total: number }>
  export async function importProducts(params: ActionParams, user: ActionUser): Promise<{ ok: true; creados: number; actualizados: number; descartados: number; importId: string | null }>
  export async function getProductImports(): Promise<{ ok: true; records: Row[] }>
  export async function getProductStockReport(params: ActionParams): Promise<{ ok: true; sucursales: string[]; records: { nombre: string; sku: string; stock: Record<string, number> }[] }>
  ```
- `importProducts` recibe `rows` (JSON string), `archivo`, `lote`, `esUltimoLote`, `userName`.
- Acciones del dispatcher: `getProductBranches`, `getProductos`, `importProducts`, `getProductImports`, `getProductStockReport`.

- [ ] **Step 1: Implementar el módulo**

Reglas obligatorias: `requireBizId()` en cada función (patrón de `lib/server/materials.ts:18-33`); validación con **zod** de cada fila del lote; `sucursalAllowedForTenant(sucursal, slug)` antes de escribir stock — la fila cuya sucursal no sea del tenant se cuenta en `descartados` y **no se escribe**; lectura de listas paginada de 1000 en 1000.

- [ ] **Step 2: Cablear el dispatcher**

En `app/api/csl/_handlers.ts`: `import * as productsInventory from "@/lib/server/products-inventory"` junto a los demás imports de `lib/server/`, y un bloque de casos nuevo con el comentario `// ── Inventario de Productos ──`.

- [ ] **Step 3: Verificar tipos**

Run: `pnpm lint`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add lib/server/products-inventory.ts app/api/csl/_handlers.ts
git commit -m "feat(productos): modulo de servidor — catalogo, importacion y stock por sucursal"
```

---

### Task 4: Registro del menú + pantalla Productos

**Files:**
- Modify: `lib/types.ts` (5 ids nuevos en `TabId`)
- Modify: `lib/menus.ts` (sección «Inventario de Productos»)
- Modify: `components/sidebar.tsx` (grupo nuevo en `EXTRA_GROUPS`)
- Modify: `app/page.tsx` (imports + casos del switch)
- Create: `components/productos/prod-catalogo-page.tsx`

**Interfaces:**
- Produces: ids `prod-catalogo`, `prod-importar`, `prod-reporte`, `prod-conteo`, `prod-conteo-historico`.

- [ ] **Step 1: Añadir los ids a `TabId` y a `MENU_OPTIONS`** con `section: "Inventario de Productos"` y las etiquetas de la spec.

- [ ] **Step 2: Añadir el grupo al sidebar** con iconos de `lucide-react` ya importados (`Package`, `FileSpreadsheet`/`FileText`, `Printer`, `ClipboardCheck`, `History`).

- [ ] **Step 3: Implementar `ProdCatalogoPage`** — buscador (nombre/SKU), filtro de categoría y activo/inactivo, columnas de stock por sucursal + total, paginación server-side, y aviso «Aún no has importado productos» cuando está vacío.

- [ ] **Step 4: Cablear en `app/page.tsx`** con el mismo estilo de los demás casos.

- [ ] **Step 5: `pnpm lint` y commit**

```bash
pnpm lint
git add lib/types.ts lib/menus.ts components/sidebar.tsx app/page.tsx components/productos/prod-catalogo-page.tsx
git commit -m "feat(productos): menu Inventario de Productos + pantalla de catalogo"
```

---

### Task 5: Pantalla Importar Excel

**Files:**
- Create: `components/productos/prod-importar-page.tsx`
- Modify: `app/page.tsx`

- [ ] **Step 1: Implementar la pantalla** — `loadXLSX()`, lectura de las hojas `Productos` e `Inactivos`, previsualización con el mapeo columna → sucursal (editable con un `Select` por columna), conteo de filas, unidades por sucursal y columnas sin mapear.

- [ ] **Step 2: Enviar por lotes de 200** con `apiJsonp(apiUrl, { action: "importProducts", ... })`, barra de progreso, y `esUltimoLote: true` en el último.

- [ ] **Step 3: Mostrar el resultado** — creados, actualizados, descartados y el historial de importaciones (`getProductImports`).

- [ ] **Step 4: Probar con el archivo real**

Archivo: `/Users/willianrodriguez/Downloads/productos_3552_1786823521.xlsx`
Expected: 84 productos activos + 43 inactivos; mapeo automático a RAFAEL VIDAL / LOS JARDINES / VILLA OLGA; 0 descartados.

- [ ] **Step 5: `pnpm lint`, `pnpm build` y commit**

```bash
pnpm lint && pnpm build
git add components/productos/prod-importar-page.tsx app/page.tsx
git commit -m "feat(productos): pantalla de importacion del archivo de productos"
```

---

## Etapa 2 — Reporte PDF

### Task 6: Armador puro del PDF

**Files:**
- Create: `lib/inventario-productos-pdf.ts`
- Modify: `scripts/test-productos-inventario.mjs`

**Interfaces:**
- Produces:
  ```ts
  export interface ReporteItem { nombre: string; cantidad: number }
  export interface ReporteSucursal { sucursal: string; items: ReporteItem[] }
  export function buildReporteData(records: { nombre: string; stock: Record<string, number> }[], sucursales: string[]): ReporteSucursal[]
  export function kpisDeSucursal(items: ReporteItem[], umbral: number): { productos: number; unidades: number; alerta: number }
  export function buildProductosPdfHtml(opts: { data: ReporteSucursal[]; business: Business; periodo: string; umbral: number; origin: string; generadoPor?: string; consolidado: boolean }): string
  export function printProductosPdf(opts: ...): void
  ```
- `buildReporteData` incluye **solo** `cantidad > 0` y ordena por cantidad descendente, desempatando por nombre.

- [ ] **Step 1: Añadir el test que falla — reproduce el modelo**

```js
import { buildReporteData, kpisDeSucursal } from "../lib/inventario-productos-pdf.ts"

const catalogo = [
  { nombre: "RASURADORAS", stock: { "RAFAEL VIDAL": 85 } },
  { nombre: "BARIEDERM-CICA", stock: { "RAFAEL VIDAL": 28 } },
  { nombre: "GEL INTIMO URIAGE GYN-PHY", stock: { "RAFAEL VIDAL": 20 } },
  { nombre: "URIAGE DEODORANT ROLL-ON", stock: { "RAFAEL VIDAL": 14 } },
  { nombre: "JABON DE MANZANILLA", stock: { "RAFAEL VIDAL": 12 } },
  { nombre: "HELIOCARE 360 WATER GEL SPF50", stock: { "RAFAEL VIDAL": 8 } },
  { nombre: "URIAGE EAU THERMAL WATER 150 ML", stock: { "RAFAEL VIDAL": 6 } },
  { nombre: "HELIOCARE 360 FLUIDO SOLUCION PIGMENTO SPF50", stock: { "RAFAEL VIDAL": 5 } },
  { nombre: "BOXER DESECHABLES", stock: { "RAFAEL VIDAL": 4 } },
  { nombre: "URIAGE HYSEAC GEL NETTOYANT", stock: { "RAFAEL VIDAL": 4 } },
  { nombre: "BIRETIX BARRA DERMALOTOGICA", stock: { "RAFAEL VIDAL": 3 } },
  { nombre: "BIRETIX TRIACTIVE SPRAY 100ML", stock: { "RAFAEL VIDAL": 3 } },
  { nombre: "HELIOCARE ULTRA 90 GEL", stock: { "RAFAEL VIDAL": 3 } },
  { nombre: "HELIOCARE 360 MINERAL FLUID SPF50 50 ML", stock: { "RAFAEL VIDAL": 2 } },
  { nombre: "HELIOCARE ADVANCED SPRAY SPF 50", stock: { "RAFAEL VIDAL": 2 } },
  { nombre: "URIAGE THERMALE GELEE D EAU T 40 ML", stock: { "RAFAEL VIDAL": 2 } },
  { nombre: "360 MD A-R EMULSION", stock: { "RAFAEL VIDAL": 1 } },
  { nombre: "ANESTESIA ENCAIN", stock: { "RAFAEL VIDAL": 1 } },
  { nombre: "URIAGE BARIDEM CICA CREME SPF 50 +", stock: { "RAFAEL VIDAL": 1 } },
  { nombre: "PRODUCTO EN CERO", stock: { "RAFAEL VIDAL": 0 } },
]
const [rv] = buildReporteData(catalogo, ["RAFAEL VIDAL"])
assert.equal(rv.items.length, 19, "excluye los que están en cero")
assert.equal(rv.items[0].nombre, "RASURADORAS")
const k = kpisDeSucursal(rv.items, 2)
assert.deepEqual(k, { productos: 19, unidades: 204, alerta: 6 })
console.log("✓ reporte")
```

- [ ] **Step 2: Correr y ver fallar.** Run: `node --import tsx scripts/test-productos-inventario.mjs` → FAIL.

- [ ] **Step 3: Implementar `lib/inventario-productos-pdf.ts`** siguiendo el estilo de `lib/inventario-materiales-pdf.ts` (mismo `esc`, misma cabecera con logo y `--brand`, `@page A4`). Añadir: tarjetas de KPI, `page-break-after: always` entre sucursales, y la página de consolidado cuando `consolidado === true`.

- [ ] **Step 4: Correr y ver pasar.** Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm lint
git add lib/inventario-productos-pdf.ts scripts/test-productos-inventario.mjs
git commit -m "feat(productos): armador del PDF de existencias con KPIs y consolidado"
```

---

### Task 7: Pantalla Reporte de existencias

**Files:**
- Create: `components/productos/prod-reporte-page.tsx`
- Modify: `app/page.tsx`

- [ ] **Step 1: Implementar la pantalla** — casillas de sucursal (todas marcadas por defecto), campo de periodo (`MES AGOSTO` por defecto según el mes en curso), campo de umbral (2), casilla «incluir página de consolidado» (marcada), y vista previa con los KPIs por sucursal antes de imprimir.

- [ ] **Step 2: Botón Imprimir/PDF** → `printProductosPdf` con `origin: window.location.origin`.

- [ ] **Step 3: Comparar contra el modelo** — generar el PDF de RAFAEL VIDAL y verificar visualmente encabezado, KPIs, orden y notas de «Stock bajo».

- [ ] **Step 4: `pnpm lint`, `pnpm build` y commit**

```bash
pnpm lint && pnpm build
git add components/productos/prod-reporte-page.tsx app/page.tsx
git commit -m "feat(productos): reporte de existencias por sucursal en PDF"
```

---

## Etapa 3 — Conteo físico

### Task 8: Servidor del conteo físico

**Files:**
- Modify: `lib/server/products-inventory.ts`
- Modify: `app/api/csl/_handlers.ts`

**Interfaces:**
- Produces:
  ```ts
  export async function getProductCountDraft(params: ActionParams): Promise<{ ok: true; record: ConteoConItems | null }>
  export async function saveProductCount(params: ActionParams, user: ActionUser): Promise<{ ok: true; record: Conteo }>
  export async function submitProductCount(params: ActionParams, user: ActionUser)
  export async function approveProductCount(params: ActionParams, user: ActionUser)   // escribe stock
  export async function rejectProductCount(params: ActionParams, user: ActionUser)
  export async function getProductCounts(params: ActionParams)
  export async function getProductCount(params: ActionParams)
  ```
- `approveProductCount` exige `productos.aprobar_conteo`, `isAdmin` o `isSuperadmin`; escribe `csl_producto_stock.cantidad = cantidad_contada` con `origen = 'conteo'` para cada ítem, y marca el conteo `aprobado`.
- Un conteo `aprobado` es inmutable: `saveProductCount` lanza `"Este conteo ya está aprobado y no se puede editar"`.

- [ ] **Step 1: Implementar las funciones** con la mecánica de reanudar borrador de `lib/server/materials.ts:953-1057` (buscar borrador de sucursal+fecha antes de insertar; manejar `23505`).

- [ ] **Step 2: Añadir el test de diferencias al script**

```js
import { diffConteo } from "../lib/productos-client.ts"
assert.equal(diffConteo(10, 7), -3)
assert.equal(diffConteo(0, 4), 4)
assert.equal(diffConteo(5, 5), 0)
```

- [ ] **Step 3: Cablear el dispatcher** con las 7 acciones nuevas.

- [ ] **Step 4: `pnpm lint`, correr el script de pruebas y commit**

```bash
pnpm lint && node --import tsx scripts/test-productos-inventario.mjs
git add lib/server/products-inventory.ts lib/productos-client.ts app/api/csl/_handlers.ts scripts/test-productos-inventario.mjs
git commit -m "feat(productos): conteo fisico en servidor — borrador, envio y aprobacion que ajusta stock"
```

---

### Task 9: Pantalla Conteo físico

**Files:**
- Create: `components/productos/prod-conteo-page.tsx`
- Modify: `app/page.tsx`

- [ ] **Step 1: Implementar la captura** — selector de sucursal + fecha + responsable; carga de productos con `cantidad_sistema` congelada; buscador; campo de cantidad y observación por producto; toggle «incluir productos en cero».

- [ ] **Step 2: Diferencia en vivo** — `contada − sistema`, verde/ámbar/rojo, y un resumen fijo arriba: contados, faltantes, sobrantes.

- [ ] **Step 3: Autoguardado de borrador** con el mismo temporizador de `components/req-mat-inventario-page.tsx` (debounce + estado `guardando/guardado`).

- [ ] **Step 4: Botones Enviar y Aprobar** — Aprobar solo visible con permiso; confirmación explícita porque **ajusta el stock**.

- [ ] **Step 5: `pnpm lint`, `pnpm build` y commit**

```bash
pnpm lint && pnpm build
git add components/productos/prod-conteo-page.tsx app/page.tsx
git commit -m "feat(productos): pantalla de conteo fisico con captura manual"
```

---

### Task 10: Histórico de conteos y acta en PDF

**Files:**
- Create: `components/productos/prod-conteo-historico-page.tsx`
- Modify: `lib/inventario-productos-pdf.ts` (acta del conteo)
- Modify: `app/page.tsx`

- [ ] **Step 1: Lista de conteos** — sucursal, fecha, estado, responsable, ítems, y el total de diferencias.

- [ ] **Step 2: Detalle** — tabla producto · sistema · contado · diferencia · observación, con filtro «solo diferencias».

- [ ] **Step 3: `buildActaConteoHtml`** en el mismo módulo del PDF, reusando cabecera y estilos.

- [ ] **Step 4: `pnpm lint`, `pnpm build` y commit**

```bash
pnpm lint && pnpm build
git add components/productos/prod-conteo-historico-page.tsx lib/inventario-productos-pdf.ts app/page.tsx
git commit -m "feat(productos): historico de conteos con acta de diferencias en PDF"
```

---

### Task 11: Cierre — versión, changelog y despliegue

**Files:**
- Modify: `package.json`, `CHANGELOG.md`

- [ ] **Step 1: Bump SemVer** — `0.87.1` → `0.88.0` (funcionalidad nueva, compatible).
- [ ] **Step 2: Entrada en `CHANGELOG.md`** describiendo el módulo completo.
- [ ] **Step 3: Verificación final.** Run: `pnpm lint && pnpm build && node --import tsx scripts/test-productos-inventario.mjs` → todo en verde.
- [ ] **Step 4: Commit, push y deploy**

```bash
git add package.json CHANGELOG.md
git commit -m "chore(release): v0.88.0 — modulo Inventario de Productos"
git push origin main
vercel --prod --yes --cwd /Users/willianrodriguez/Projects/csl-app
```

---

## Self-Review

**Cobertura de la spec:**

| Sección de la spec | Tarea |
|---|---|
| §4 Modelo de datos | Task 1 |
| §3 Archivo de entrada / mapeo de columnas | Task 2 |
| §6 Importador (servidor) | Task 3 |
| §5 Menús y permisos | Task 4 (menús), Task 8 (`productos.aprobar_conteo`) |
| §6 Importador (cliente) | Task 5 |
| §7 Reporte PDF | Tasks 6 y 7 |
| §8 Conteo físico | Tasks 8, 9 y 10 |
| §9 Multi-tenant y seguridad | Global Constraints + Task 3 Step 1 |
| §10 Verificación | Tasks 2, 6, 8 y 11 |

**Consistencia de nombres:** `ProductoRow`, `StockColumn`, `ReporteItem`, `ReporteSucursal`,
`buildReporteData`, `kpisDeSucursal`, `buildProductosPdfHtml`, `printProductosPdf`,
`diffConteo` se usan con la misma firma en todas las tareas que los mencionan.
