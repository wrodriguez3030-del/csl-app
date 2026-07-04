/**
 * Acceso CRUD genérico contra Supabase para todas las entidades CSL.
 *
 * Mantiene un mapa único `ENTITY_TABLES` (entidad → { tabla, clave, orden })
 * para que los handlers no toquen nombres de tabla directamente.
 */

import { getSupabaseAdmin } from "./supabase"
import { fichaClientPatchFromCliente, fromDb, mergeClienteRows } from "./csl-transforms"
import { getBusinessContext, scopeByBranch } from "./business-context"
import {
  assertMaintenanceWriteAllowed,
  recordMaintenanceAudit,
} from "./maintenance-guard"
import { normalizeSucursal, sucursalAllowedForTenant } from "@/lib/normalize-pulse"
import type { BusinessContext, Row } from "./csl-types"

/**
 * Columnas de auditoría que pueden NO existir aún si la migración
 * 202606110001 está pendiente en la DB. Si un INSERT/UPDATE falla por una de
 * estas, la quitamos del payload y reintentamos — el bloqueo de mantenimiento
 * (lógica de app) sigue funcionando aunque la columna no exista todavía.
 */
const AUDIT_OPTIONAL_COLS = new Set<string>(["change_source", "created_by", "updated_by"])

/**
 * Error CLARO cuando una escritura no afecta ninguna fila. Supabase NO lanza
 * error si el filtro (clave + business_id) no calza con ninguna fila — devuelve
 * éxito con 0 filas. Sin esta guardia el frontend mostraría "guardado
 * correctamente" mientras la DB no cambió, y al recargar todo vuelve atrás.
 */
function noRowsError(entity: string): Error {
  if (entity === "equipos") {
    return new Error("No se actualizó ningún equipo. Verifica business_id, permisos o RLS.")
  }
  return new Error(`No se actualizó ningún registro de ${entity}. Verifica business_id, permisos o RLS.`)
}

/**
 * Tablas exentas del filtro por business_id.
 *
 * Dos razones para exentar:
 *   1) Tablas que NO tienen columna business_id (ej. `businesses` misma).
 *   2) Catálogos técnicos COMPARTIDOS — los conoce todo el sistema sin
 *      importar la empresa del usuario. Hoy:
 *        - csl_piezas: catálogo de piezas para reportes técnicos. Mismo
 *          inventario físico es relevante a CSL y a Depicenter (ej. "Filtro
 *          de agua", "Flashlamp", "Fuente de poder"). Aislar por business
 *          forzaría a duplicar 38 filas en cada empresa y mantenerlas en
 *          sync manualmente.
 *
 *  NO incluido (siguen separados por empresa):
 *    - csl_equipos, csl_reportes, csl_operadoras, csl_lecturas_semanales,
 *      csl_sesiones_cliente, csl_auditorias_semanales: datos operacionales.
 *    - csl_tecnicos: personas con relación laboral a UNA empresa.
 *    - csl_inventario: stock físico per-sucursal.
 *    - csl_sucursales: per-empresa.
 *    - csl_credenciales: secretos per-tenant.
 */
