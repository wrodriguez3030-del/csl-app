# Firma digital de tratamientos en csl-app — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el cliente firme la sesión de tratamiento que recibió, dentro de csl-app, contra una sola base de datos, descontando la sesión de su paquete de forma atómica y dejando un PDF inmutable verificable.

**Architecture:** Dos tablas nuevas (`csl_tratamientos_aplicados`, `csl_tratamientos_firmas`) colgadas de `csl_paquetes` y `csl_cosmiatria_clientes`. El acto de firmar es una función de base de datos (`firmar_tratamiento`) que reclama, inserta, descuenta y marca en una sola transacción. El enlace público y el QR reusan `csl_public_form_links` con un `form_type` nuevo. Clientes, pagos, sucursales y operadoras salen de las tablas que ya existen — no se duplica nada.

**Tech Stack:** Next.js App Router · TypeScript · Supabase self-hosted (`db-cls`) · `pdf-lib` · `qrcode` · `nodemailer` · pnpm

**Spec:** `docs/superpowers/specs/2026-07-31-firma-tratamientos-csl-design.md`

---

## Global Constraints

- **Gestor de paquetes: `pnpm`.** Nunca npm ni yarn.
- **`pnpm lint` es `tsc --noEmit`.** No hay ESLint. No hay framework de tests: las pruebas son scripts `scripts/test-*.mjs` que se corren con `node --import tsx` y usan `node:assert/strict`. Patrón de referencia: `scripts/test-gift-certificates.mjs`.
- **Base de datos: Supabase self-hosted `db-cls`.** DDL con `node scripts/db-query.js --file <ruta.sql>`. Todo archivo SQL termina con `notify pgrst, 'reload schema';`.
- **Multi-tenant obligatorio.** Toda lectura y escritura filtra por `effectiveBusinessId()` (de `lib/server/business-context.ts`), **nunca** por el `business_id` del perfil del usuario. Aplica a **CSL y Depicenter**.
- **RLS deny-by-default** en toda tabla nueva, con el patrón exacto de `supabase/migrations/202607250001_agendapro_treatments_domain.sql:230-238` (`public.current_business_id()` / `public.is_superadmin()`).
- **Ninguna variable de entorno nueva con `NEXT_PUBLIC_`.** El bucket es privado; las URLs se firman en el servidor.
- **Nombres neutrales en la interfaz.** Nunca «AgendaPro» en texto visible; usar «Integración API» o «proveedor externo».
- **Etiquetas legibles.** Nunca mostrar UUID, claves internas ni JSON crudo al usuario.
- **TTL del enlace de firma: 24 horas.**
- **El PDF firmado es inmutable.** Se genera una vez, se guarda, y el hash sale del archivo guardado. No existe endpoint que edite una firma confirmada.
- **Versionado:** cada etapa cierra con bump SemVer en `package.json` + entrada en `CHANGELOG.md`.
- **Deploy:** el push **no** despliega y `vercel --prod` está en deny global para el agente. Al cerrar cada etapa, pedirle al usuario que corra `vercel --prod --yes` él mismo con `!` delante.

---

# ETAPA 1 — Firma en tableta

Al terminar la etapa 1 el sistema ya es operable: se aplica una sesión desde el paquete y el cliente firma en la tableta.

---

### Task 1: Migración — tablas, bucket y RLS

**Files:**
- Create: `supabase/migrations/202607310001_tratamientos_firma_module.sql`

**Interfaces:**
- Consumes: `public.current_business_id()`, `public.is_superadmin()` (ya existen en db-cls)
- Produces: tablas `csl_tratamientos_aplicados`, `csl_tratamientos_firmas`, `csl_paquetes_ajustes`, `csl_tratamientos_audit`; bucket `firmas-tratamientos`

- [ ] **Step 1: Escribir la migración**

```sql
-- Firma digital de tratamientos — tablas, indices, RLS y bucket privado.
-- Spec: docs/superpowers/specs/2026-07-31-firma-tratamientos-csl-design.md

-- ─── Sesion aplicada ────────────────────────────────────────────────────────
create table if not exists public.csl_tratamientos_aplicados (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid not null,
  cliente_id          text not null,
  paquete_id          text not null,
  firma_id            uuid,
  sucursal            text not null,
  operadora_id        text,
  categoria           text,
  servicio            text,
  fecha_sesion        date not null,
  spot                text,
  potencia            text,
  disparos_delantero  integer,
  disparos_trasero    integer,
  total_disparos      integer,
  comentarios         text,
  estado              text not null default 'pendiente'
                        check (estado in ('pendiente','firmado','anulado')),
  anulado_en          timestamptz,
  anulado_motivo      text,
  anulado_por         text,
  created_by          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ─── Acto de firma (1 firma cubre 1..N sesiones del mismo cliente) ──────────
create table if not exists public.csl_tratamientos_firmas (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid not null,
  cliente_id          text not null,
  firma_imagen        text,
  firma_hash_sha256   text not null,
  doc_codigo          text not null,
  pdf_path            text not null,
  firmado_en          timestamptz not null default now(),
  firmado_ip          text,
  firmado_dispositivo text,
  origen              text not null check (origen in ('tableta','enlace','qr')),
  is_locked           boolean not null default true,
  anulado_en          timestamptz,
  anulado_motivo      text,
  anulado_por         text,
  created_at          timestamptz not null default now()
);

-- ─── Ajuste manual de sesiones (etapa 4) ────────────────────────────────────
create table if not exists public.csl_paquetes_ajustes (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null,
  paquete_id    text not null,
  cliente_id    text not null,
  tipo          text not null check (tipo in ('suma','resta')),
  cantidad      integer not null check (cantidad > 0),
  motivo        text not null,
  aprobado_por  text,
  created_by    text,
  created_at    timestamptz not null default now()
);

-- ─── Auditoria del modulo ───────────────────────────────────────────────────
create table if not exists public.csl_tratamientos_audit (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null,
  entity       text not null,
  entity_id    text,
  action       text not null,
  old_values   jsonb,
  new_values   jsonb,
  reason       text,
  user_id      text,
  ip           text,
  created_at   timestamptz not null default now()
);

-- ─── FK a la firma (despues de crear ambas tablas) ──────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'csl_tratamientos_aplicados_firma_fk'
  ) then
    alter table public.csl_tratamientos_aplicados
      add constraint csl_tratamientos_aplicados_firma_fk
      foreign key (firma_id) references public.csl_tratamientos_firmas(id);
  end if;
end $$;

-- ─── Indices ────────────────────────────────────────────────────────────────
create unique index if not exists csl_tratamientos_firmas_doc_uidx
  on public.csl_tratamientos_firmas (doc_codigo);
create index if not exists csl_tratamientos_aplicados_cliente_idx
  on public.csl_tratamientos_aplicados (business_id, cliente_id, estado);
create index if not exists csl_tratamientos_aplicados_paquete_idx
  on public.csl_tratamientos_aplicados (business_id, paquete_id);
create index if not exists csl_tratamientos_aplicados_pendientes_idx
  on public.csl_tratamientos_aplicados (business_id, estado, fecha_sesion desc);
create index if not exists csl_tratamientos_firmas_cliente_idx
  on public.csl_tratamientos_firmas (business_id, cliente_id, firmado_en desc);
create index if not exists csl_tratamientos_audit_idx
  on public.csl_tratamientos_audit (business_id, entity, entity_id, created_at desc);

-- ─── RLS deny-by-default (mismo patron que 202607250001) ────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'csl_tratamientos_aplicados','csl_tratamientos_firmas',
    'csl_paquetes_ajustes','csl_tratamientos_audit'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists tenant_select on public.%I', t);
    execute format('drop policy if exists tenant_insert on public.%I', t);
    execute format('drop policy if exists tenant_update on public.%I', t);
    execute format('drop policy if exists tenant_delete on public.%I', t);
    execute format('create policy tenant_select on public.%I for select using (business_id = public.current_business_id() or public.is_superadmin())', t);
    execute format('create policy tenant_insert on public.%I for insert with check (business_id = public.current_business_id() or public.is_superadmin())', t);
    execute format('create policy tenant_update on public.%I for update using (business_id = public.current_business_id() or public.is_superadmin()) with check (business_id = public.current_business_id() or public.is_superadmin())', t);
    execute format('create policy tenant_delete on public.%I for delete using (business_id = public.current_business_id() or public.is_superadmin())', t);
  end loop;
end $$;

-- ─── Bucket privado para los PDF firmados ───────────────────────────────────
insert into storage.buckets (id, name, public)
values ('firmas-tratamientos', 'firmas-tratamientos', false)
on conflict (id) do nothing;

notify pgrst, 'reload schema';
```

