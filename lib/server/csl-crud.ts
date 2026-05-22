/**
 * Acceso CRUD genérico contra Supabase para todas las entidades CSL.
 *
 * Mantiene un mapa único `ENTITY_TABLES` (entidad → { tabla, clave, orden })
 * para que los handlers no toquen nombres de tabla directamente.
 */

import { getSupabaseAdmin } from "./supabase"
import { fichaClientPatchFromCliente, fromDb, mergeClienteRows } from "./csl-transforms"
import { getBusinessContext } from "./business-context"
import type { BusinessContext, Row } from "./csl-types"

/**
 * Tablas que NO tienen columna business_id y deben quedar exentas de filtro
 * tenant. Si un caller invoca getRows/upsertRow contra una de estas, el
 * contexto se ignora.
 */
const TENANT_EXEMPT_TABLES = new Set<string>([
  // Tabla de tenants en sí — global, no per-business
  "businesses",
])

export const SYSTEM_ENTITIES = ["sucursales", "equipos", "reportes", "piezas", "tecnicos", "inventario"] as const
export const PULSOS_ENTITIES = ["operadoras", "lecturas_semanales", "sesiones_cliente", "auditorias_semanales"] as const

export const ENTITY_TABLES: Record<string, { table: string; key: string; order?: string }> = {
  sucursales: { table: "csl_sucursales", key: "codigo", order: "nombre" },
  equipos: { table: "csl_equipos", key: "equipo_id", order: "equipo_id" },
  reportes: { table: "csl_reportes", key: "report_id", order: "fecha" },
  piezas: { table: "csl_piezas", key: "pieza", order: "pieza" },
  tecnicos: { table: "csl_tecnicos", key: "codigo", order: "nombre" },
  inventario: { table: "csl_inventario", key: "item_id", order: "pieza" },
  operadoras: { table: "csl_operadoras", key: "operadora_id", order: "nombre" },
  lecturas_semanales: { table: "csl_lecturas_semanales", key: "lectura_id", order: "fecha_semana" },
  sesiones_cliente: { table: "csl_sesiones_cliente", key: "sesion_id", order: "fecha" },
  auditorias_semanales: { table: "csl_auditorias_semanales", key: "auditoria_id", order: "fecha_semana" },
  credenciales: { table: "csl_credenciales", key: "credencial_id", order: "sucursal" },
  solicitudes_empleo: { table: "csl_solicitudes_empleo", key: "solicitud_id", order: "fecha_solicitud" },
  empleados: { table: "csl_empleados", key: "empleado_id", order: "nombre" },
  cosmiatria_clientes: { table: "csl_cosmiatria_clientes", key: "cliente_id", order: "nombre" },
  ficha_dermatologica: { table: "csl_ficha_dermatologica", key: "ficha_id", order: "fecha" },
  csl_consent_masajes: { table: "csl_consent_masajes", key: "consent_id", order: "fecha" },
  csl_consent_tatuajes_cejas: { table: "csl_consent_tatuajes_cejas", key: "consent_id", order: "fecha" },
  certificados_regalo: { table: "csl_certificados_regalo", key: "codigo", order: "fecha" },
  certificados_depicenter: { table: "csl_certificados_depicenter", key: "codigo", order: "fecha" },
  piezas_poliza_lista: { table: "csl_piezas_poliza_lista", key: "id", order: "fecha_solicitada" },
}

export function tableConfig(entity: string) {
  const config = ENTITY_TABLES[entity]
  if (!config) throw new Error(`Entidad no soportada: ${entity}`)
  return config
}