const TENANT_EXEMPT_TABLES = new Set<string>([
  "businesses",
  "csl_piezas",
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
  csl_consent_peeling: { table: "csl_consent_peeling", key: "consent_id", order: "fecha" },
  csl_consent_tatuajes_cejas: { table: "csl_consent_tatuajes_cejas", key: "consent_id", order: "fecha" },
  csl_consent_depilacion_laser: { table: "csl_consent_depilacion_laser", key: "consent_id", order: "fecha" },
  certificados_regalo: { table: "csl_certificados_regalo", key: "codigo", order: "fecha" },
  certificados_depicenter: { table: "csl_certificados_depicenter", key: "codigo", order: "fecha" },
  piezas_poliza_lista: { table: "csl_piezas_poliza_lista", key: "id", order: "fecha_solicitada" },
}

export function tableConfig(entity: string) {
  const config = ENTITY_TABLES[entity]
  if (!config) throw new Error(`Entidad no soportada: ${entity}`)
  return config
}

/**
 * Opciones de getRows para optimizar egress:
 *
 *   - `columns`: lista CSV de columnas a seleccionar. Si se omite, `*`.
 *     Para listados ligeros pasar SOLO los campos visibles. Por ejemplo
 *     un listado de reportes no necesita firmas+fotos+piezas_json+checklist
 *     — esos pesan ~60 KB/fila vs ~500 B sin ellos.
 *   - `sinceColumn` + `sinceDays`: filtro por fecha para no traer histórico
 *     completo. Ej. para `csl_sesiones_cliente` traer solo últimas N semanas.
 *   - `limit`: cap absoluto de filas. Útil para listados con paginación
 *     server-side futura.
 */
export interface GetRowsOptions {
  columns?: string
  sinceColumn?: string
  sinceDays?: number
  limit?: number
}

export async function getRows(entity: string, options?: GetRowsOptions): Promise<Row[]> {
  const supabase = getSupabaseAdmin()
  const config = tableConfig(entity)
  // Auto-aplicar filter por business_id desde el contexto del request.
  // Service Role bypasa RLS, así que el filtro EXPLÍCITO acá es la única defensa.
  const ctx = getBusinessContext()
  const applyTenant = ctx && !ctx.bypassTenantFilter && !TENANT_EXEMPT_TABLES.has(config.table)
  const select = options?.columns || "*"
  const cap = options?.limit ?? Infinity
  const pageSize = Math.min(1000, cap === Infinity ? 1000 : cap)
  let from = 0
  const rows: Row[] = []

  // Filtro por fecha — usado para que sesiones_cliente no traiga las 24,000
  // filas históricas en cada getAllPulsosData (egress crítico).
  let sinceIso: string | null = null
  if (options?.sinceColumn && options?.sinceDays && options.sinceDays > 0) {
    const d = new Date()
    d.setDate(d.getDate() - options.sinceDays)
    sinceIso = d.toISOString().slice(0, 10)
  }

  while (rows.length < cap) {
    let query = supabase.from(config.table).select(select)
    if (applyTenant) {
      query = query.eq("business_id", ctx!.businessId)
    }
    if (sinceIso && options?.sinceColumn) {
      query = query.gte(options.sinceColumn, sinceIso)
    }
    if (config.order) {
      query = query.order(config.order, { ascending: entity !== "reportes" && entity !== "sesiones_cliente" })
    }
    const remaining = cap - rows.length
    const batch = Math.min(pageSize, remaining)
    const { data, error } = await query.range(from, from + batch - 1)
    if (error) throw error
    // Cast a unknown primero porque supabase-js infiere tipos distintos
    // cuando se pasa un select string custom vs "*".
    rows.push(...((data || []) as unknown as Row[]))
    if (!data || data.length < batch) break
    from += batch
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
  const applyTenant = ctx && !ctx.bypassTenantFilter && !TENANT_EXEMPT_TABLES.has(config.table)

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

export async function upsertRow(entity: string, row: Row, opts?: { targetBusinessId?: string }) {
  const supabase = getSupabaseAdmin()
  const config = tableConfig(entity)
  if (!row[config.key]) throw new Error(`Falta clave ${config.key}`)

  // GUARDIA MANTENIMIENTO: si la tabla es protegida, exige un cambio manual
  // autorizado en el contexto async; si no, bloquea + audita auto_change_blocked.
  const maintScope = await assertMaintenanceWriteAllowed(config.table, "upsert", {
    entity,
    recordKey: String(row[config.key] ?? ""),
  })

  // Inyectar business_id. Si el caller pasó uno y NO es superadmin, debe
  // coincidir con su tenant (anti-fuga).
  const ctx = getBusinessContext()
  const exempt = TENANT_EXEMPT_TABLES.has(config.table)
  const payload: Row = { ...row, updated_at: new Date().toISOString() }
  // Estampar el origen del cambio manual en la fila protegida.
  if (maintScope) {
    payload.change_source = maintScope.source
    payload.updated_by = maintScope.userId
  }
  if (!exempt) {
    if (opts?.targetBusinessId) {
      // Tenant explícito: la fila pertenece a ESE negocio. Anti-fuga: un
      // no-superadmin no puede apuntar a otro tenant. Un superadmin SÍ puede
      // aunque esté scopeado (bypassTenantFilter=false): el ruteo por sucursal
      // de los imports (businessIdForRowSucursal) manda cada fila a su tenant
      // dueño sin que el superadmin cambie el negocio activo.
      if (ctx && !ctx.bypassTenantFilter && !ctx.isSuperadmin && opts.targetBusinessId !== ctx.businessId) {
        throw new Error(`Intento de escribir en business_id ajeno bloqueado`)
      }
      payload.business_id = opts.targetBusinessId
    } else if (ctx) {
      if (!ctx.bypassTenantFilter && payload.business_id && payload.business_id !== ctx.businessId) {
        throw new Error(`Intento de escribir en business_id ajeno bloqueado`)
      }
      if (!payload.business_id) {
        payload.business_id = ctx.businessId
      }
    }
  }

  // onConflict: para tablas multi-tenant cuya PK es composite (business_id, X)
  // el caller debe declarar las dos columnas. Hoy: csl_equipos. Si no,
  // un upsert con solo equipo_id puede sobreescribir una fila de OTRO
  // tenant (PK collision). Las demás tablas siguen con onConflict simple.
  const onConflictByEntity: Record<string, string> = {
    equipos: "business_id,equipo_id",
  }
  const onConflict = onConflictByEntity[entity] || config.key

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const { data, error } = await supabase
      .from(config.table)
      .upsert(payload, { onConflict })
      .select(config.key)

    if (!error) {
      // Guardia anti-falso-éxito: un upsert que no devuelve fila no escribió nada
      // (ej. RLS lo bloqueó silenciosamente). No lo reportamos como guardado.
      if (!data || data.length === 0) throw noRowsError(entity)
      if (maintScope) {
        await recordMaintenanceAudit({
          entity,
          table: config.table,
          recordKey: String(payload[config.key] ?? ""),
          op: "upsert",
          changeSource: maintScope.source,
          userId: maintScope.userId,
          userEmail: maintScope.userEmail,
        })
      }
      return
    }
    const missingColumn = /'([^']+)' column/.exec(error.message || "")?.[1]
    // Tolerar columnas opcionales: las de auditoría (cualquier entidad) o
    // cualquier columna en ficha_dermatologica (esquema histórico flexible).
    const tolerable = !!missingColumn && missingColumn in payload &&
      (AUDIT_OPTIONAL_COLS.has(missingColumn) || entity === "ficha_dermatologica")
    if (!tolerable) throw error
    delete payload[missingColumn as string]
  }
  throw new Error(`No se pudo guardar ${entity}: demasiadas columnas pendientes de migración`)
}