- [ ] **Step 2: Aplicar la migración**

Run: `node scripts/db-query.js --file supabase/migrations/202607310001_tratamientos_firma_module.sql`
Expected: sin error.

- [ ] **Step 3: Verificar que quedó bien**

Run:
```bash
node scripts/db-query.js "select tablename, rowsecurity from pg_tables where schemaname='public' and tablename like 'csl_tratamientos%' or tablename='csl_paquetes_ajustes' order by 1"
node scripts/db-query.js "select id, public from storage.buckets where id='firmas-tratamientos'"
```
Expected: 4 tablas con `rowsecurity = true`, y el bucket con `public = false`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/202607310001_tratamientos_firma_module.sql
git commit -m "feat(firma): migracion — tablas, RLS deny-by-default y bucket privado"
```

---

### Task 2: Lógica de dominio pura + pruebas

Todo lo que se puede probar sin base de datos vive acá. Sin imports de Supabase.

**Files:**
- Create: `lib/server/tratamientos-firma.ts`
- Create: `scripts/test-firma-tratamientos.mjs`
- Modify: `package.json` (script `test:firma`)

**Interfaces:**
- Produces:
  - `type EstadoTratamiento = "pendiente" | "firmado" | "anulado"`
  - `type OrigenFirma = "tableta" | "enlace" | "qr"`
  - `interface SesionAplicable { id: string; clienteId: string; paqueteId: string; servicio: string | null; categoria: string | null; sucursal: string; fechaSesion: string; spot: string | null; potencia: string | null; totalDisparos: number | null; estado: EstadoTratamiento }`
  - `generarDocCodigo(fecha: Date, sufijo: string): string`
  - `hashArchivo(bytes: Uint8Array): string`
  - `validarAplicacion(input: EntradaAplicacion): { ok: true } | { ok: false; error: string }`
  - `interface EntradaAplicacion { fechaSesion: string; hoy: string; disparosDelantero: number | null; disparosTrasero: number | null; totalDisparos: number | null; sesionesDisponibles: number }`
  - `validarLoteFirma(sesiones: SesionAplicable[]): { ok: true } | { ok: false; error: string }`
  - `enmascararNombre(nombre: string): string`

- [ ] **Step 1: Escribir las pruebas que fallan**

Create `scripts/test-firma-tratamientos.mjs`:

```javascript
/**
 * Pruebas de la logica PURA de firma de tratamientos.
 * Correr: node --import tsx scripts/test-firma-tratamientos.mjs  (o pnpm test:firma)
 */
import assert from "node:assert/strict"
import {
  generarDocCodigo,
  hashArchivo,
  validarAplicacion,
  validarLoteFirma,
  enmascararNombre,
} from "../lib/server/tratamientos-firma.ts"

let passed = 0
function test(name, fn) { fn(); passed += 1; console.log(`  ✓ ${name}`) }

console.log("FIRMA DE TRATAMIENTOS · pruebas")

// 1. Codigo de documento
test("el codigo lleva la fecha y el sufijo", () => {
  assert.equal(generarDocCodigo(new Date("2026-07-31T15:00:00Z"), "a1b2c3"), "DOC-20260731-a1b2c3")
})
test("el codigo usa la fecha de Republica Dominicana, no UTC", () => {
  // 2026-08-01T01:00:00Z son las 21:00 del 31 de julio en RD.
  assert.equal(generarDocCodigo(new Date("2026-08-01T01:00:00Z"), "zzz"), "DOC-20260731-zzz")
})

// 2. Hash del archivo
test("el hash es estable y de 64 hex", () => {
  const h = hashArchivo(new Uint8Array([1, 2, 3]))
  assert.match(h, /^[0-9a-f]{64}$/)
  assert.equal(h, hashArchivo(new Uint8Array([1, 2, 3])))
})
test("un byte distinto cambia el hash", () => {
  assert.notEqual(hashArchivo(new Uint8Array([1, 2, 3])), hashArchivo(new Uint8Array([1, 2, 4])))
})

// 3. Validacion al aplicar una sesion
const base = {
  fechaSesion: "2026-07-31", hoy: "2026-07-31",
  disparosDelantero: null, disparosTrasero: null, totalDisparos: null,
  sesionesDisponibles: 3,
}
test("una sesion normal pasa", () => {
  assert.deepEqual(validarAplicacion(base), { ok: true })
})
test("no se puede aplicar una sesion con fecha futura", () => {
  const r = validarAplicacion({ ...base, fechaSesion: "2026-08-01" })
  assert.equal(r.ok, false)
  assert.match(r.error, /futura/i)
})
test("no se puede aplicar si el paquete no tiene sesiones", () => {
  const r = validarAplicacion({ ...base, sesionesDisponibles: 0 })
  assert.equal(r.ok, false)
  assert.match(r.error, /sesiones disponibles/i)
})
test("los disparos no pueden ser negativos", () => {
  const r = validarAplicacion({ ...base, disparosDelantero: -1 })
  assert.equal(r.ok, false)
  assert.match(r.error, /negativ/i)
})
test("si vienen los dos parciales, el total tiene que cuadrar", () => {
  const r = validarAplicacion({ ...base, disparosDelantero: 10, disparosTrasero: 5, totalDisparos: 20 })
  assert.equal(r.ok, false)
  assert.match(r.error, /total/i)
})
test("si los parciales cuadran, pasa", () => {
  assert.deepEqual(
    validarAplicacion({ ...base, disparosDelantero: 10, disparosTrasero: 5, totalDisparos: 15 }),
    { ok: true },
  )
})

// 4. Validacion del lote a firmar
const sesion = (over = {}) => ({
  id: "s1", clienteId: "cli_1", paqueteId: "paq_1", servicio: "Depilacion laser",
  categoria: "Depilacion", sucursal: "Rafael Vidal", fechaSesion: "2026-07-31",
  spot: null, potencia: null, totalDisparos: null, estado: "pendiente", ...over,
})
test("un lote de una sesion pendiente pasa", () => {
  assert.deepEqual(validarLoteFirma([sesion()]), { ok: true })
})
test("un lote vacio se rechaza", () => {
  const r = validarLoteFirma([])
  assert.equal(r.ok, false)
  assert.match(r.error, /sin sesiones/i)
})
test("no se puede firmar una sesion ya firmada", () => {
  const r = validarLoteFirma([sesion({ estado: "firmado" })])
  assert.equal(r.ok, false)
  assert.match(r.error, /ya firmada|anulada/i)
})
test("no se pueden mezclar clientes en un mismo documento", () => {
  const r = validarLoteFirma([sesion(), sesion({ id: "s2", clienteId: "cli_2" })])
  assert.equal(r.ok, false)
  assert.match(r.error, /mismo cliente/i)
})
test("varias sesiones del mismo cliente pasan", () => {
  assert.deepEqual(validarLoteFirma([sesion(), sesion({ id: "s2" })]), { ok: true })
})

// 5. Enmascarado del nombre para la pagina publica
test("el nombre se enmascara dejando la inicial del apellido", () => {
  assert.equal(enmascararNombre("Willian Rodriguez Perez"), "Willian R. P.")
})
test("un solo nombre queda igual", () => {
  assert.equal(enmascararNombre("Willian"), "Willian")
})
test("un nombre vacio no rompe", () => {
  assert.equal(enmascararNombre("   "), "—")
})

