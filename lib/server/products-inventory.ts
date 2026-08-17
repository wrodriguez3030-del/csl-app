/**
 * Módulo Inventario de Productos — lógica de servidor.
 *
 * Multi-tenant: toda lectura y escritura se scopea por el business_id del
 * BusinessContext del request (service_role hace bypass de RLS, así que el
 * aislamiento real lo dan estos filtros explícitos). Una fila cuya sucursal
 * no pertenezca al tenant activo se DESCARTA — nunca se estampa con el
 * negocio activo, que es la causa histórica de contaminación cross-tenant.
 *
 * Server-only. NUNCA importar desde código cliente.
 */
import { z } from "zod"
import { getSupabaseAdmin } from "./supabase"
import { getBusinessContext, getBranchScope } from "./business-context"
import { sucursalesForTenant, sucursalAllowedForTenant, normalizeSucursal } from "@/lib/normalize-pulse"
import { textValue, numberValue, dateValue } from "./csl-helpers"
import type { ActionParams, ActionUser, Row } from "./csl-types"
import type { ConteoEstado } from "@/lib/productos-client"

// ── Tenant helpers ───────────────────────────────────────────────────────────
function requireBizId(): string {
  const id = getBusinessContext()?.businessId
  if (!id) throw new Error("Selecciona un negocio activo para esta operación")
  return id
}
function tenantSlug(): string {
  return getBusinessContext()?.businessSlug || "csl"
}
function isManager(): boolean {
  const ctx = getBusinessContext()
  return Boolean(ctx?.isAdmin || ctx?.isSuperadmin)
}
/** Permiso granular para aprobar/rechazar un conteo físico. */
const PERM_APROBAR_CONTEO = "productos.aprobar_conteo"
function canApproveCount(): boolean {
  const ctx = getBusinessContext()
  return isManager() || Boolean(ctx?.permissions?.includes(PERM_APROBAR_CONTEO))
}

/** Sucursales que el usuario puede ver/tocar en este negocio. */
function allowedBranches(): string[] {
  const all = sucursalesForTenant(tenantSlug())
  const scope = getBranchScope()
  return scope.all || !scope.branches.length ? all : all.filter((b) => scope.branches.includes(b))
}

function requireBranchInScope(raw: unknown): string {
  const suc = normalizeSucursal(raw)
  if (!suc) throw new Error("Selecciona una sucursal")
  if (!allowedBranches().includes(suc)) throw new Error("No tienes acceso a esa sucursal")
  return suc
}

/**
 * Lee TODAS las filas de una consulta paginando de 1000 en 1000.
 * Sin esto PostgREST corta en 1000 filas EN SILENCIO y el reporte saldría
 * incompleto sin avisar. Mismo patrón que `fetchAllPages` de csl-crud.
 */
async function fetchAll<T = Row>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const PAGE = 1000
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1)
    if (error) throw error
    const rows = data || []
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
}

// ── Validación del archivo importado ─────────────────────────────────────────
const stockSchema = z.record(z.string().min(1), z.number().finite())

const productoSchema = z.object({
  clave: z.string().min(1).max(400),
  sku: z.string().max(120).optional().default(""),
  nombre: z.string().min(1).max(300),
  nombreNorm: z.string().min(1).max(300),
  categoria: z.string().max(200).optional().default(""),
  marca: z.string().max(200).optional().default(""),
  formato: z.string().max(120).optional().default(""),
  descripcion: z.string().max(1000).optional().default(""),
  costo: z.number().finite().nullable().optional(),
  precioExterno: z.number().finite().nullable().optional(),
  precioInterno: z.number().finite().nullable().optional(),
  comision: z.number().finite().nullable().optional(),
  comisionTipo: z.number().finite().nullable().optional(),
  precioConIva: z.boolean().nullable().optional(),
  ivaPct: z.number().finite().nullable().optional(),
  activo: z.boolean(),
  stock: stockSchema,
})

const uuidSchema = z.string().uuid()