export async function deleteRow(entity: string, keyValue: string, opts?: { targetBusinessId?: string }) {
  const supabase = getSupabaseAdmin()
  const config = tableConfig(entity)
  if (!keyValue) throw new Error(`Falta clave para eliminar ${entity}`)

  // GUARDIA MANTENIMIENTO: bloquea borrados automáticos sobre tablas protegidas.
  const maintScope = await assertMaintenanceWriteAllowed(config.table, "delete", {
    entity,
    recordKey: keyValue,
  })

  // Tenant verification: un targetBusinessId explícito SIEMPRE scopea (evita
  // que un superadmin en "Todos" borre la fila homónima de OTRO tenant cuando
  // la clave colisiona). Si no, se usa el del contexto cuando no hay bypass.
  const ctx = getBusinessContext()
  const exempt = TENANT_EXEMPT_TABLES.has(config.table)
  const targetBusinessId =
    opts?.targetBusinessId ?? (ctx && !ctx.bypassTenantFilter ? ctx.businessId : undefined)
  const applyTenant = !exempt && !!targetBusinessId

  let query = supabase.from(config.table).delete().eq(config.key, keyValue)
  if (applyTenant) {
    query = query.eq("business_id", targetBusinessId!)
  }
  const { data, error } = await query.select(config.key)
  if (error) throw error
  // En tablas protegidas de mantenimiento, un delete que no tocó ninguna fila
  // significa clave/tenant equivocado: error claro en vez de falso éxito.
  if (maintScope && (!data || data.length === 0)) throw noRowsError(entity)

  if (maintScope) {
    await recordMaintenanceAudit({
      entity,
      table: config.table,
      recordKey: keyValue,
      op: "delete",
      changeSource: maintScope.source,
      userId: maintScope.userId,
      userEmail: maintScope.userEmail,
    })
  }
}