console.log(`\n${passed} pruebas OK`)
```

- [ ] **Step 2: Correr las pruebas y verificar que fallan**

Run: `node --import tsx scripts/test-firma-tratamientos.mjs`
Expected: FALLA — `Cannot find module '../lib/server/tratamientos-firma.ts'`.

- [ ] **Step 3: Implementar la lógica**

Create `lib/server/tratamientos-firma.ts`:

```typescript
/**
 * Logica PURA del modulo de firma de tratamientos. Sin base de datos, sin red.
 * Todo lo que se pueda decidir sin tocar Supabase vive aca para poder probarlo.
 *
 * Spec: docs/superpowers/specs/2026-07-31-firma-tratamientos-csl-design.md
 */
import { createHash } from "node:crypto"

export type EstadoTratamiento = "pendiente" | "firmado" | "anulado"
export type OrigenFirma = "tableta" | "enlace" | "qr"

export interface SesionAplicable {
  id: string
  clienteId: string
  paqueteId: string
  servicio: string | null
  categoria: string | null
  sucursal: string
  fechaSesion: string
  spot: string | null
  potencia: string | null
  totalDisparos: number | null
  estado: EstadoTratamiento
}

export interface EntradaAplicacion {
  fechaSesion: string
  hoy: string
  disparosDelantero: number | null
  disparosTrasero: number | null
  totalDisparos: number | null
  sesionesDisponibles: number
}

export type Validacion = { ok: true } | { ok: false; error: string }

const TZ = "America/Santo_Domingo"

/** 'YYYYMMDD' en hora de Republica Dominicana. */
function fechaCompacta(fecha: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(fecha).replace(/-/g, "")
}

/** Codigo visible del documento: DOC-20260731-a1b2c3. */
export function generarDocCodigo(fecha: Date, sufijo: string): string {
  return `DOC-${fechaCompacta(fecha)}-${sufijo}`
}