export async function getRows(entity: string): Promise<Row[]> {
  const supabase = getSupabaseAdmin()
  const config = tableConfig(entity)
  // Auto-aplicar filter por business_id desde el contexto del request.
  // Service Role bypasa RLS, así que el filtro EXPLÍCITO acá es la única defensa.
  const ctx = getBusinessContext()
  const applyTenant = ctx && !ctx.isSuperadmin && !TENANT_EXEMPT_TABLES.has(config.table)
  const pageSize = 1000
  let from = 0
  const rows: Row[] = []

  while (true) {
    let query = supabase.from(config.table).select("*")
    if (applyTenant) {
      query = query.eq("business_id", ctx!.businessId)
    }
    if (config.order) {
      query = query.order(config.order, { ascending: entity !== "reportes" && entity !== "sesiones_cliente" })
    }
    const { data, error } = await query.range(from, from + pageSize - 1)
    if (error) throw error
    rows.push(...((data || []) as Row[]))
    if (!data || data.length < pageSize) break
    from += pageSize
  }

  return rows.map((row) => fromDb(entity, row))
}

/**
 * Lectura paginada para módulos que pueden crecer (reportes, sesiones).
 * Ya disponible como primitiva; el frontend la usará cuando los volúmenes
 * lo justifiquen.
 *
 * `filters` aplica como `eq` por columna; valores `undefined`/`null` se ignoran.
 */
export async function getRowsPaged(
  entity: string,
  options: {
    limit: number
    offset?: number
    ascending?: boolean
    filters?: Record<string, string | number | boolean | null | undefined>
  },
): Promise<{ rows: Row[]; total: number }> {
  const supabase = getSupabaseAdmin()
  const config = tableConfig(entity)
  const offset = Math.max(0, options.offset ?? 0)
  const limit = Math.max(1, Math.min(1000, options.limit))
  const ascending = options.ascending ?? (entity !== "reportes" && entity !== "sesiones_cliente")
  // Tenant filter: idéntico patrón que getRows.
  const ctx = getBusinessContext()
  const applyTenant = ctx && !ctx.isSuperadmin && !TENANT_EXEMPT_TABLES.has(config.table)

  let query = supabase.from(config.table).select("*", { count: "exact" })
  if (applyTenant) {
    query = query.eq("business_id", ctx!.businessId)
  }
  if (config.order) query = query.order(config.order, { ascending })

  for (const [column, value] of Object.entries(options.filters ?? {})) {
    if (value === undefined || value === null || value === "") continue
    query = query.eq(column, value)
  }

  const { data, error, count } = await query.range(offset, offset + limit - 1)
  if (error) throw error

  return {
    rows: ((data || []) as Row[]).map((row) => fromDb(entity, row)),
    total: count ?? 0,
  }
}

export async function upsertRow(entity: string, row: Row) {
  const supabase = getSupabaseAdmin()
  const config = tableConfig(entity)
  if (!row[config.key]) throw new Error(`Falta clave ${config.key}`)

  // Inyectar business_id desde contexto. Si el caller pasó uno y NO es
  // superadmin, debe coincidir con su tenant (anti-fuga).
  const ctx = getBusinessContext()
  const applyTenant = ctx && !TENANT_EXEMPT_TABLES.has(config.table)
  const payload: Row = { ...row, updated_at: new Date().toISOString() }
  if (applyTenant) {
    if (!ctx!.isSuperadmin && payload.business_id && payload.business_id !== ctx!.businessId) {
      throw new Error(`Intento de escribir en business_id ajeno bloqueado`)
    }
    if (!payload.business_id) {
      payload.business_id = ctx!.businessId
    }
  }

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const { error } = await supabase
      .from(config.table)
      .upsert(payload, { onConflict: config.key })

    if (!error) return
    const missingColumn = /'([^']+)' column/.exec(error.message || "")?.[1]
    if (entity !== "ficha_dermatologica" || !missingColumn || !(missingColumn in payload)) throw error
    delete payload[missingColumn]
  }
  throw new Error(`No se pudo guardar ${entity}: demasiadas columnas pendientes de migración`)
}

export async function deleteRow(entity: string, keyValue: string) {
  const supabase = getSupabaseAdmin()
  const config = tableConfig(entity)
  if (!keyValue) throw new Error(`Falta clave para eliminar ${entity}`)

  // Tenant verification: si hay contexto y no es superadmin, solo permite
  // borrar rows que pertenecen al business del user.
  const ctx = getBusinessContext()
  const applyTenant = ctx && !ctx.isSuperadmin && !TENANT_EXEMPT_TABLES.has(config.table)

  let query = supabase.from(config.table).delete().eq(config.key, keyValue)
  if (applyTenant) {
    query = query.eq("business_id", ctx!.businessId)
  }
  const { error } = await query
  if (error) throw error
}