export async function updateRowFields(
  entity: string,
  keyValue: string,
  fields: Row,
  opts?: { targetBusinessId?: string },
) {
  const supabase = getSupabaseAdmin()
  const config = tableConfig(entity)

  // GUARDIA MANTENIMIENTO: bloquea updates automáticos sobre tablas protegidas.
  const maintScope = await assertMaintenanceWriteAllowed(config.table, "update", {
    entity,
    recordKey: keyValue,
  })

  const ctx = getBusinessContext()
  const exempt = TENANT_EXEMPT_TABLES.has(config.table)
  // business_id objetivo:
  //   - explícito (caller) → SIEMPRE se aplica, incluso si el superadmin está
  //     en modo "Todos" (bypass). Es la única forma de escribir UNA sola fila
  //     cuando un equipo_id colisiona entre tenants (ej. "1" existe en CSL y
  //     Depicenter). Sin esto el UPDATE tocaría ambos tenants.
  //   - si no, el del contexto cuando NO hay bypass (path normal scopeado).
  const targetBusinessId =
    opts?.targetBusinessId ?? (ctx && !ctx.bypassTenantFilter ? ctx.businessId : undefined)
  const applyTenant = !exempt && !!targetBusinessId

  // Sanitizar: no permitir cambiar business_id desde fields (sería escape de tenant).
  const safeFields: Row = { ...fields }
  if (applyTenant && safeFields.business_id) {
    delete safeFields.business_id
  }

  // Captura del estado ANTERIOR de los campos editados — solo para la auditoría
  // de mantenimiento (valor anterior → valor nuevo). Scopeado al mismo tenant
  // para no leer la fila homónima del otro negocio.
  let beforeRow: Row | null = null
  if (maintScope) {
    const auditCols = Object.keys(fields).filter((k) => k !== "business_id")
    if (auditCols.length) {
      try {
        let bq = supabase.from(config.table).select(auditCols.join(",")).eq(config.key, keyValue)
        if (applyTenant) bq = bq.eq("business_id", targetBusinessId!)
        const { data } = await bq.maybeSingle()
        beforeRow = (data as Row | null) ?? null
      } catch {
        // Captura de "valor anterior" es best-effort: nunca debe romper el UPDATE.
        beforeRow = null
      }
    }
    // Estampar el origen del cambio manual en la fila protegida.
    safeFields.change_source = maintScope.source
    safeFields.updated_by = maintScope.userId
  }

  // Reintento tolerante a columnas de auditoría aún no migradas.
  let affected = 0
  for (let attempt = 0; attempt < 4; attempt += 1) {
    let query = supabase
      .from(config.table)
      .update({ ...safeFields, updated_at: new Date().toISOString() })
      .eq(config.key, keyValue)
    if (applyTenant) {
      query = query.eq("business_id", targetBusinessId!)
    }
    // .select() devuelve las filas REALMENTE afectadas: la única forma de saber
    // si el UPDATE calzó con alguna fila (Supabase no falla en 0 filas).
    const { data, error } = await query.select(config.key)
    if (!error) { affected = (data || []).length; break }
    const missingColumn = /'([^']+)' column/.exec(error.message || "")?.[1]
    const tolerable = !!missingColumn && missingColumn in safeFields && AUDIT_OPTIONAL_COLS.has(missingColumn)
    if (!tolerable) throw error
    delete safeFields[missingColumn as string]
  }

  // Si no se tocó ninguna fila, el guardado NO ocurrió: error claro (no silencio).
  if (affected === 0) throw noRowsError(entity)

  if (maintScope) {
    const before: Record<string, unknown> = {}
    const after: Record<string, unknown> = {}
    for (const k of Object.keys(fields)) {
      if (k === "business_id") continue
      before[k] = beforeRow ? beforeRow[k] ?? null : null
      after[k] = fields[k]
    }
    await recordMaintenanceAudit({
      entity,
      table: config.table,
      recordKey: keyValue,
      op: "update",
      changeSource: maintScope.source,
      userId: maintScope.userId,
      userEmail: maintScope.userEmail,
      details: { fields: Object.keys(fields), before, after },
    })
  }
}

// ── Columnas LIGERAS para listados (excluyen campos pesados base64/json) ───
//
// Filosofía: el listado en pantalla solo necesita identificadores + metadatos
// para mostrar la tabla y permitir abrir un registro. Los campos pesados
// (firmas, fotos, PDFs base64, JSONs de checklist) se cargan bajo demanda
// vía actions específicas (ej. getReporte).
//
// Cada fila de reportes con TODO pesa ~64 KB. Sin firmas/fotos/piezas
// pesa ~600 B. Para un listado de 132 reportes: 8 MB → 80 KB (99% menos egress).