/** SHA-256 hex del ARCHIVO guardado — no de la plantilla ni de los datos. */
export function hashArchivo(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

export function validarAplicacion(input: EntradaAplicacion): Validacion {
  if (input.sesionesDisponibles <= 0) {
    return { ok: false, error: "El paquete no tiene sesiones disponibles." }
  }
  if (input.fechaSesion > input.hoy) {
    return { ok: false, error: "No se puede registrar una sesión con fecha futura." }
  }
  const partes = [input.disparosDelantero, input.disparosTrasero, input.totalDisparos]
  for (const v of partes) {
    if (v != null && v < 0) return { ok: false, error: "Los disparos no pueden ser negativos." }
  }
  const { disparosDelantero: d, disparosTrasero: t, totalDisparos: total } = input
  if (d != null && t != null && total != null && d + t !== total) {
    return { ok: false, error: `El total de disparos no cuadra: ${d} + ${t} debería dar ${d + t}.` }
  }
  return { ok: true }
}

export function validarLoteFirma(sesiones: SesionAplicable[]): Validacion {
  if (!sesiones.length) return { ok: false, error: "No hay sesiones para firmar (lote sin sesiones)." }
  const noPendiente = sesiones.find((s) => s.estado !== "pendiente")
  if (noPendiente) {
    return { ok: false, error: "Hay una sesión ya firmada o anulada en el lote." }
  }
  const cliente = sesiones[0].clienteId
  if (sesiones.some((s) => s.clienteId !== cliente)) {
    return { ok: false, error: "Todas las sesiones de un documento deben ser del mismo cliente." }
  }
  return { ok: true }
}

/** 'Willian Rodriguez Perez' → 'Willian R. P.' — para la pagina publica de validacion. */
export function enmascararNombre(nombre: string): string {
  const partes = String(nombre || "").trim().split(/\s+/).filter(Boolean)
  if (!partes.length) return "—"
  const [primero, ...resto] = partes
  return [primero, ...resto.map((p) => `${p[0].toUpperCase()}.`)].join(" ")
}
```

- [ ] **Step 4: Correr las pruebas y verificar que pasan**

Run: `node --import tsx scripts/test-firma-tratamientos.mjs`
Expected: `18 pruebas OK`.

- [ ] **Step 5: Registrar el script de pruebas**

Modify `package.json`, en `"scripts"`, después de `"test:gift"`:

```json
"test:firma": "node --import tsx scripts/test-firma-tratamientos.mjs",
```

Run: `pnpm test:firma`
Expected: pasa.

- [ ] **Step 6: Commit**

```bash
git add lib/server/tratamientos-firma.ts scripts/test-firma-tratamientos.mjs package.json
git commit -m "feat(firma): logica de dominio pura + 18 pruebas"
```

---

### Task 3: La función atómica `firmar_tratamiento`

El corazón: reclamar, insertar, descontar y marcar — todo junto o nada.

**Files:**
- Create: `supabase/migrations/202607310002_firmar_tratamiento_rpc.sql`

**Interfaces:**
- Produces: `public.firmar_tratamiento(uuid, text, uuid[], text, text, text, text, text, text, text) returns uuid` (devuelve el `id` de la firma creada)

- [ ] **Step 1: Escribir la función**

```sql
-- Acto de firma: reclama las sesiones, inserta la firma, descuenta las
-- sesiones del paquete y marca todo. Una sola transaccion.
-- Si algo falla, no pasa NADA: ni se descuenta ni queda firma huerfana.

create or replace function public.firmar_tratamiento(
  p_business_id    uuid,
  p_cliente_id     text,
  p_tratamiento_ids uuid[],
  p_firma_imagen   text,
  p_firma_hash     text,
  p_doc_codigo     text,
  p_pdf_path       text,
  p_origen         text,
  p_ip             text,
  p_dispositivo    text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_firma_id  uuid;
  v_count     integer;
  v_paquete   text;
  v_descontadas integer := 0;
begin
  if p_tratamiento_ids is null or array_length(p_tratamiento_ids, 1) is null then
    raise exception 'No hay sesiones para firmar';
  end if;

  -- 1. Bloquear las sesiones y verificar que TODAS sigan pendientes y sean
  --    del cliente y del negocio indicados. FOR UPDATE serializa los
  --    intentos concurrentes (doble clic, enlace abierto dos veces).
  select count(*) into v_count
  from public.csl_tratamientos_aplicados
  where id = any(p_tratamiento_ids)
    and business_id = p_business_id
    and cliente_id = p_cliente_id
    and estado = 'pendiente'
  for update;

  if v_count <> array_length(p_tratamiento_ids, 1) then
    raise exception 'Alguna sesión ya fue firmada, anulada o no pertenece a este cliente';
  end if;

  -- 2. Insertar el acto de firma (uno solo, cubra las sesiones que cubra).
  insert into public.csl_tratamientos_firmas
    (business_id, cliente_id, firma_imagen, firma_hash_sha256, doc_codigo,
     pdf_path, firmado_ip, firmado_dispositivo, origen)
  values
    (p_business_id, p_cliente_id, p_firma_imagen, p_firma_hash, p_doc_codigo,
     p_pdf_path, p_ip, p_dispositivo, p_origen)
  returning id into v_firma_id;

  -- 3. Descontar UNA sesion por cada tratamiento firmado, con guarda:
  --    el UPDATE solo aplica si todavia queda saldo.
  for v_paquete in
    select paquete_id from public.csl_tratamientos_aplicados
    where id = any(p_tratamiento_ids)
  loop
    update public.csl_paquetes
       set sesiones_disponibles = sesiones_disponibles - 1,
           updated_at = now()
     where paquete_id = v_paquete
       and business_id = p_business_id
       and sesiones_disponibles > 0;
    if not found then
      raise exception 'El paquete % ya no tiene sesiones disponibles', v_paquete;
    end if;
    v_descontadas := v_descontadas + 1;
  end loop;

  -- 4. Marcar las sesiones como firmadas y atarlas a la firma.
  update public.csl_tratamientos_aplicados
     set estado = 'firmado', firma_id = v_firma_id, updated_at = now()
   where id = any(p_tratamiento_ids);

  -- 5. Auditoria.
  insert into public.csl_tratamientos_audit
    (business_id, entity, entity_id, action, new_values, ip)
  values
    (p_business_id, 'firma', v_firma_id::text, 'firma_creada',
     jsonb_build_object('docCodigo', p_doc_codigo, 'sesiones', v_descontadas,
                        'origen', p_origen, 'hash', p_firma_hash),
     p_ip);

  return v_firma_id;
end $$;

revoke all on function public.firmar_tratamiento(uuid, text, uuid[], text, text, text, text, text, text, text) from public, anon, authenticated;

notify pgrst, 'reload schema';
```

- [ ] **Step 2: Verificar que `paquete_id` identifica una sola fila**

La función descuenta con `where paquete_id = v_paquete`. Si `paquete_id` no fuera único por negocio, ese `UPDATE` tocaría varias filas y descontaría de más. Compruébalo antes de aplicar nada:

Run:
```bash
node scripts/db-query.js "select paquete_id, count(*) n from public.csl_paquetes group by 1 having count(*) > 1 limit 5"
```
Expected: cero filas.

Si devuelve algo, **detente y avisa**: hay que cambiar la función para descontar por `id` en vez de por `paquete_id` antes de seguir.

- [ ] **Step 3: Aplicar**

Run: `node scripts/db-query.js --file supabase/migrations/202607310002_firmar_tratamiento_rpc.sql`
Expected: sin error.

- [ ] **Step 4: Probar el camino feliz y el de conflicto contra la base real**

Run:
```bash
node scripts/db-query.js "
do \$\$
declare
  b uuid; p text := 'paq_test_firma'; t uuid; f uuid; disp integer;
begin
  select business_id into b from public.csl_paquetes limit 1;
  insert into public.csl_paquetes (paquete_id, business_id, cliente_id, sucursal, servicio, sesiones_adquiridas, sesiones_disponibles, origen, estado)
    values (p, b, 'cli_test_firma', 'Rafael Vidal', 'Prueba', 2, 2, 'manual', 'disponible');
  insert into public.csl_tratamientos_aplicados (business_id, cliente_id, paquete_id, sucursal, servicio, fecha_sesion)
    values (b, 'cli_test_firma', p, 'Rafael Vidal', 'Prueba', current_date) returning id into t;

  f := public.firmar_tratamiento(b, 'cli_test_firma', array[t], 'x', 'hash', 'DOC-TEST-1', 'ruta.pdf', 'tableta', '1.2.3.4', 'test');
  select sesiones_disponibles into disp from public.csl_paquetes where paquete_id = p;
  if disp <> 1 then raise exception 'FALLO: se esperaba 1 sesion disponible, hay %', disp; end if;

  begin
    perform public.firmar_tratamiento(b, 'cli_test_firma', array[t], 'x', 'h', 'DOC-TEST-2', 'r.pdf', 'tableta', null, null);
    raise exception 'FALLO: permitio firmar dos veces la misma sesion';
  exception when others then
    if sqlerrm like 'FALLO:%' then raise; end if;
  end;

  select sesiones_disponibles into disp from public.csl_paquetes where paquete_id = p;
  if disp <> 1 then raise exception 'FALLO: el segundo intento descontó, hay %', disp; end if;

  delete from public.csl_tratamientos_audit where business_id = b and entity_id = f::text;
  delete from public.csl_tratamientos_aplicados where paquete_id = p;
  delete from public.csl_tratamientos_firmas where id = f;
  delete from public.csl_paquetes where paquete_id = p;
  raise notice 'OK: firma descuenta una vez y el reintento no descuenta';
end \$\$;"
```
Expected: `NOTICE: OK: firma descuenta una vez y el reintento no descuenta`, sin excepción `FALLO:`.

- [ ] **Step 5: Confirmar que no quedaron datos de prueba**

Run: `node scripts/db-query.js "select count(*) n from public.csl_paquetes where paquete_id='paq_test_firma'"`
Expected: `n = 0`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/202607310002_firmar_tratamiento_rpc.sql
git commit -m "feat(firma): funcion atomica firmar_tratamiento — descuento sin doble cobro"
```

---

### Task 4: El PDF del documento firmado

**Files:**
- Create: `lib/server/tratamiento-pdf.ts`
- Read first: `lib/server/consent-depilacion-pdf.ts` (para copiar el estilo de membrete y el uso de `pdf-lib`)

**Interfaces:**
- Consumes: `SesionAplicable` de `lib/server/tratamientos-firma.ts`
- Produces: `construirPdfTratamiento(datos: DatosDocumento): Promise<Uint8Array>` y `interface DatosDocumento`

- [ ] **Step 1: Leer el generador de PDF que ya existe**

Run: `sed -n '1,80p' lib/server/consent-depilacion-pdf.ts`

Fíjate en cómo obtiene la marca del negocio y cómo dibuja la firma. Reusa ese estilo — el documento de tratamiento tiene que verse hermano de los consentimientos, no de otro sistema.

- [ ] **Step 2: Implementar el generador**

Create `lib/server/tratamiento-pdf.ts` con esta interfaz exacta:

```typescript
/**
 * PDF del comprobante de tratamiento firmado. Se genera UNA sola vez y se
 * guarda tal cual: el hash sale del archivo, no de la plantilla. Si esta
 * plantilla cambia, los documentos ya firmados NO se regeneran.
 */
import type { SesionAplicable } from "./tratamientos-firma"

export interface DatosDocumento {
  docCodigo: string
  negocio: { nombre: string; logoUrl?: string | null; colorPrimario?: string | null }
  cliente: { nombre: string; documento?: string | null; telefono?: string | null }
  sesiones: SesionAplicable[]
  operadora: string | null
  firmaImagenDataUrl: string
  firmadoEn: Date
  ip: string | null
  dispositivo: string | null
}

export async function construirPdfTratamiento(datos: DatosDocumento): Promise<Uint8Array>
```

El documento lleva, en este orden: membrete del negocio · título «Comprobante de tratamiento» · el `docCodigo` · datos del cliente · una tabla con las sesiones (fecha, servicio, sucursal, operadora, y spot/potencia/disparos si se anotaron) · el texto de conformidad · la firma · y un pie con fecha y hora, IP, dispositivo y la mención de la Ley 126-02.

Texto de conformidad, literal:

> Confirmo haber recibido el/los tratamiento(s) descrito(s) y autorizo el descuento de las sesiones correspondientes. Firma con validez conforme a la Ley 126-02 sobre Comercio Electrónico, Documentos y Firmas Digitales de la República Dominicana.

El hash **no** va dentro del PDF: se calcula sobre el archivo terminado, así que meterlo adentro sería imposible. Va en la página de verificación y en la base.

Pasa todo el texto por el saneador que ya existe (`pdfText` de `lib/server/csl-pdf.ts`) para no romper la fuente estándar con tildes.

- [ ] **Step 3: Verificar que compila y produce un PDF válido**

Run:
```bash
node --import tsx -e "
import('./lib/server/tratamiento-pdf.ts').then(async (m) => {
  const bytes = await m.construirPdfTratamiento({
    docCodigo: 'DOC-20260731-test01',
    negocio: { nombre: 'Cibao Spa Laser' },
    cliente: { nombre: 'Cliente De Prueba' },
    sesiones: [{ id:'s1', clienteId:'c1', paqueteId:'p1', servicio:'Depilación láser', categoria:'Depilación', sucursal:'Rafael Vidal', fechaSesion:'2026-07-31', spot:'15', potencia:'12', totalDisparos:300, estado:'pendiente' }],
    operadora: 'Ashley',
    firmaImagenDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    firmadoEn: new Date('2026-07-31T19:00:00Z'), ip: '1.2.3.4', dispositivo: 'iPad',
  })
  const { writeFileSync } = await import('node:fs')
  writeFileSync('/tmp/doc-prueba.pdf', bytes)
  console.log('bytes:', bytes.length, bytes.length > 1000 ? 'OK' : 'DEMASIADO CHICO')
})"
```
Expected: `bytes: <n> OK`. Abre `/tmp/doc-prueba.pdf` y confirma a ojo que se lee bien y que la firma aparece.

- [ ] **Step 4: Correr lint**

Run: `pnpm lint`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add lib/server/tratamiento-pdf.ts
git commit -m "feat(firma): PDF del comprobante de tratamiento"
```

---

### Task 5: Handlers del servidor

**Files:**
- Create: `lib/server/tratamientos-handlers.ts`
- Modify: `app/api/csl/_handlers.ts` (agregar los `case` que delegan)

**Interfaces:**
- Consumes: `effectiveBusinessId()`, `getBusinessContext()` de `lib/server/business-context.ts`; `getSupabaseAdmin()` de `lib/server/supabase.ts`; todo lo de `lib/server/tratamientos-firma.ts` y `lib/server/tratamiento-pdf.ts`; la RPC `firmar_tratamiento`
- Produces, todos exportados desde `lib/server/tratamientos-handlers.ts`:
  - `aplicarTratamiento(params): Promise<{ ok: boolean; id?: string; error?: string }>`
  - `getTratamientosPendientes(params): Promise<{ ok: boolean; sesiones: SesionAplicable[] }>`
  - `firmarTratamientos(params, req): Promise<{ ok: boolean; docCodigo?: string; error?: string }>`

- [ ] **Step 1: Leer el patrón de handlers y de auditoría**

Run:
```bash
sed -n '4283,4300p' app/api/csl/_handlers.ts   # getControlTratamientos: aislamiento por tenant
sed -n '55,80p' lib/server/purchases.ts        # logAudit best-effort
```

Fíjate en dos cosas que son obligatorias: el `business_id` sale de `effectiveBusinessId()` (no del perfil), y el `cliente_id` se valida con `/^[A-Za-z0-9_-]+$/` antes de usarlo en cualquier filtro.

- [ ] **Step 2: Implementar `aplicarTratamiento`**

Crea la sesión en `pendiente`. Antes de insertar: lee el paquete (filtrando por `business_id` y `cliente_id`), y llama a `validarAplicacion()` con `sesionesDisponibles` del paquete y `hoy` en hora de RD. Copia `categoria` y `servicio` **del paquete** al registro (snapshot). Escribe auditoría `accion='sesion_aplicada'`. Requiere el permiso `tratamientos-aplicar`.

**No descuenta nada** — el descuento ocurre solo al firmar.

- [ ] **Step 3: Implementar `getTratamientosPendientes`**

Devuelve las sesiones `pendiente` del cliente, filtradas por `effectiveBusinessId()`, ordenadas por `fecha_sesion` descendente, mapeadas a `SesionAplicable`.

- [ ] **Step 4: Implementar `firmarTratamientos` — el orden importa**

Este es el orden exacto, y no se puede cambiar. Escríbelo así:

```typescript
export async function firmarTratamientos(
  params: { clienteId: string; sesionIds: string[]; firmaImagenB64: string;
            origen: OrigenFirma; token?: string },
  req: { ip: string | null; userAgent: string | null },
): Promise<{ ok: boolean; docCodigo?: string; error?: string; status?: number }> {
  const businessId = effectiveBusinessId()
  if (!businessId) return { ok: false, error: "Sin negocio activo", status: 400 }
  if (!/^[A-Za-z0-9_-]+$/.test(params.clienteId)) {
    return { ok: false, error: "clienteId con formato inválido", status: 400 }
  }
  const sb = getSupabaseAdmin()

  // 1. El codigo se genera primero: el claim del enlace lo usa como referencia.
  const docCodigo = generarDocCodigo(new Date(), randomBytes(6).toString("hex"))

  // 2. Claim atomico del enlace, si la firma viene por enlace o QR.
  if (params.token) {
    const claimed = await claimPublicFormLink(params.token, docCodigo)
    if (!claimed) {
      return { ok: false, status: 409,
        error: "El enlace ya fue usado, expiró o fue cancelado. Pide uno nuevo al personal." }
    }
  }

  // 3. Leer las sesiones y validar el lote ANTES de gastar en generar el PDF.
  const sesiones = await leerSesiones(sb, businessId, params.clienteId, params.sesionIds)
  const val = validarLoteFirma(sesiones)
  if (!val.ok) return { ok: false, error: val.error, status: 409 }

  // 4-5. El PDF se genera una sola vez y el hash sale del archivo.
  const bytes = await construirPdfTratamiento(await armarDatosDocumento(sb, businessId, docCodigo, sesiones, params, req))
  const hash = hashArchivo(bytes)

  // 6. Subir al bucket privado.
  const pdfPath = `${businessId}/${docCodigo}.pdf`
  const up = await sb.storage.from("firmas-tratamientos")
    .upload(pdfPath, bytes, { contentType: "application/pdf", upsert: false })
  if (up.error) return { ok: false, error: "No se pudo guardar el documento", status: 500 }

  // 7. El acto atomico: inserta la firma, descuenta y marca.
  const { data: firmaId, error } = await sb.rpc("firmar_tratamiento", {
    p_business_id: businessId,
    p_cliente_id: params.clienteId,
    p_tratamiento_ids: params.sesionIds,
    p_firma_imagen: params.firmaImagenB64,
    p_firma_hash: hash,
    p_doc_codigo: docCodigo,
    p_pdf_path: pdfPath,
    p_origen: params.origen,
    p_ip: req.ip,
    p_dispositivo: req.userAgent?.slice(0, 100) ?? null,
  })

  // 8. Compensacion: si la RPC fallo, el PDF subido queda huerfano. Borrarlo.
  if (error || !firmaId) {
    await sb.storage.from("firmas-tratamientos").remove([pdfPath]).catch(() => {})
    return { ok: false, error: error?.message || "No se pudo firmar", status: 409 }
  }

  // 9. El correo NO bloquea: la firma ya es valida aunque el correo falle.
  void enviarComprobante(sb, businessId, params.clienteId, bytes, docCodigo)
    .catch((e) => console.warn("[firma] correo:", e.message))

  return { ok: true, docCodigo }
}
```

El paso 8 no es opcional: sin él, cada carrera perdida deja un PDF huérfano en el bucket.

Implementa además los tres auxiliares que usa: `leerSesiones` (lee y mapea a `SesionAplicable`, filtrando por `business_id` y `cliente_id`), `armarDatosDocumento` (arma el `DatosDocumento` con la marca del negocio, el cliente y la operadora) y `enviarComprobante` (Task 12 — por ahora déjalo como una función que no hace nada y devuelve `Promise.resolve()`).

- [ ] **Step 5: Colgar los `case` en el router**

Modify `app/api/csl/_handlers.ts`: agrega tres `case` (`"aplicarTratamiento"`, `"getTratamientosPendientes"`, `"firmarTratamientos"`) que solo delegan a `lib/server/tratamientos-handlers.ts`. Nada de lógica en el router — ese archivo ya pasa de 4000 líneas.

- [ ] **Step 6: Verificar de punta a punta contra la base**

Run: `pnpm lint`
Expected: sin errores.

Luego levanta `pnpm dev` y, con sesión iniciada, aplica una sesión de prueba a un cliente real desde la interfaz y confirma en la base:

```bash
node scripts/db-query.js "select id, cliente_id, paquete_id, servicio, estado from public.csl_tratamientos_aplicados order by created_at desc limit 3"
```
Expected: la fila nueva en `pendiente`, con `servicio` copiado del paquete.

- [ ] **Step 7: Commit**

```bash
git add lib/server/tratamientos-handlers.ts app/api/csl/_handlers.ts
git commit -m "feat(firma): handlers de aplicar, listar pendientes y firmar"
```

---

### Task 6: Interfaz — pestañas, «Aplicar sesión» y el pad

**Files:**
- Modify: `lib/menus.ts` (permisos nuevos)
- Modify: `lib/types.ts` (los `TabId` nuevos)
- Create: `components/tratamientos/aplicar-sesion-dialog.tsx`
- Create: `components/tratamientos/firmar-sesiones-dialog.tsx`
- Modify: `components/control-tratamientos-page.tsx` (pestañas + KPI)

**Interfaces:**
- Consumes: `SignaturePad` de `components/signature-pad.tsx` (props: `label`, `value`, `onChange`, `heightClass`); `apiJsonp` y `useAppStore` de `lib/store`
- Produces: los componentes de diálogo, cada uno con `onDone: () => void` para que la pantalla recargue

- [ ] **Step 1: Agregar los permisos al catálogo**

Modify `lib/menus.ts`, en la sección «Clientes y Consentimientos», justo después de `control-tratamientos` (línea 107):

```typescript
  // Permisos de acción del módulo de firma (no navegables), mismo patrón
  // que `sincronizar-api`.
  { id: "tratamientos-aplicar", label: "Aplicar sesión y firmar", section: "Clientes y Consentimientos" },
  { id: "tratamientos-firmados", label: "Historial de tratamientos firmados", section: "Clientes y Consentimientos" },
  { id: "tratamientos-anular", label: "Anular sesión firmada", section: "Clientes y Consentimientos" },
  { id: "paquetes-ajustes", label: "Ajustar sesiones de un paquete", section: "Clientes y Consentimientos" },
```

Agrega los cuatro ids a `TabId` en `lib/types.ts`.

- [ ] **Step 2: Verificar que el catálogo compila**

Run: `pnpm lint`
Expected: sin errores. Si `TabId` es un union literal, el error te va a decir exactamente cuál falta.

- [ ] **Step 3: El diálogo de aplicar sesión**

`components/tratamientos/aplicar-sesion-dialog.tsx`. Se abre desde el botón «Aplicar sesión» de cada paquete con `sesiones_disponibles > 0`.

Campos: fecha (por defecto hoy, no permite futuro), sucursal y operadora precargadas del paquete y del perfil, y un bloque colapsado «Datos técnicos (opcional)» con spot, potencia, disparos delantero, trasero y total. Servicio y categoría se muestran **solo lectura** — vienen del paquete.

Al guardar llama a `aplicarTratamiento` y ofrece dos salidas: **«Firmar ahora»** (abre el diálogo de firma) y **«Dejar pendiente»**.

- [ ] **Step 4: El diálogo de firma**

`components/tratamientos/firmar-sesiones-dialog.tsx`. Recibe el cliente y la lista de sesiones pendientes con casillas para escoger cuáles se firman — **por defecto todas marcadas**.

Muestra el texto de conformidad, el `SignaturePad` y dos botones: «Limpiar» y «Firmar». El de firmar arranca deshabilitado hasta que haya trazo, y se deshabilita mientras se envía para que un doble toque no mande dos veces.

Al terminar muestra el `docCodigo` y un botón para ver el PDF.

- [ ] **Step 5: Las pestañas y el KPI**

Modify `components/control-tratamientos-page.tsx`:

- Renombrar el KPI `firmas_pendientes` a **«Consentimientos pendientes»** (hoy dice «Firmas pendientes» y cuenta consentimientos — es el nombre equivocado).
- Agregar el KPI **«Sesiones sin firmar»**, que cuenta `csl_tratamientos_aplicados` en `pendiente`.
- Agregar la pestaña **«Sesiones»**: las sesiones del cliente con su estado, y el botón «Firmar» en las pendientes.
- En la tabla de paquetes, agregar la columna de acción con «Aplicar sesión», gateada por el permiso `tratamientos-aplicar`.

Las columnas de acciones usan `<RowActions>` con iconos y tooltip, nunca texto suelto.

- [ ] **Step 6: Probarlo en el navegador**

Run: `pnpm dev`

Recorrido completo: abrir Control Digital de Tratamientos → buscar un cliente con paquete → «Aplicar sesión» → «Firmar ahora» → firmar → confirmar que sale el `docCodigo`.

Luego verificar el descuento:
```bash
node scripts/db-query.js "select p.paquete_id, p.sesiones_disponibles, t.estado, f.doc_codigo from public.csl_tratamientos_aplicados t join public.csl_paquetes p on p.paquete_id=t.paquete_id left join public.csl_tratamientos_firmas f on f.id=t.firma_id order by t.created_at desc limit 3"`
```
Expected: la sesión en `firmado`, con `doc_codigo`, y `sesiones_disponibles` con una menos que antes.

- [ ] **Step 7: Cerrar la etapa 1**

```bash
pnpm lint
pnpm build
```
Expected: ambos sin errores.

Bump menor en `package.json` (`0.86.2` → `0.87.0`) y entrada en `CHANGELOG.md` bajo `## [0.87.0]` describiendo: firma de tratamientos en tableta, descuento atómico de sesiones, PDF inmutable con hash, y el renombre del KPI.

```bash
git add -A
git commit -m "feat(firma): firma de tratamientos en tableta v0.87.0"
git push origin main
```

- [ ] **Step 8: Pedir el deploy al usuario**

`vercel --prod` está en deny global para el agente. Decirle al usuario:

> Etapa 1 lista y subida. Para desplegarla corre: `!vercel --prod --yes`

---

# ETAPA 2 — Enlace de WhatsApp y QR

---

### Task 7: El `form_type` nuevo y la creación del enlace

**Files:**
- Modify: `lib/server/public-form-links.ts:19-34` (`FormType` y `FORM_TYPE_LABEL`)
- Modify: `lib/server/tratamientos-handlers.ts` (handler `crearEnlaceFirma`)
- Modify: `app/api/csl/_handlers.ts` (el `case`)

**Interfaces:**
- Consumes: `createPublicFormLink({ businessId, formType, createdBy, clienteNombre, clienteTelefono, prefillPayload, ttlHours })`
- Produces: `crearEnlaceFirma(params): Promise<{ ok: boolean; url?: string; expiraEn?: string; error?: string }>`

- [ ] **Step 1: Agregar el tipo**

Modify `lib/server/public-form-links.ts`: agrega `| "firma_tratamiento"` al union `FormType` y esta entrada a `FORM_TYPE_LABEL`:

```typescript
  firma_tratamiento: "Firma de tratamiento",
```

- [ ] **Step 2: Verificar que no rompió nada**

Run: `pnpm lint`
Expected: sin errores. Si algún `switch` sobre `FormType` era exhaustivo, TypeScript te va a señalar exactamente dónde falta el caso nuevo — atiéndelos todos.

- [ ] **Step 3: Implementar `crearEnlaceFirma`**

Los ids de las sesiones viajan en `prefillPayload` como texto separado por comas (el payload es `Record<string, string>`), junto con `clienteId` y `clienteNombre`:

```typescript
prefillPayload: {
  clienteId,
  nombre: clienteNombre,
  telefono: clienteTelefono,
  sesionIds: ids.join(","),
}
```

`ttlHours: 24`. Devuelve la URL completa `${origin}/firmar/${token}`. **El token plano se devuelve una sola vez y no se guarda.** Auditoría: `accion='enlace_firma_creado'`.

Aprovecha que `createPublicFormLink` ya auto-cancela los enlaces vivos anteriores del mismo cliente y tipo cuando hay `clienteId` en el prefill (`public-form-links.ts:211-225`) — así no quedan dos URLs válidas circulando.

- [ ] **Step 4: Probar la creación**

Run: `pnpm dev`, generar un enlace desde la interfaz, y verificar:

```bash
node scripts/db-query.js "select form_type, usado, cancelado, expira_en, prefill_payload from public.csl_public_form_links where form_type='firma_tratamiento' order by created_at desc limit 1"
```
Expected: `usado=false`, `cancelado=false`, `expira_en` ~24 h adelante, y `prefill_payload` con `sesionIds`.

- [ ] **Step 5: Commit**

```bash
git add lib/server/public-form-links.ts lib/server/tratamientos-handlers.ts app/api/csl/_handlers.ts
git commit -m "feat(firma): enlace publico de firma con vencimiento de 24h"
```

---

### Task 8: La página pública de firma

**Files:**
- Create: `app/api/public/firma/[token]/route.ts`
- Create: `app/firmar/[token]/page.tsx`
- Read first: `app/formulario-publico/[token]/page.tsx` (patrón de página pública ya en producción)

**Interfaces:**
- Consumes: `verifyPublicFormLink(token)`, `firmarTratamientos(...)`
- Produces: `GET /api/public/firma/[token]` → `{ status: "valido"|"usado"|"expirado"|"cancelado"|"invalido"|"sin_pendientes", cliente?, tratamientos?, expiraEn? }`; `POST /api/public/firma/[token]` → `{ ok: true, docCodigo }` o `{ error }`

No hay `middleware.ts` en este proyecto, así que **no hay lista de rutas públicas que actualizar** — la ruta es pública por no exigir sesión.

- [ ] **Step 1: Leer la página pública que ya existe**

Run: `sed -n '1,70p' app/formulario-publico/[token]/page.tsx`

- [ ] **Step 2: Implementar el GET**

Verifica el enlace sin mutar nada. Si el estado es `valido`, además comprueba que las sesiones de `prefill_payload.sesionIds` sigan `pendiente`; si ninguna lo está, devuelve `status: "sin_pendientes"`.

Devuelve solo lo que el cliente necesita ver: su nombre, y por cada sesión el servicio, la operadora, la sucursal y la fecha. **Nunca** `business_id`, ni `paquete_id`, ni ids internos.

- [ ] **Step 3: Implementar el POST**

Recibe `{ firmaImagenB64 }`. Llama a `firmarTratamientos` con `origen: "enlace"` y el token, que es quien hace el claim atómico. La IP sale de `x-forwarded-for` y el dispositivo del `user-agent` recortado a 100 caracteres.

Si el claim falla, responde 409 con: `"El enlace ya fue usado, expiró o fue cancelado. Pide uno nuevo al personal."`

- [ ] **Step 4: Implementar la página**

`app/firmar/[token]/page.tsx`, pensada para celular: la marca del negocio (`getBusinessBranding`), el nombre del cliente, la lista de lo que va a firmar, el texto de conformidad, el `SignaturePad` y los botones «Limpiar» y «Firmar».

Cada estado del enlace tiene su pantalla con mensaje claro, en español, sin jerga: usado, expirado, cancelado, inválido y sin pendientes.

- [ ] **Step 5: Probarlo en un celular de verdad**

Run: `pnpm dev`

Genera un enlace, ábrelo en el teléfono, firma, y confirma que la sesión quedó firmada y descontada. Después **vuelve a abrir el mismo enlace**: tiene que decir que ya fue usado, y `sesiones_disponibles` no puede haber bajado otra vez.

```bash
node scripts/db-query.js "select doc_codigo, origen, firmado_ip, firmado_dispositivo from public.csl_tratamientos_firmas order by firmado_en desc limit 1"
```
Expected: `origen='enlace'`, con IP y dispositivo.

- [ ] **Step 6: Commit**

```bash
git add app/api/public/firma app/firmar
git commit -m "feat(firma): pagina publica de firma por enlace"
```

---

### Task 9: QR y botón de WhatsApp

**Files:**
- Create: `components/tratamientos/enviar-a-firmar-dialog.tsx`
- Modify: `components/control-tratamientos-page.tsx`

**Interfaces:**
- Consumes: `crearEnlaceFirma`; el paquete `qrcode` (ya instalado)
- Produces: `EnviarAFirmarDialog` con props `{ clienteId, clienteNombre, clienteTelefono, sesionIds, onDone }`

- [ ] **Step 1: Implementar el diálogo**

Al abrirse pide el enlace y muestra tres cosas: **el QR** (generado con `qrcode` sobre la URL), **«Abrir WhatsApp»** (que arma `https://wa.me/<telefono>?text=...`) y **«Copiar enlace»**.

Debajo, en texto legible: «Vence el 1 de agosto a las 3:04 p. m.» — fecha formateada en hora de RD, nunca el ISO crudo.

El teléfono es **el vigente del cliente**, leído en el momento de abrir el diálogo, no un valor copiado antes.

- [ ] **Step 2: Colgarlo de la pantalla**

En la pestaña «Sesiones», el botón «Enviar a firmar» sobre las sesiones pendientes seleccionadas.

- [ ] **Step 3: Probar el recorrido de QR**

Run: `pnpm dev`

Escanea el QR con el celular, firma, y confirma que el `origen` quedó registrado.

- [ ] **Step 4: Cerrar la etapa 2**

```bash
pnpm lint
pnpm build
```

Bump a `0.88.0`, entrada en `CHANGELOG.md`, commit y push.

```bash
git add -A
git commit -m "feat(firma): enlace de WhatsApp y QR para firmar v0.88.0"
git push origin main
```

Pedirle al usuario: `!vercel --prod --yes`

---

# ETAPA 3 — Historial, verificación y correo

---

### Task 10: Historial y reimpresión

**Files:**
- Create: `components/tratamientos/tratamientos-firmados-page.tsx`
- Modify: `lib/server/tratamientos-handlers.ts` (`getTratamientosFirmados`, `getPdfFirmaUrl`)
- Modify: `app/api/csl/_handlers.ts`, `components/sidebar.tsx`, `app/page.tsx` (registrar la pantalla)

**Interfaces:**
- Produces: `getTratamientosFirmados(params): Promise<{ ok: boolean; filas: FilaFirmada[] }>`; `getPdfFirmaUrl(params): Promise<{ ok: boolean; url?: string }>`

- [ ] **Step 1: Implementar `getTratamientosFirmados`**

Filtros: rango de fechas, sucursal, cliente y estado (vigente / anulado). Paginado **server-side** — nunca traer todo (esta tabla crece con cada sesión, y ya te pasó el timeout con 16k filas en Clientes).

- [ ] **Step 2: Implementar `getPdfFirmaUrl`**

Devuelve una **URL firmada de 60 segundos** del bucket privado:

```typescript
const { data } = await getSupabaseAdmin().storage
  .from("firmas-tratamientos")
  .createSignedUrl(pdfPath, 60)
```

Nunca hacer público el bucket ni el objeto.

- [ ] **Step 3: La pantalla**

Tabla con fecha, cliente, servicio, sucursal, operadora, `docCodigo`, estado y `<RowActions>` con «Ver PDF». Exportación a Excel con `<ExportExcelButton>` si el módulo de reportes lo ofrece.

- [ ] **Step 4: Probar**

Run: `pnpm dev` → abrir el historial, ver un PDF, confirmar que la URL vence.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(firma): historial de tratamientos firmados con URL firmada"
```

---

### Task 11: Verificación pública por código

**Files:**
- Create: `app/api/public/validar-firma/[codigo]/route.ts`
- Create: `app/validar-firma/[codigo]/page.tsx`
- Read first: `app/validar-depicenter/page.tsx`

**Interfaces:**
- Consumes: `enmascararNombre()` de `lib/server/tratamientos-firma.ts`
- Produces: `GET /api/public/validar-firma/[codigo]` → `{ valido: boolean, cliente?, servicios?, fecha?, sucursal?, estado?: "vigente"|"anulado", sesionesAnuladas?: number, hash? }`

- [ ] **Step 1: Implementar el endpoint**

Busca por `doc_codigo`. Devuelve el nombre del cliente **enmascarado** (`enmascararNombre`), los servicios, la fecha, la sucursal, el hash y el estado.

El estado es `anulado` solo si **todas** las sesiones del documento están anuladas; si hay algunas anuladas y otras no, el estado es `vigente` y `sesionesAnuladas` dice cuántas.

**Nunca** devolver el PDF ni la imagen de la firma desde acá.

- [ ] **Step 2: Implementar la página**

Buscador por código y el resultado. Verde para vigente, rojo para anulado, gris para no encontrado. Muestra el hash en monoespaciado para que se pueda comparar a mano.

- [ ] **Step 3: Probar los tres casos**

Con un código real: vigente. Con uno inventado: no encontrado. (El caso anulado se prueba al terminar la etapa 4.)

- [ ] **Step 4: Commit**

```bash
git add app/api/public/validar-firma app/validar-firma
git commit -m "feat(firma): verificacion publica por codigo de documento"
```

---

### Task 12: Correo del PDF al cliente

**Files:**
- Modify: `lib/server/tratamientos-handlers.ts`
- Read first: `lib/server/csl-email.ts`, `lib/server/email-settings.ts`

**Interfaces:**
- Consumes: el transporte Gmail por negocio que ya existe

- [ ] **Step 1: Leer cómo se manda hoy un consentimiento por correo**

Run: `grep -n "export async function" lib/server/csl-email.ts`

- [ ] **Step 2: Enviar el comprobante**

Después de firmar, si el cliente tiene correo, mandar el PDF adjunto desde el Gmail del negocio. **Nunca bloqueante**: si el correo falla, la firma ya está hecha y válida — se registra el aviso y se sigue.

Si el negocio no tiene correo configurado, el patrón `notConfigured` que ya existe debe hacer que simplemente no se mande, sin error visible.

- [ ] **Step 3: Probar con un cliente con correo real**

Confirmar que llega con el PDF adjunto y que el remitente es el Gmail del negocio correcto (probar en **los dos** negocios).

- [ ] **Step 4: Cerrar la etapa 3**

```bash
pnpm lint
pnpm build
```

Bump a `0.89.0`, `CHANGELOG.md`, commit, push, y pedirle al usuario `!vercel --prod --yes`.

---

# ETAPA 4 — Anulación y ajustes

---

### Task 13: Anular una sesión firmada

**Files:**
- Create: `supabase/migrations/202607310003_anular_tratamiento_rpc.sql`
- Modify: `lib/server/tratamientos-handlers.ts`, `app/api/csl/_handlers.ts`
- Modify: `components/tratamientos/tratamientos-firmados-page.tsx`

**Interfaces:**
- Produces: `public.anular_tratamiento(uuid, uuid, text, text) returns void` — `(p_business_id, p_tratamiento_id, p_motivo, p_usuario)`

- [ ] **Step 1: Escribir la función**

```sql
-- Anula UNA sesion firmada: devuelve la sesion al paquete y marca la sesion.
-- El PDF no se toca. La firma solo se marca anulada cuando TODAS sus
-- sesiones quedan anuladas.

create or replace function public.anular_tratamiento(
  p_business_id   uuid,
  p_tratamiento_id uuid,
  p_motivo        text,
  p_usuario       text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_paquete   text;
  v_firma     uuid;
  v_vivas     integer;
begin
  if p_motivo is null or btrim(p_motivo) = '' then
    raise exception 'El motivo de la anulación es obligatorio';
  end if;

  select paquete_id, firma_id into v_paquete, v_firma
  from public.csl_tratamientos_aplicados
  where id = p_tratamiento_id and business_id = p_business_id and estado = 'firmado'
  for update;

  if v_paquete is null then
    raise exception 'La sesión no existe, no está firmada o es de otro negocio';
  end if;

  update public.csl_paquetes
     set sesiones_disponibles = sesiones_disponibles + 1, updated_at = now()
   where paquete_id = v_paquete and business_id = p_business_id;

  update public.csl_tratamientos_aplicados
     set estado = 'anulado', anulado_en = now(), anulado_motivo = p_motivo,
         anulado_por = p_usuario, updated_at = now()
   where id = p_tratamiento_id;

  -- La firma se marca anulada solo si ya no le queda ninguna sesion viva.
  select count(*) into v_vivas
  from public.csl_tratamientos_aplicados
  where firma_id = v_firma and estado <> 'anulado';

  if v_vivas = 0 then
    update public.csl_tratamientos_firmas
       set anulado_en = now(), anulado_motivo = p_motivo, anulado_por = p_usuario
     where id = v_firma;
  end if;

  insert into public.csl_tratamientos_audit
    (business_id, entity, entity_id, action, new_values, reason, user_id)
  values
    (p_business_id, 'tratamiento', p_tratamiento_id::text, 'sesion_anulada',
     jsonb_build_object('paquete', v_paquete, 'firmaCerrada', v_vivas = 0),
     p_motivo, p_usuario);
end $$;

revoke all on function public.anular_tratamiento(uuid, uuid, text, text) from public, anon, authenticated;

notify pgrst, 'reload schema';
```

- [ ] **Step 2: Aplicar y probar que devuelve la sesión**

Run: `node scripts/db-query.js --file supabase/migrations/202607310003_anular_tratamiento_rpc.sql`

Luego, con una sesión firmada de prueba: anularla, y confirmar que `sesiones_disponibles` subió en uno y que el PDF sigue en el bucket.

- [ ] **Step 3: La interfaz**

En el historial, `<RowActions>` gana «Anular», visible solo con el permiso `tratamientos-anular`. Abre un diálogo con **motivo obligatorio** y un aviso claro de que el documento firmado se conserva.

- [ ] **Step 4: Confirmar que la verificación pública lo refleja**

Abrir `/validar-firma/<codigo>` del documento anulado.
Expected: dice ANULADO. Si el documento cubría varias sesiones y solo se anuló una, dice vigente e indica cuántas se anularon.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(firma): anular sesion firmada con motivo, devolviendo la sesion al paquete"
```

---

### Task 14: Ajustes manuales de sesiones

**Files:**
- Modify: `lib/server/tratamientos-handlers.ts`, `app/api/csl/_handlers.ts`
- Create: `components/tratamientos/ajustar-sesiones-dialog.tsx`

**Interfaces:**
- Produces: `ajustarSesionesPaquete(params): Promise<{ ok: boolean; error?: string }>`

- [ ] **Step 1: Implementar el handler**

Escribe en `csl_paquetes_ajustes` y aplica el delta a `csl_paquetes.sesiones_disponibles` en la misma llamada. Requiere el permiso `paquetes-ajustes`. **Motivo obligatorio.** Una resta nunca puede dejar `sesiones_disponibles` en negativo.

- [ ] **Step 2: El diálogo**

Desde la tabla de paquetes: tipo (sumar / restar), cantidad y motivo. Muestra el saldo antes y después.

- [ ] **Step 3: Probar el borde**

Intentar restar más sesiones de las que hay.
Expected: lo rechaza con un mensaje claro, sin dejar el saldo en negativo.

- [ ] **Step 4: Cerrar la etapa 4**

```bash
pnpm lint
pnpm build
pnpm test:firma
```

Bump a `0.90.0`, `CHANGELOG.md`, commit, push, y pedirle al usuario `!vercel --prod --yes`.

- [ ] **Step 5: Retirar Cibao Firma**

Con las cuatro etapas en producción, avisarle al usuario que Cibao Firma ya se puede apagar, y recordarle lo que hay allá: 6 clientes, 5 paquetes y 11 firmas de piloto que **no se migran** (decisión del spec, §12).

No apagar nada sin que el usuario lo pida.

---

## Notas de seguridad — revisar en cada tarea

Las tres reglas, verificadas tarea por tarea:

1. **Secretos sin `NEXT_PUBLIC_`.** Este módulo no agrega ninguna variable de entorno. El bucket es privado y las URLs se firman en el servidor con vida de 60 segundos.
2. **SQL parametrizado.** Todo va por PostgREST o por funciones con argumentos tipados. El `cliente_id` se valida con `/^[A-Za-z0-9_-]+$/` antes de entrar en cualquier filtro `.or()` de PostgREST — el mismo blindaje de `_handlers.ts:4295`.
3. **RLS deny-by-default.** Las cuatro tablas nuevas nacen con RLS activo y policies por `business_id` (Task 1, Step 1). El bucket nace privado. Las funciones son `security definer` con `search_path` fijo y `revoke` a `public`, `anon` y `authenticated`.

Además, en cada tarea que toque datos: filtrar por `effectiveBusinessId()`, **nunca** por el `business_id` del perfil del usuario.