// ── Mapeos DB ↔ cliente ──────────────────────────────────────────────────────
function mapProducto(r: Row, stock: Record<string, number>) {
  const total = Object.values(stock).reduce((s, q) => s + (Number(q) || 0), 0)
  return {
    id: r.id as string,
    clave: r.clave as string,
    sku: (r.sku as string) || null,
    nombre: r.nombre as string,
    categoria: (r.categoria as string) || null,
    marca: (r.marca as string) || null,
    formato: (r.formato as string) || null,
    costo: r.costo == null ? null : Number(r.costo),
    precioExterno: r.precio_externo == null ? null : Number(r.precio_externo),
    precioInterno: r.precio_interno == null ? null : Number(r.precio_interno),
    activo: Boolean(r.activo),
    stock,
    total,
  }
}

function mapConteo(r: Row) {
  return {
    id: r.id as string,
    sucursal: r.sucursal as string,
    fecha: String(r.fecha || "").slice(0, 10),
    estado: (r.estado as ConteoEstado) || "borrador",
    notas: (r.notas as string) || null,
    responsable: (r.responsable as string) || null,
    creadoPorNombre: (r.creado_por_nombre as string) || null,
    aprobadoPorNombre: (r.aprobado_por_nombre as string) || null,
    aprobadoEn: (r.aprobado_en as string) || null,
    motivoRechazo: (r.motivo_rechazo as string) || null,
    createdAt: (r.created_at as string) || null,
  }
}

function mapConteoItem(r: Row) {
  return {
    id: r.id as string,
    productoId: (r.producto_id as string) || null,
    nombre: r.nombre_snapshot as string,
    sku: (r.sku_snapshot as string) || null,
    cantidadSistema: Number(r.cantidad_sistema) || 0,
    cantidadContada: Number(r.cantidad_contada) || 0,
    observacion: (r.observacion as string) || null,
  }
}

// ── Sucursales ───────────────────────────────────────────────────────────────
export function getProductBranches() {
  const scope = getBranchScope()
  return { ok: true as const, records: allowedBranches(), canPickAll: scope.all }
}

// ── Catálogo + existencias ───────────────────────────────────────────────────
async function stockByProduct(businessId: string, sucursales: string[]) {
  const sb = getSupabaseAdmin()
  const rows = await fetchAll<Row>((from, to) =>
    sb
      .from("csl_producto_stock")
      .select("producto_id, sucursal, cantidad")
      .eq("business_id", businessId)
      .in("sucursal", sucursales)
      .range(from, to),
  )
  const map = new Map<string, Record<string, number>>()
  for (const r of rows) {
    const pid = r.producto_id as string
    const bucket = map.get(pid) || {}
    bucket[r.sucursal as string] = Number(r.cantidad) || 0
    map.set(pid, bucket)
  }
  return map
}

/**
 * Catálogo con la existencia de cada sucursal permitida.
 * Filtros opcionales: `search` (nombre o código), `categoria`, `soloActivos`.
 */
export async function getProductos(params: ActionParams) {
  const businessId = requireBizId()
  const sucursales = allowedBranches()
  const sb = getSupabaseAdmin()

  const search = textValue(params, "search").trim()
  const categoria = textValue(params, "categoria").trim()
  const soloActivos = textValue(params, "soloActivos") === "true"

  const productos = await fetchAll<Row>((from, to) => {
    let q = sb
      .from("csl_productos")
      .select("*")
      .eq("business_id", businessId)
      .order("nombre", { ascending: true })
      .range(from, to)
    if (soloActivos) q = q.eq("activo", true)
    if (categoria) q = q.eq("categoria", categoria)
    if (search) {
      // `search` va escapado: los comodines de PostgREST (% , y ) romperían el filtro.
      const safe = search.replace(/[%,()]/g, " ").trim()
      if (safe) q = q.or(`nombre.ilike.%${safe}%,sku.ilike.%${safe}%`)
    }
    return q
  })

  const stock = await stockByProduct(businessId, sucursales)
  const records = productos.map((p) => mapProducto(p, stock.get(p.id as string) || {}))

  const categorias = [...new Set(productos.map((p) => String(p.categoria || "").trim()).filter(Boolean))].sort()

  return { ok: true as const, records, sucursales, categorias, total: records.length }
}