const REPORTES_LIST_COLS = [
  "report_id", "fecha", "equipo_id", "sucursal", "empresa", "cliente",
  "domicilio", "ciudad", "modelo", "serie", "numero",
  "tipo", "estado_equipo", "prioridad", "atendio",
  "p_cabeza", "p_totales",
  "business_id", "created_at", "updated_at",
].join(",")

// Columnas LIVIANAS para listados — verificadas contra OpenAPI 2026-05-30.
// Excluyen los campos pesados (firma_digital base64, payload_json con foto
// cédula base64, JSONs grandes). El detalle se carga via actions específicas.

// csl_solicitudes_empleo: SIN firma_digital, documentos_adjuntos,
// experiencia (JSON), observaciones largas, payload_json (tiene foto cédula).
// 65 KB/fila → ~600 B/fila (99% menos egress en listado).
export const SOLICITUDES_LIST_COLS = [
  "solicitud_id", "business_id", "fecha_solicitud", "estado",
  "puesto_solicitado", "nombre", "apellido", "cedula",
  "email", "telefono", "fecha_nacimiento", "sexo", "ciudad",
  "nivel_educacion", "especialidad", "salario", "revisado_por",
  "created_at", "updated_at",
].join(",")

// csl_ficha_dermatologica: SIN firma_digital + payload_json (que tiene
// el cuerpo clínico completo + foto cédula). 52 KB/fila → ~500 B/fila.
export const FICHA_LIST_COLS = [
  "ficha_id", "business_id", "cliente_id", "nombre", "cedula", "telefono",
  "email", "ciudad", "sucursal", "fecha", "edad", "ocupacion", "operadora",
  "motivo_consulta", "estado", "created_at", "updated_at",
].join(",")

// csl_consent_masajes / tatuajes_cejas: SIN firma_cliente + firma_especialista
// (data URLs base64) + payload_json + JSONs grandes. ~48 KB/fila → ~400 B.
export const CONSENT_LIST_COLS = [
  "consent_id", "business_id", "cliente_id", "cliente_nombre", "nombre_cliente",
  "documento", "telefono", "correo", "fecha", "fecha_registro",
  "sucursal", "especialista", "especialista_nombre", "estado",
  "created_at", "updated_at",
].join(",")

// csl_sesiones_cliente — solo últimas 6 semanas (~42 días) por defecto.
// El histórico anterior se consulta bajo demanda desde el wizard del cuadre.
const SESIONES_RECENT_DAYS = 42

/** Snapshot del sistema base + consentimientos.
 *
 *  OPTIMIZADO 2026-05-29 para reducir egress (10 GB/mes → ~1 GB/mes esperado):
 *   - reportes, solicitudes_empleo, ficha_dermatologica, consents → SELECT
 *     específico sin campos pesados base64/json. Detalle se carga bajo
 *     demanda con la action `getReporte`, `getSolicitud`, etc.
 */
export async function getAllData() {
  const [sucursales, equipos, reportes, piezas, tecnicos, inventario, consentMasajes, consentPeeling, consentTatuajesCejas, consentDepilacionLaser] = await Promise.all([
    getRows("sucursales"),
    getRows("equipos"),
    getRows("reportes", { columns: REPORTES_LIST_COLS }),
    getRows("piezas"),
    getRows("tecnicos"),
    getRows("inventario"),
    getRows("csl_consent_masajes", { columns: CONSENT_LIST_COLS }).catch(() => []),
    getRows("csl_consent_peeling", { columns: CONSENT_LIST_COLS }).catch(() => []),
    getRows("csl_consent_tatuajes_cejas", { columns: CONSENT_LIST_COLS }).catch(() => []),
    getRows("csl_consent_depilacion_laser", { columns: CONSENT_LIST_COLS }).catch(() => []),
  ])
  return {
    sucursales: scopeByBranch(sucursales, (s) => (s as Row).Nombre),
    equipos: scopeByBranch(equipos, (e) => (e as Row).Sucursal),
    reportes: scopeByBranch(reportes, (r) => (r as Row).Sucursal),
    piezas, tecnicos, inventario,
    consentMasajes: scopeByBranch(consentMasajes as Row[], (c) => (c as Row).sucursal),
    consentPeeling: scopeByBranch(consentPeeling as Row[], (c) => (c as Row).sucursal),
    consentTatuajesCejas: scopeByBranch(consentTatuajesCejas as Row[], (c) => (c as Row).sucursal),
    consentDepilacionLaser: scopeByBranch(consentDepilacionLaser as Row[], (c) => (c as Row).sucursal),
  }
}