export async function updateRowFields(entity: string, keyValue: string, fields: Row) {
  const supabase = getSupabaseAdmin()
  const config = tableConfig(entity)
  const ctx = getBusinessContext()
  const applyTenant = ctx && !ctx.isSuperadmin && !TENANT_EXEMPT_TABLES.has(config.table)

  // Sanitizar: no permitir cambiar business_id desde fields (sería escape de tenant).
  const safeFields = { ...fields }
  if (applyTenant && safeFields.business_id) {
    delete safeFields.business_id
  }

  let query = supabase
    .from(config.table)
    .update({ ...safeFields, updated_at: new Date().toISOString() })
    .eq(config.key, keyValue)
  if (applyTenant) {
    query = query.eq("business_id", ctx!.businessId)
  }
  const { error } = await query
  if (error) throw error
}

/** Snapshot de las entidades del sistema base + consentimientos. */
export async function getAllData() {
  const [sucursales, equipos, reportes, piezas, tecnicos, inventario, consentMasajes, consentTatuajesCejas] = await Promise.all([
    ...SYSTEM_ENTITIES.map((entity) => getRows(entity)),
    getRows("csl_consent_masajes").catch(() => []),
    getRows("csl_consent_tatuajes_cejas").catch(() => []),
  ])
  return { sucursales, equipos, reportes, piezas, tecnicos, inventario, consentMasajes, consentTatuajesCejas }
}

/** Snapshot del módulo PulseControl. */
export async function getAllPulsosData() {
  const [operadoras, lecturasSemanales, sesionesCliente, auditoriasSemanales] = await Promise.all(
    PULSOS_ENTITIES.map((entity) => getRows(entity))
  )
  return { operadoras, lecturasSemanales, sesionesCliente, auditoriasSemanales }
}

// ---------- composite ops cosmiatría ----------

export async function upsertClienteCosmiatriaPreserving(row: Row) {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from("csl_cosmiatria_clientes")
    .select("*")
    .eq("cliente_id", row.cliente_id)
    .maybeSingle()
  if (error) throw error
  const merged = mergeClienteRows(data as Row | null, row)
  await upsertRow("cosmiatria_clientes", merged)
  return merged
}

export async function syncFichasCliente(cliente: Row) {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from("csl_ficha_dermatologica")
    .select("*")
    .eq("cliente_id", cliente.cliente_id)
  if (error) throw error
  const patch = fichaClientPatchFromCliente(cliente)
  for (const ficha of (data || []) as Row[]) {
    await updateRowFields("ficha_dermatologica", String(ficha.ficha_id), {
      nombre: patch.nombre,
      telefono: patch.telefono,
      cedula: patch.cedula,
      email: patch.email,
      ciudad: patch.ciudad,
      sucursal: patch.sucursal,
      payload_json: { ...((ficha.payload_json as Row) || {}), ...patch },
    })
  }
}

// ---------- resolución robusta de cliente_id (anti-duplicado) ----------

/**
 * Devuelve un `cliente_id` estable para un payload de cliente / ficha /
 * consentimiento, evitando duplicados cuando un mismo cliente vuelve sin
 * cédula/teléfono.
 *
 * Estrategia (en orden):
 *   1. ID explícito en payload.
 *   2. Cédula  → `cli_doc_<digits>` (determinístico).
 *   3. Teléfono → `cli_tel_<digits>` (determinístico).
 *   4. Email → consulta `csl_cosmiatria_clientes` por email.
 *   5. Nombre + apellido + fecha de nacimiento → consulta exacta.
 *   6. Nombre + fecha de nacimiento → ID determinístico `cli_n_<slug>_<YYYYMMDD>`.
 *   7. Último recurso: timestamp (sólo si payload trae casi nada).
 */