/** Datos crudos para el reporte de existencias y para abrir un conteo. */
export async function getProductStockReport(params: ActionParams) {
  const businessId = requireBizId()
  const permitidas = allowedBranches()
  const pedidas = textValue(params, "sucursales")
    .split(",")
    .map((s) => normalizeSucursal(s))
    .filter((s) => s && permitidas.includes(s))
  const sucursales = pedidas.length ? pedidas : permitidas
  const soloActivos = textValue(params, "soloActivos") === "true"

  const sb = getSupabaseAdmin()
  const productos = await fetchAll<Row>((from, to) => {
    let q = sb
      .from("csl_productos")
      .select("id, nombre, sku, activo")
      .eq("business_id", businessId)
      .order("nombre", { ascending: true })
      .range(from, to)
    if (soloActivos) q = q.eq("activo", true)
    return q
  })

  const stock = await stockByProduct(businessId, sucursales)
  const records = productos.map((p) => ({
    id: p.id as string,
    nombre: p.nombre as string,
    sku: (p.sku as string) || "",
    activo: Boolean(p.activo),
    stock: stock.get(p.id as string) || {},
  }))
  return { ok: true as const, sucursales, records }
}

// ── Importación ──────────────────────────────────────────────────────────────

/**
 * Importa un lote de filas del archivo de productos.
 *
 * El cliente parsea el Excel en el navegador y manda lotes de ~200 filas con
 * el MISMO `importId`. Cada fila escrita queda estampada con ese id; al llegar
 * el último lote (`esUltimoLote`), toda existencia de las sucursales importadas
 * que no lleve ese id se pone en cero — un producto que ya no viene en el
 * archivo no puede conservar existencia fantasma.
 *
 * El stock se SOBRESCRIBE: el archivo es la fuente de verdad (decisión del
 * dueño). El conteo físico aprobado también escribe, pero la próxima
 * importación vuelve a mandar.
 */