/** Snapshot PulseControl.
 *
 *  OPTIMIZADO 2026-05-29:
 *   - sesiones_cliente → solo últimas 6 semanas (en vez de las 24,616 filas
 *     históricas). El cuadre semanal usa esto. Para semanas viejas se puede
 *     pedir con extendedDays.
 *
 *  2026-05-30: incluye csl_pulse_readings (nueva tabla canónica de lecturas).
 */
export async function getAllPulsosData(opts?: { extendedDays?: number }) {
  const sinceDays = opts?.extendedDays ?? SESIONES_RECENT_DAYS
  const [operadoras, lecturasSemanales, sesionesCliente, auditoriasSemanales, pulseReadingsRaw, operatorShotsRaw] = await Promise.all([
    getRows("operadoras"),
    getRows("lecturas_semanales"),
    getRows("sesiones_cliente", { sinceColumn: "fecha", sinceDays }),
    getRows("auditorias_semanales"),
    // csl_pulse_readings: filtrar por tenant (service_role bypasa RLS)
    (() => {
      const ctx = getBusinessContext()
      let q = getSupabaseAdmin()
        .from("csl_pulse_readings")
        .select("*")
        .order("period_start", { ascending: false })
      if (ctx && !ctx.bypassTenantFilter) q = q.eq("business_id", ctx.businessId)
      return q.then(({ data, error }) => {
        if (error) { console.warn("csl_pulse_readings not available:", error.message); return [] }
        return data || []
      })
    })(),
    // csl_operator_shots: resumen semanal AgendaPro. Si la tabla aún no
    // existe (migración pendiente), devuelve [] sin romper.
    (() => {
      const ctx = getBusinessContext()
      let q = getSupabaseAdmin()
        .from("csl_operator_shots")
        .select("*")
        .order("period_start", { ascending: false })
      if (ctx && !ctx.bypassTenantFilter) q = q.eq("business_id", ctx.businessId)
      return q.then(({ data, error }) => {
        if (error) {
          const code = (error as { code?: string }).code
          if (code !== "42P01") console.warn("csl_operator_shots not available:", error.message)
          return []
        }
        return data || []
      })
    })(),
  ])
  // GUARDIA anti-fuga por tenant: además del filtro por business_id, descarta
  // filas cuya sucursal NO pertenece al tenant activo (datos mal etiquetados /
  // cross-tenant). No aplica cuando el superadmin está en modo "Todos".
  const ctxT = getBusinessContext()
  const scopeTenantSuc = <T,>(rows: T[], getSuc: (r: T) => unknown): T[] => {
    if (!ctxT || ctxT.bypassTenantFilter) return rows
    return rows.filter((r) => {
      const ok = sucursalAllowedForTenant(getSuc(r), ctxT.businessSlug)
      if (!ok) console.warn(`cross-tenant row blocked [${ctxT.businessSlug}]:`, getSuc(r))
      return ok
    })
  }
  return {
    operadoras: scopeByBranch(operadoras, (o) => (o as Row).Sucursal),
    lecturasSemanales: scopeTenantSuc(scopeByBranch(lecturasSemanales, (x) => (x as Row).Sucursal), (x) => (x as Row).Sucursal),
    sesionesCliente: scopeTenantSuc(scopeByBranch(sesionesCliente, (x) => (x as Row).Sucursal), (x) => (x as Row).Sucursal),
    auditoriasSemanales: scopeTenantSuc(scopeByBranch(auditoriasSemanales, (x) => (x as Row).Sucursal), (x) => (x as Row).Sucursal),
    pulseReadings: scopeTenantSuc(scopeByBranch(pulseReadingsRaw as Row[], (x) => (x as Row).sucursal), (x) => (x as Row).sucursal),
    operatorShots: scopeTenantSuc(scopeByBranch(operatorShotsRaw as Row[], (x) => (x as Row).sucursal_normalizada), (x) => (x as Row).sucursal_normalizada),
  }
}

/** Carga un reporte COMPLETO por ID — incluye firmas, fotos, piezas_json,
 *  checklist, partes_texto. Usado por el detalle del reporte al abrirlo
 *  desde el listado. Esos campos NO vienen en getAllData.reportes. */