export async function resolveClienteId(payload: Row): Promise<string> {
  const explicit = String(payload.ClienteID ?? payload.clienteId ?? payload.cliente_id ?? "").trim()
  if (explicit) return explicit

  const onlyDigitsLocal = (value: unknown) => String(value ?? "").replace(/\D/g, "")
  const documento = onlyDigitsLocal(payload.DocumentoIdentidad ?? payload.documentoIdentidad ?? payload.cedula ?? payload.Cedula)
  if (documento) return `cli_doc_${documento}`

  const telefono = onlyDigitsLocal(payload.Telefono ?? payload.telefono ?? payload.celular ?? payload.Celular)
  if (telefono) return `cli_tel_${telefono}`

  const supabase = getSupabaseAdmin()
  const email = String(payload.Email ?? payload.email ?? payload.correo ?? payload.Correo ?? "").trim().toLowerCase()
  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    const { data } = await supabase
      .from("csl_cosmiatria_clientes")
      .select("cliente_id")
      .ilike("email", email)
      .limit(1)
      .maybeSingle()
    if (data && (data as Row).cliente_id) return String((data as Row).cliente_id)
  }

  const nombre = String(payload.Nombre ?? payload.nombre ?? "").trim()
  const apellido = String(payload.Apellido ?? payload.apellido ?? "").trim()
  const fechaNac = String(payload.FechaNacimiento ?? payload.fechaNacimiento ?? "").trim().slice(0, 10)

  if (nombre && fechaNac) {
    let q = supabase
      .from("csl_cosmiatria_clientes")
      .select("cliente_id")
      .ilike("nombre", nombre)
      .eq("fecha_nacimiento", fechaNac)
    if (apellido) q = q.ilike("apellido", apellido)
    const { data } = await q.limit(1).maybeSingle()
    if (data && (data as Row).cliente_id) return String((data as Row).cliente_id)
  }

  if (nombre && fechaNac) {
    const slug = (nombre + apellido)
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 30)
    return `cli_n_${slug}_${fechaNac.replaceAll("-", "")}`
  }

  return `cli_${Date.now()}`
}

// ---------- composite ops perfil ----------