export async function importProducts(params: ActionParams, user: ActionUser) {
  const businessId = requireBizId()
  const slug = tenantSlug()
  const sb = getSupabaseAdmin()

  const importId = uuidSchema.safeParse(textValue(params, "importId"))
  if (!importId.success) throw new Error("Identificador de importación inválido")

  let raw: unknown
  try {
    raw = JSON.parse(textValue(params, "rows") || "[]")
  } catch {
    throw new Error("El lote de productos no es válido")
  }
  const parsed = z.array(productoSchema).max(1000).safeParse(raw)
  if (!parsed.success) {
    throw new Error(`El archivo trae filas con datos inválidos: ${parsed.error.issues[0]?.message || "revisa el formato"}`)
  }
  const rows = parsed.data

  const now = new Date().toISOString()
  let creados = 0
  let actualizados = 0
  let descartados = 0
  const unidadesPorSucursal: Record<string, number> = {}

  // 1. Catálogo — upsert por (business_id, clave).
  const productRows = rows.map((r) => ({
    business_id: businessId,
    clave: r.clave,
    sku: r.sku || null,
    nombre: r.nombre,
    nombre_norm: r.nombreNorm,
    categoria: r.categoria || null,
    marca: r.marca || null,
    formato: r.formato || null,
    descripcion: r.descripcion || null,
    costo: r.costo ?? null,
    precio_externo: r.precioExterno ?? null,
    precio_interno: r.precioInterno ?? null,
    comision: r.comision ?? null,
    comision_tipo: r.comisionTipo ?? null,
    precio_con_iva: r.precioConIva ?? null,
    iva_pct: r.ivaPct ?? null,
    activo: r.activo,
    updated_at: now,
  }))

  const claves = rows.map((r) => r.clave)
  const previos = await fetchAll<Row>((from, to) =>
    sb
      .from("csl_productos")
      .select("id, clave")
      .eq("business_id", businessId)
      .in("clave", claves)
      .range(from, to),
  )
  const yaExistian = new Set(previos.map((p) => p.clave as string))

  const { data: guardados, error: upErr } = await sb
    .from("csl_productos")
    .upsert(productRows, { onConflict: "business_id,clave" })
    .select("id, clave")
  if (upErr) throw upErr

  const idPorClave = new Map((guardados || []).map((p) => [p.clave as string, p.id as string]))
  for (const clave of idPorClave.keys()) {
    if (yaExistian.has(clave)) actualizados += 1
    else creados += 1
  }

  // 2. Existencias — una fila por producto × sucursal. Sobrescribe.
  const stockRows: Row[] = []
  for (const r of rows) {
    const productoId = idPorClave.get(r.clave)
    if (!productoId) continue
    for (const [sucRaw, cantidad] of Object.entries(r.stock)) {
      const sucursal = normalizeSucursal(sucRaw)
      // Guardia anti-fuga: una sucursal que no es de este negocio NO se escribe
      // con el business activo — se descarta y se reporta.
      if (!sucursal || !sucursalAllowedForTenant(sucursal, slug)) {
        descartados += 1
        continue
      }
      stockRows.push({
        business_id: businessId,
        producto_id: productoId,
        sucursal,
        cantidad,
        origen: "importacion",
        import_id: importId.data,
        actualizado_en: now,
      })
      unidadesPorSucursal[sucursal] = (unidadesPorSucursal[sucursal] || 0) + cantidad
    }
  }

  if (stockRows.length) {
    const { error: stErr } = await sb
      .from("csl_producto_stock")
      .upsert(stockRows, { onConflict: "business_id,producto_id,sucursal" })
    if (stErr) throw stErr
  }

  // 3. Cierre de la importación.
  let importRowId: string | null = null
  if (textValue(params, "esUltimoLote") === "true") {
    const sucursalesImportadas = textValue(params, "sucursales")
      .split(",")
      .map((s) => normalizeSucursal(s))
      .filter((s) => s && sucursalAllowedForTenant(s, slug))

    if (sucursalesImportadas.length) {
      // Lo que ya no viene en el archivo queda en cero, no con el dato viejo.
      // EXCEPCIÓN: los productos inactivos no se tocan (decisión del dueño).
      // Ya no se importan, así que sin esta salvedad el barrido les pondría
      // cero — que es justamente modificarlos.
      const activos = await fetchAll<Row>((from, to) =>
        sb
          .from("csl_productos")
          .select("id")
          .eq("business_id", businessId)
          .eq("activo", true)
          .range(from, to),
      )
      const idsActivos = activos.map((p) => p.id as string)
      if (idsActivos.length) {
        const LOTE_IDS = 300
        for (let i = 0; i < idsActivos.length; i += LOTE_IDS) {
          const { error: zeroErr } = await sb
            .from("csl_producto_stock")
            .update({ cantidad: 0, actualizado_en: now })
            .eq("business_id", businessId)
            .in("sucursal", sucursalesImportadas)
            .in("producto_id", idsActivos.slice(i, i + LOTE_IDS))
            .gt("cantidad", 0)
            .or(`import_id.is.null,import_id.neq.${importId.data}`)
          if (zeroErr) throw zeroErr
        }
      }
    }

    const resumen = {
      business_id: businessId,
      archivo: textValue(params, "archivo") || null,
      filas_leidas: numberValue(params, "filasLeidas") || rows.length,
      productos_creados: numberValue(params, "totalCreados") || creados,
      productos_actualizados: numberValue(params, "totalActualizados") || actualizados,
      descartados: numberValue(params, "totalDescartados") || descartados,
      sucursales: sucursalesImportadas.map((s) => ({ sucursal: s })),
      unidades_total: numberValue(params, "unidadesTotal") || 0,
      usuario_id: user.id || null,
      usuario_nombre: textValue(params, "userName") || null,
    }
    const { data: imp } = await sb.from("csl_producto_importaciones").insert(resumen).select("id").single()
    importRowId = (imp?.id as string) || null
  }

  return { ok: true as const, creados, actualizados, descartados, unidadesPorSucursal, importId: importRowId }
}