export async function getReporteCompleto(reportId: string): Promise<Row | null> {
  if (!reportId) return null
  const supabase = getSupabaseAdmin()
  const config = tableConfig("reportes")
  const ctx = getBusinessContext()
  const applyTenant = ctx && !ctx.bypassTenantFilter && !TENANT_EXEMPT_TABLES.has(config.table)
  let query = supabase.from(config.table).select("*").eq(config.key, reportId)
  if (applyTenant) query = query.eq("business_id", ctx!.businessId)
  const { data, error } = await query.maybeSingle()
  if (error) throw error
  return data ? (fromDb("reportes", data as Row)) : null
}

/** Carga registro COMPLETO por ID para tablas cuyo listado se devuelve
 *  con SELECT slim (sin firma_digital + payload_json + JSONs grandes).
 *  Genérico — mismo patrón que getReporteCompleto. */
/**
 * Devuelve los business_id DISTINTOS que poseen una fila con la clave `idValue`
 * (sin filtro de tenant — usa el admin client). Sirve para deducir a qué negocio
 * pertenece un registro cuando un superadmin en modo "Todos" edita sin declarar
 * el tenant. Si hay más de uno, la clave colisiona entre negocios y se necesita
 * desambiguación explícita.
 */
export async function getRowBusinessIds(entity: string, idValue: string): Promise<string[]> {
  if (!idValue) return []
  const supabase = getSupabaseAdmin()
  const config = tableConfig(entity)
  const { data, error } = await supabase.from(config.table).select("business_id").eq(config.key, idValue)
  if (error) throw error
  const ids = new Set<string>()
  for (const r of (data || []) as Row[]) {
    if (r.business_id) ids.add(String(r.business_id))
  }
  return [...ids]
}

export async function getRecordCompleto(
  entity: string,
  idValue: string,
  opts?: { targetBusinessId?: string },
): Promise<Row | null> {
  if (!idValue) return null
  const supabase = getSupabaseAdmin()
  const config = tableConfig(entity)
  const ctx = getBusinessContext()
  const exempt = TENANT_EXEMPT_TABLES.has(config.table)
  // Mismo criterio que updateRowFields: un targetBusinessId explícito SIEMPRE
  // scopea. Crítico cuando la clave colisiona entre tenants — sin esto
  // `.maybeSingle()` revienta con "multiple rows" para un superadmin en "Todos".
  const targetBusinessId =
    opts?.targetBusinessId ?? (ctx && !ctx.bypassTenantFilter ? ctx.businessId : undefined)
  const applyTenant = !exempt && !!targetBusinessId
  let query = supabase.from(config.table).select("*").eq(config.key, idValue)
  if (applyTenant) query = query.eq("business_id", targetBusinessId!)
  const { data, error } = await query.maybeSingle()
  if (error) throw error
  return data ? (fromDb(entity, data as Row)) : null
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
      .select("business_id, is_superadmin, is_admin, permissions, businesses(slug)")
      .eq("user_id", userId)
      .maybeSingle()
    if (error || !data) return null
    const row = data as Row
    const businessId = row.business_id ? String(row.business_id) : null
    if (!businessId) return null
    const businesses = row.businesses as { slug?: string } | undefined
    const isSuperadmin = Boolean(row.is_superadmin)
    const isAdmin = Boolean(row.is_admin)
    // Scope por sucursal: admin/superadmin ven todas. Un usuario normal con
    // filas activas en user_branch_permissions queda restringido a esas.
    let branchScope: { all: boolean; branches: string[] } = { all: true, branches: [] }
    if (!isSuperadmin && !isAdmin) {
      try {
        const { data: bp } = await supabase
          .from("user_branch_permissions")
          .select("branch_name")
          .eq("user_id", userId).eq("business_id", businessId).eq("active", true)
        const branches = Array.from(new Set(((bp || []) as Row[]).map((r) => normalizeSucursal(r.branch_name)).filter(Boolean)))
        if (branches.length) branchScope = { all: false, branches }
      } catch { /* tabla aún no migrada → all */ }
    }
    // Permisos granulares (202607020001). Solo strings válidos.
    const permissions = Array.isArray(row.permissions)
      ? (row.permissions as unknown[]).filter((p): p is string => typeof p === "string" && p.length > 0)
      : []
    return {
      businessId,
      businessSlug: String(businesses?.slug ?? "csl"),
      isSuperadmin,
      isAdmin,
      // Por defecto el superadmin bypasea el filtro (ve todo). handleAction
      // lo apaga en cuanto la UI manda un business activo.
      bypassTenantFilter: isSuperadmin,
      branchScope,
      permissions,
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