export async function getProfile(userId: string) {
  const { data, error } = await getSupabaseAdmin()
    .from("csl_user_profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle()
  if (error) throw error
  return data as Row | null
}

export async function requireAdmin(userId: string) {
  const profile = await getProfile(userId)
  if (!profile?.is_admin) throw new Error("Solo un administrador puede gestionar usuarios")
  return profile
}

/**
 * Más estricto que requireAdmin: requiere is_superadmin = true.
 * Usado por el módulo de gestión de usuarios cross-tenant, donde un
 * admin normal no debería poder crear/asignar usuarios a OTROS negocios.
 *
 * Lanza con mensaje claro si: no hay profile / inactivo / no superadmin.
 */
export async function requireSuperadmin(userId: string) {
  if (!userId) throw new Error("No autenticado")
  const profile = await getProfile(userId)
  if (!profile) throw new Error("Perfil no encontrado")
  if (profile.activo === false) throw new Error("Usuario inactivo")
  if (!profile.is_superadmin) throw new Error("Acceso denegado: se requiere rol superadmin")
  return profile
}

// ═════════════════════════════════════════════════════════════════════════════
// Multi-tenant helpers (preparados, no activos)
// ═════════════════════════════════════════════════════════════════════════════
// Las funciones de abajo APLICAN filtro/inyección por business_id usando un
// BusinessContext (ver csl-types.ts). Nadie las llama todavía: los handlers
// actuales usan getRows/upsertRow/etc. sin filtro y eso sigue funcionando.
//
// Activación posterior (después de aplicar las migraciones SQL 202605220*):
//   1. _handlers.ts construye BusinessContext desde el JWT (loadBusinessContext)
//   2. Reemplaza llamadas a getRows(entity) → getRowsForBusiness(entity, ctx)
//   3. Reemplaza upsertRow(entity, row) → upsertRowForBusiness(entity, row, ctx)
//   4. Etc.
//
// Cero impacto en producción mientras no se llamen.
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Lee el BusinessContext del usuario logueado. Devuelve null si la columna
 * business_id aún no existe en csl_user_profiles (pre-migración 002) o si
 * el usuario no tiene business asignado.
 */
export async function loadBusinessContext(userId: string): Promise<BusinessContext | null> {
  if (!userId) return null
  const supabase = getSupabaseAdmin()
  try {
    const { data, error } = await supabase
      .from("csl_user_profiles")
      .select("business_id, is_superadmin, businesses(slug)")
      .eq("user_id", userId)
      .maybeSingle()
    if (error || !data) return null
    const row = data as Row
    const businessId = row.business_id ? String(row.business_id) : null
    if (!businessId) return null
    const businesses = row.businesses as { slug?: string } | undefined
    return {
      businessId,
      businessSlug: String(businesses?.slug ?? "csl"),
      isSuperadmin: Boolean(row.is_superadmin),
    }
  } catch {
    // Si la columna no existe (pre-migración), Supabase retorna error 42703.
    // Devolvemos null para que el caller use lógica legacy.
    return null
  }
}

/**
 * getRows + filtro business_id. Superadmin ve todo.
 * Usa el mismo cliente admin (Service Role) que getRows para no requerir
 * todavía el JWT pass-through del usuario. Cuando se active RLS (Fase 5
 * del plan), esto se reemplaza por un cliente con anon + JWT.
 */
export async function getRowsForBusiness(entity: string, ctx: BusinessContext): Promise<Row[]> {
  if (ctx.isSuperadmin) return getRows(entity)
  const supabase = getSupabaseAdmin()
  const config = tableConfig(entity)
  const pageSize = 1000
  let from = 0
  const rows: Row[] = []
  while (true) {
    let query = supabase.from(config.table).select("*").eq("business_id", ctx.businessId)
    if (config.order) {
      query = query.order(config.order, { ascending: entity !== "reportes" && entity !== "sesiones_cliente" })
    }
    const { data, error } = await query.range(from, from + pageSize - 1)
    if (error) throw error
    rows.push(...((data || []) as Row[]))
    if (!data || data.length < pageSize) break
    from += pageSize
  }
  return rows.map((row) => fromDb(entity, row))
}

/**
 * upsertRow con inyección de business_id. Para superadmin, si el row trae
 * business_id explícito lo respeta; sino, usa el del contexto.
 */
export async function upsertRowForBusiness(entity: string, row: Row, ctx: BusinessContext) {
  const businessId = ctx.isSuperadmin && row.business_id ? row.business_id : ctx.businessId
  const enriched: Row = { ...row, business_id: businessId }
  return upsertRow(entity, enriched)
}

/**
 * deleteRow con verificación de business_id. Un usuario no puede borrar
 * rows de otro tenant aunque tenga el key.
 */
export async function deleteRowForBusiness(entity: string, keyValue: string, ctx: BusinessContext) {
  if (ctx.isSuperadmin) return deleteRow(entity, keyValue)
  if (!keyValue) throw new Error(`Falta clave para eliminar ${entity}`)
  const supabase = getSupabaseAdmin()
  const config = tableConfig(entity)
  const { error } = await supabase
    .from(config.table)
    .delete()
    .eq(config.key, keyValue)
    .eq("business_id", ctx.businessId)
  if (error) throw error
}

/**
 * updateRowFields con verificación + inyección de business_id.
 */
export async function updateRowFieldsForBusiness(
  entity: string,
  keyValue: string,
  fields: Row,
  ctx: BusinessContext,
) {
  const supabase = getSupabaseAdmin()
  const config = tableConfig(entity)
  let query = supabase
    .from(config.table)
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq(config.key, keyValue)
  if (!ctx.isSuperadmin) query = query.eq("business_id", ctx.businessId)
  const { error } = await query
  if (error) throw error
}