/** Bitácora de importaciones (las 30 últimas). */
export async function getProductImports() {
  const businessId = requireBizId()
  const { data, error } = await getSupabaseAdmin()
    .from("csl_producto_importaciones")
    .select("*")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(30)
  if (error) throw error
  const records = (data || []).map((r) => ({
    id: r.id as string,
    archivo: (r.archivo as string) || null,
    filasLeidas: Number(r.filas_leidas) || 0,
    productosCreados: Number(r.productos_creados) || 0,
    productosActualizados: Number(r.productos_actualizados) || 0,
    descartados: Number(r.descartados) || 0,
    unidadesTotal: Number(r.unidades_total) || 0,
    sucursales: (r.sucursales as { sucursal: string }[]) || [],
    usuarioNombre: (r.usuario_nombre as string) || null,
    createdAt: (r.created_at as string) || null,
  }))
  return { ok: true as const, records }
}

// ── Conteo físico ────────────────────────────────────────────────────────────

const itemSchema = z.object({
  productoId: z.string().uuid().nullable().optional(),
  nombre: z.string().min(1).max(300),
  sku: z.string().max(120).nullable().optional(),
  cantidadSistema: z.number().finite(),
  cantidadContada: z.number().finite(),
  observacion: z.string().max(500).nullable().optional(),
})

async function fetchConteo(id: string, businessId: string): Promise<Row> {
  const { data, error } = await getSupabaseAdmin()
    .from("csl_conteos_productos")
    .select("*")
    .eq("id", id)
    .eq("business_id", businessId)
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error("Conteo no encontrado en este negocio")
  return data as Row
}

async function itemsDeConteo(conteoId: string, businessId: string) {
  const sb = getSupabaseAdmin()
  const rows = await fetchAll<Row>((from, to) =>
    sb
      .from("csl_conteos_productos_items")
      .select("*")
      .eq("conteo_id", conteoId)
      .eq("business_id", businessId)
      .order("nombre_snapshot", { ascending: true })
      .range(from, to),
  )
  return rows.map(mapConteoItem)
}

/** Borrador vivo de (sucursal, fecha) con sus renglones, para reanudar el conteo. */
export async function getProductCountDraft(params: ActionParams) {
  const businessId = requireBizId()
  const sucursal = requireBranchInScope(textValue(params, "sucursal"))
  const fecha = dateValue(params.fecha)
  if (!fecha) throw new Error("Selecciona la fecha del conteo")

  const { data, error } = await getSupabaseAdmin()
    .from("csl_conteos_productos")
    .select("*")
    .eq("business_id", businessId)
    .eq("sucursal", sucursal)
    .eq("fecha", fecha)
    .eq("estado", "borrador")
    .maybeSingle()
  if (error) throw error
  if (!data) return { ok: true as const, record: null }
  return {
    ok: true as const,
    record: { ...mapConteo(data as Row), items: await itemsDeConteo((data as Row).id as string, businessId) },
  }
}

/**
 * Guarda un conteo (borrador o enviado). Reemplaza los renglones.
 * Reanuda el borrador de (sucursal, fecha) si existe — no duplica.
 * Un conteo aprobado es inmutable por esta vía.
 */
export async function saveProductCount(params: ActionParams, user: ActionUser) {
  const businessId = requireBizId()
  const sucursal = requireBranchInScope(textValue(params, "sucursal"))
  const fecha = dateValue(params.fecha)
  if (!fecha) throw new Error("Selecciona la fecha del conteo")
  const estado: ConteoEstado = textValue(params, "estado") === "enviado" ? "enviado" : "borrador"

  let raw: unknown
  try {
    raw = JSON.parse(textValue(params, "items") || "[]")
  } catch {
    throw new Error("La lista de productos contados no es válida")
  }
  const parsed = z.array(itemSchema).max(5000).safeParse(raw)
  if (!parsed.success) throw new Error("Hay cantidades inválidas en el conteo")
  const items = parsed.data
  if (estado === "enviado" && !items.length) {
    throw new Error("Registra al menos un producto contado para enviar el conteo")
  }

  const sb = getSupabaseAdmin()
  let id = textValue(params, "id")

  if (id) {
    const existing = await fetchConteo(id, businessId)
    if (existing.estado === "aprobado") {
      throw new Error("Este conteo ya está aprobado y no se puede editar")
    }
  } else {
    const { data: draft } = await sb
      .from("csl_conteos_productos")
      .select("id")
      .eq("business_id", businessId)
      .eq("sucursal", sucursal)
      .eq("fecha", fecha)
      .eq("estado", "borrador")
      .maybeSingle()
    if (draft) id = (draft as Row).id as string
  }

  const now = new Date().toISOString()
  const cabecera: Row = {
    business_id: businessId,
    sucursal,
    fecha,
    estado,
    notas: textValue(params, "notas") || null,
    responsable: textValue(params, "responsable") || null,
    updated_at: now,
  }
  if (id) cabecera.id = id
  else {
    cabecera.creado_por = user.id || null
    cabecera.creado_por_nombre = textValue(params, "userName") || null
  }

  let saved: Row
  try {
    const { data, error } = await sb
      .from("csl_conteos_productos")
      .upsert(cabecera, { onConflict: "id" })
      .select()
      .single()
    if (error) throw error
    saved = data as Row
  } catch (e) {
    if ((e as { code?: string }).code === "23505") {
      throw new Error("Ya hay un conteo en borrador para esa sucursal y fecha. Recárgalo para continuar.")
    }
    throw e
  }

  const conteoId = saved.id as string
  await sb.from("csl_conteos_productos_items").delete().eq("conteo_id", conteoId).eq("business_id", businessId)
  if (items.length) {
    const itemRows = items.map((it) => ({
      business_id: businessId,
      conteo_id: conteoId,
      producto_id: it.productoId || null,
      nombre_snapshot: it.nombre,
      sku_snapshot: it.sku || null,
      cantidad_sistema: it.cantidadSistema,
      cantidad_contada: it.cantidadContada,
      observacion: it.observacion || null,
    }))
    const { error: itErr } = await sb.from("csl_conteos_productos_items").insert(itemRows)
    if (itErr) throw itErr
  }

  return { ok: true as const, record: { ...mapConteo(saved), itemsCount: items.length } }
}

/**
 * Aprueba un conteo: el stock del sistema pasa a ser lo contado.
 * Exige permiso — no basta con poder contar.
 */
export async function approveProductCount(params: ActionParams, user: ActionUser) {
  const businessId = requireBizId()
  if (!canApproveCount()) throw new Error("No tienes permiso para aprobar conteos")

  const id = textValue(params, "id")
  if (!id) throw new Error("Falta el conteo")
  const conteo = await fetchConteo(id, businessId)
  if (conteo.estado === "aprobado") throw new Error("Este conteo ya está aprobado")

  const sucursal = String(conteo.sucursal)
  const items = await itemsDeConteo(id, businessId)
  const sb = getSupabaseAdmin()
  const now = new Date().toISOString()

  const stockRows = items
    .filter((it) => it.productoId)
    .map((it) => ({
      business_id: businessId,
      producto_id: it.productoId as string,
      sucursal,
      cantidad: it.cantidadContada,
      origen: "conteo",
      actualizado_en: now,
    }))

  if (stockRows.length) {
    const { error } = await sb
      .from("csl_producto_stock")
      .upsert(stockRows, { onConflict: "business_id,producto_id,sucursal" })
    if (error) throw error
  }

  const { data, error: updErr } = await sb
    .from("csl_conteos_productos")
    .update({
      estado: "aprobado",
      aprobado_por: user.id || null,
      aprobado_por_nombre: textValue(params, "userName") || null,
      aprobado_en: now,
      motivo_rechazo: null,
      updated_at: now,
    })
    .eq("id", id)
    .eq("business_id", businessId)
    .select()
    .single()
  if (updErr) throw updErr

  return { ok: true as const, record: mapConteo(data as Row), ajustados: stockRows.length }
}

/** Devuelve el conteo a borrador con el motivo. */
export async function rejectProductCount(params: ActionParams, user: ActionUser) {
  const businessId = requireBizId()
  if (!canApproveCount()) throw new Error("No tienes permiso para rechazar conteos")
  const id = textValue(params, "id")
  if (!id) throw new Error("Falta el conteo")
  const conteo = await fetchConteo(id, businessId)
  if (conteo.estado === "aprobado") throw new Error("Un conteo aprobado no se puede rechazar")

  const { data, error } = await getSupabaseAdmin()
    .from("csl_conteos_productos")
    .update({
      estado: "borrador",
      motivo_rechazo: textValue(params, "motivo") || "Sin motivo indicado",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("business_id", businessId)
    .select()
    .single()
  if (error) throw error
  void user
  return { ok: true as const, record: mapConteo(data as Row) }
}

/** Histórico de conteos con su resumen de diferencias. */
export async function getProductCounts(params: ActionParams) {
  const businessId = requireBizId()
  const permitidas = allowedBranches()
  const sb = getSupabaseAdmin()

  const cabeceras = await fetchAll<Row>((from, to) => {
    let q = sb
      .from("csl_conteos_productos")
      .select("*")
      .eq("business_id", businessId)
      .in("sucursal", permitidas)
      .order("fecha", { ascending: false })
      .order("created_at", { ascending: false })
      .range(from, to)
    const estado = textValue(params, "estado")
    if (estado) q = q.eq("estado", estado)
    return q
  })

  if (!cabeceras.length) return { ok: true as const, records: [] }

  const ids = cabeceras.map((c) => c.id as string)
  const items = await fetchAll<Row>((from, to) =>
    sb
      .from("csl_conteos_productos_items")
      .select("conteo_id, cantidad_sistema, cantidad_contada")
      .eq("business_id", businessId)
      .in("conteo_id", ids)
      .range(from, to),
  )

  const resumen = new Map<string, { count: number; diff: number }>()
  for (const it of items) {
    const key = it.conteo_id as string
    const acc = resumen.get(key) || { count: 0, diff: 0 }
    acc.count += 1
    acc.diff += (Number(it.cantidad_contada) || 0) - (Number(it.cantidad_sistema) || 0)
    resumen.set(key, acc)
  }

  const records = cabeceras.map((c) => {
    const acc = resumen.get(c.id as string) || { count: 0, diff: 0 }
    return { ...mapConteo(c), itemsCount: acc.count, diferenciaTotal: acc.diff }
  })
  return { ok: true as const, records }
}

/** Detalle de un conteo con sus renglones. */
export async function getProductCount(params: ActionParams) {
  const businessId = requireBizId()
  const id = textValue(params, "id")
  if (!id) throw new Error("Falta el conteo")
  const conteo = await fetchConteo(id, businessId)
  return {
    ok: true as const,
    record: { ...mapConteo(conteo), items: await itemsDeConteo(id, businessId) },
  }
}

/** Borra un conteo que no esté aprobado (solo admin/superadmin). */
export async function deleteProductCount(params: ActionParams) {
  const businessId = requireBizId()
  if (!isManager()) throw new Error("Solo un administrador puede eliminar conteos")
  const id = textValue(params, "id")
  if (!id) throw new Error("Falta el conteo")
  const conteo = await fetchConteo(id, businessId)
  if (conteo.estado === "aprobado") throw new Error("Un conteo aprobado no se elimina")
  const { error } = await getSupabaseAdmin()
    .from("csl_conteos_productos")
    .delete()
    .eq("id", id)
    .eq("business_id", businessId)
  if (error) throw error
  return { ok: true as const }
}
