/**
 * CERTIFICADOS DE REGALO — módulo propio.
 *
 * Primer módulo separado de `_handlers.ts`, que había llegado a 5.805 líneas y
 * 361 `case` contra la regla del proyecto de 800 máximo, y donde vivieron todos
 * los fallos que destapó la auditoría del 03/09/2026. Se eligió este para
 * empezar porque es el que tiene pruebas propias (`pnpm test:gift`, 23) que
 * demuestran que el traslado no cambió nada.
 *
 * Backend fuente de verdad: permiso por acción, aislamiento por business_id,
 * máquina de estados revalidada en servidor (nunca confía en el cliente),
 * código único generado en la base y auditoría de cada operación.
 */
import { getSupabaseAdmin } from "@/lib/server/supabase"
import { requirePermission } from "@/lib/server/business-context"
import { parsePayload, textValue, dateValue } from "@/lib/server/csl-helpers"
import { getRows, upsertRow, deleteRow } from "@/lib/server/csl-crud"
import { fromDb } from "@/lib/server/csl-transforms"
import { validateGiftCert } from "@/lib/certificados/cert-layout"
import { transitionError, type GiftCertAction } from "@/lib/certificados/cert-state"
import type { ActionParams, ActionUser, Row } from "@/lib/server/csl-types"
import { effectiveBusinessId } from "../_context"

const GIFT_TABLE = "csl_certificados_regalo"
const GIFT_AUDIT_TABLE = "csl_certificados_regalo_audit"

function giftToday(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Fila BD (snake) → objeto UI (camel). `valido_por`=Válido para; `fecha`=emisión. */
function mapGiftRow(row: Row): Record<string, unknown> {
  return {
    codigo: row.codigo,
    tipo: row.tipo,
    estado: row.estado,
    templateId: row.template_id || "moderno",
    otorgadoA: row.otorgado_a || "",
    cortesiaDe: row.cortesia_de || "",
    validoPara: row.valido_por || "",
    validoHasta: row.fecha_vencimiento || "",
    fechaEmision: row.fecha || "",
    sucursal: row.sucursal || "",
    sucursalDireccion: row.sucursal_direccion || "",
    sucursalTelefono: row.sucursal_telefono || "",
    telefono: row.telefono || "",
    correo: row.correo || "",
    notaInterna: row.nota_interna || "",
    creadoPor: row.creado_por || "",
    firma: row.firma || "",
    emitidoEn: row.emitido_en || "",
    entregadoPor: row.entregado_por || "",
    entregadoEn: row.entregado_en || "",
    canjeadoPor: row.canjeado_por || "",
    canjeadoEn: row.canjeado_en || "",
    canjeadoSucursal: row.canjeado_sucursal || "",
    motivoAnulacion: row.motivo_anulacion || "",
    anuladoPor: row.anulado_por || "",
    anuladoEn: row.anulado_en || "",
    notasEstado: row.notas_estado || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
  }
}

async function recordGiftAudit(entry: {
  business_id: string | null
  codigo: string
  accion: string
  usuario?: string
  valor_anterior?: unknown
  valor_nuevo?: unknown
  motivo?: string
}): Promise<void> {
  try {
    await getSupabaseAdmin().from(GIFT_AUDIT_TABLE).insert({
      business_id: entry.business_id,
      codigo: entry.codigo,
      accion: entry.accion,
      usuario: entry.usuario ?? null,
      valor_anterior: (entry.valor_anterior ?? null) as never,
      valor_nuevo: (entry.valor_nuevo ?? null) as never,
      motivo: entry.motivo ?? null,
    })
  } catch { /* auditoría best-effort */ }
}

/** Carga una fila del tenant activo (o legacy sin business). Aísla cross-tenant. */
async function loadGiftRow(codigo: string): Promise<Row | null> {
  const sb = getSupabaseAdmin()
  const biz = effectiveBusinessId()
  const { data, error } = await sb.from(GIFT_TABLE).select("*").eq("codigo", codigo).maybeSingle()
  if (error) throw error
  if (!data) return null
  const rowBiz = (data as Row).business_id
  if (biz && rowBiz && rowBiz !== biz) return null // jamás otro tenant
  return data as Row
}

/** Genera el próximo código único server-side (con fallback si el RPC fallara). */
async function nextGiftCode(): Promise<string> {
  try {
    const { data, error } = await getSupabaseAdmin().rpc("csl_next_gift_cert_code")
    if (!error && typeof data === "string" && data) return data
  } catch { /* fallback abajo */ }
  const y = new Date().getFullYear()
  const rand = Math.floor(Math.random() * 1_000_000).toString().padStart(6, "0")
  return `CSL-REG-${y}-${rand}`
}

/** Snapshot (dirección + teléfono) de una sucursal por nombre dentro del tenant. */
async function giftBranchSnapshot(nombre: string): Promise<{ direccion: string; telefono: string }> {
  const sb = getSupabaseAdmin()
  const biz = effectiveBusinessId()
  let q = sb.from("csl_sucursales").select("nombre,direccion,telefono,business_id").ilike("nombre", nombre)
  if (biz) q = q.eq("business_id", biz)
  const { data } = await q.limit(1)
  const row = Array.isArray(data) && data[0] ? (data[0] as Row) : null
  return { direccion: row ? String(row.direccion || "") : "", telefono: row ? String(row.telefono || "") : "" }
}

/** Las acciones que atiende este módulo. El despachador delega por este Set. */
export const GIFT_ACTIONS: ReadonlySet<string> = new Set([
  "getCertificadosRegalo", "saveCertificadoRegalo", "deleteCertificadoRegalo",
  "getCertificadosDepicenter", "saveCertificadoDepicenter", "deleteCertificadoDepicenter",
  "giftCertList", "giftCertGet", "giftCertAudit", "giftCertSave", "giftCertEmit",
  "giftCertTransition", "giftCertDuplicate", "giftCertLogExport",
])

export async function handleGiftAction(action: string, params: ActionParams, user: ActionUser) {
  switch (action) {
    case "getCertificadosRegalo":
      return { ok: true, records: await getRows("certificados_regalo") }
    case "saveCertificadoRegalo": {
      const record = parsePayload(params)
      const row = {
        codigo: String(record.codigo ?? record.Codigo ?? params.codigo ?? `CSL-GC-${Date.now()}`),
        tipo: String(record.tipo ?? record.Tipo ?? "Digital"),
        fecha: dateValue(record.fecha ?? record.Fecha),
        sucursal: String(record.sucursal ?? record.Sucursal ?? ""),
        otorgado_a: String(record.otorgadoA ?? record.OtorgadoA ?? ""),
        cortesia_de: String(record.cortesiaDe ?? record.CortesiaDe ?? ""),
        valido_por: String(record.validoPor ?? record.ValidoPor ?? ""),
        firma: String(record.firma ?? record.Firma ?? ""),
        emitido_en: String(record.emitidoEn ?? record.EmitidoEn ?? new Date().toISOString()),
        estado: String(record.estado ?? record.Estado ?? "Emitido"),
        canjeado_en: record.canjeadoEn || record.CanjeadoEn ? String(record.canjeadoEn ?? record.CanjeadoEn) : null,
        notas_estado: String(record.notasEstado ?? record.NotasEstado ?? ""),
      }
      await upsertRow("certificados_regalo", row)
      return { ok: true, record: fromDb("certificados_regalo", row) }
    }
    case "deleteCertificadoRegalo":
      await deleteRow("certificados_regalo", textValue(params, "codigo") || textValue(params, "id"))
      return { ok: true }

    // ── CF PARA IMPRIMIR · Certificados de regalo (módulo profesional) ───────
    case "giftCertList": {
      // Acceso por MENÚ (cliente-certificados-imprimir), decisión del usuario;
      // datos aislados por business_id. Solo "anular" queda con permiso.
      const sb = getSupabaseAdmin()
      const biz = effectiveBusinessId()
      let q = sb.from(GIFT_TABLE).select("*").order("emitido_en", { ascending: false }).limit(2000)
      if (biz) q = q.or(`business_id.eq.${biz},business_id.is.null`)
      const { data, error } = await q
      if (error) throw error
      return { ok: true, records: (data as Row[]).map(mapGiftRow) }
    }
    case "giftCertGet": {
      const row = await loadGiftRow(textValue(params, "codigo"))
      if (!row) return { ok: false, error: "Certificado no encontrado." }
      return { ok: true, record: mapGiftRow(row) }
    }
    case "giftCertAudit": {
      const { data, error } = await getSupabaseAdmin()
        .from(GIFT_AUDIT_TABLE).select("*").eq("codigo", textValue(params, "codigo"))
        .order("created_at", { ascending: false }).limit(500)
      if (error) throw error
      return { ok: true, records: data || [] }
    }
    case "giftCertSave": {
      const payload = parsePayload(params)
      const codigoIn = String(payload.codigo || "").trim()
      const sb = getSupabaseAdmin()
      const biz = effectiveBusinessId()
      const existing = codigoIn ? await loadGiftRow(codigoIn) : null

      const errs = validateGiftCert({
        otorgadoA: String(payload.otorgadoA || ""),
        cortesiaDe: String(payload.cortesiaDe || ""),
        validoPara: String(payload.validoPara || ""),
        validoHasta: String(payload.validoHasta || ""),
        fechaEmision: String(payload.fechaEmision || giftToday()),
        sucursal: String(payload.sucursal || ""),
      })
      if (errs.length) return { ok: false, error: errs.join(" ") }

      if (existing) {
        const blocked = transitionError("editar", String(existing.estado), String(existing.fecha_vencimiento || ""), giftToday())
        if (blocked) return { ok: false, error: blocked }
      }

      const codigo = existing ? String(existing.codigo) : await nextGiftCode()
      const snapshot = await giftBranchSnapshot(String(payload.sucursal || ""))
      const now = new Date().toISOString()
      const row: Row = {
        codigo,
        tipo: "Para imprimir",
        business_id: existing ? (existing.business_id ?? biz) : biz,
        template_id: String(payload.templateId || "moderno"),
        otorgado_a: String(payload.otorgadoA || ""),
        cortesia_de: String(payload.cortesiaDe || ""),
        valido_por: String(payload.validoPara || ""),
        fecha: dateValue(payload.fechaEmision) || giftToday(),
        fecha_vencimiento: dateValue(payload.validoHasta),
        sucursal: String(payload.sucursal || ""),
        sucursal_direccion: String(payload.sucursalDireccion || snapshot.direccion || ""),
        sucursal_telefono: String(payload.sucursalTelefono || snapshot.telefono || ""),
        telefono: String(payload.telefono || ""),
        correo: String(payload.correo || ""),
        nota_interna: String(payload.notaInterna || ""),
        estado: existing ? String(existing.estado) : "Borrador",
        creado_por: existing ? String(existing.creado_por || "") : user.email,
        updated_at: now,
      }
      const { error } = await sb.from(GIFT_TABLE).upsert(row as never, { onConflict: "codigo" })
      if (error) throw error
      await recordGiftAudit({
        business_id: biz, codigo, usuario: user.email,
        accion: existing ? "editar" : "crear",
        valor_anterior: existing ? mapGiftRow(existing) : null,
        valor_nuevo: mapGiftRow(row),
      })
      const saved = await loadGiftRow(codigo)
      return { ok: true, record: saved ? mapGiftRow(saved) : mapGiftRow(row) }
    }
    case "giftCertEmit": {
      const codigo = textValue(params, "codigo")
      const row = await loadGiftRow(codigo)
      if (!row) return { ok: false, error: "Certificado no encontrado." }
      const blocked = transitionError("emitir", String(row.estado), String(row.fecha_vencimiento || ""), giftToday())
      if (blocked) return { ok: false, error: blocked }
      const now = new Date().toISOString()
      const { error } = await getSupabaseAdmin().from(GIFT_TABLE)
        .update({ estado: "Emitido", emitido_en: now, updated_at: now }).eq("codigo", codigo)
      if (error) throw error
      await recordGiftAudit({ business_id: effectiveBusinessId(), codigo, usuario: user.email, accion: "emitir", valor_anterior: { estado: row.estado }, valor_nuevo: { estado: "Emitido" } })
      const saved = await loadGiftRow(codigo)
      return { ok: true, record: saved ? mapGiftRow(saved) : null }
    }
    case "giftCertTransition": {
      const accion = textValue(params, "accion") as GiftCertAction // entregar|canjear|anular
      if (!["entregar", "canjear", "anular"].includes(accion)) return { ok: false, error: "Acción no soportada." }
      // Solo la ANULACIÓN (destructiva/irreversible) queda con permiso.
      if (accion === "anular") requirePermission("gift_certificates.void")
      const codigo = textValue(params, "codigo")
      const row = await loadGiftRow(codigo)
      if (!row) return { ok: false, error: "Certificado no encontrado." }
      const blocked = transitionError(accion, String(row.estado), String(row.fecha_vencimiento || ""), giftToday())
      if (blocked) return { ok: false, error: blocked }
      const now = new Date().toISOString()
      const patch: Row = { updated_at: now }
      let motivo = ""
      if (accion === "entregar") {
        patch.estado = "Entregado"; patch.entregado_por = user.email; patch.entregado_en = now
      } else if (accion === "canjear") {
        patch.estado = "Canjeado"; patch.canjeado_por = user.email; patch.canjeado_en = now
        patch.canjeado_sucursal = textValue(params, "sucursal") || String(row.sucursal || "")
        if (textValue(params, "notas")) patch.notas_estado = textValue(params, "notas")
      } else if (accion === "anular") {
        motivo = textValue(params, "motivo").trim()
        if (!motivo) return { ok: false, error: "La anulación requiere un motivo." }
        patch.estado = "Anulado"; patch.motivo_anulacion = motivo; patch.anulado_por = user.email; patch.anulado_en = now
      } else {
        return { ok: false, error: "Acción no soportada." }
      }
      const { error } = await getSupabaseAdmin().from(GIFT_TABLE).update(patch as never).eq("codigo", codigo)
      if (error) throw error
      await recordGiftAudit({ business_id: effectiveBusinessId(), codigo, usuario: user.email, accion, valor_anterior: { estado: row.estado }, valor_nuevo: { estado: patch.estado }, motivo: motivo || undefined })
      const saved = await loadGiftRow(codigo)
      return { ok: true, record: saved ? mapGiftRow(saved) : null }
    }
    case "giftCertDuplicate": {
      const src = await loadGiftRow(textValue(params, "codigo"))
      if (!src) return { ok: false, error: "Certificado no encontrado." }
      const biz = effectiveBusinessId()
      const newCode = await nextGiftCode()
      const now = new Date().toISOString()
      const row: Row = {
        codigo: newCode,
        tipo: "Para imprimir",
        business_id: biz,
        template_id: src.template_id || "moderno",
        otorgado_a: src.otorgado_a || "",
        cortesia_de: src.cortesia_de || "",
        valido_por: src.valido_por || "",
        fecha: giftToday(),
        fecha_vencimiento: src.fecha_vencimiento || null,
        sucursal: src.sucursal || "",
        sucursal_direccion: src.sucursal_direccion || "",
        telefono: src.telefono || "",
        correo: src.correo || "",
        nota_interna: src.nota_interna || "",
        estado: "Borrador",
        creado_por: user.email,
        updated_at: now,
      }
      const { error } = await getSupabaseAdmin().from(GIFT_TABLE).insert(row as never)
      if (error) throw error
      await recordGiftAudit({ business_id: biz, codigo: newCode, usuario: user.email, accion: "duplicar", valor_nuevo: { origen: textValue(params, "codigo") } })
      return { ok: true, record: mapGiftRow(row) }
    }
    case "giftCertLogExport": {
      const accion = textValue(params, "accionExport") // imprimir|descargar_pdf|descargar_png|descargar_jpg
      await recordGiftAudit({ business_id: effectiveBusinessId(), codigo: textValue(params, "codigo"), usuario: user.email, accion: accion || "descargar" })
      return { ok: true }
    }

    case "getCertificadosDepicenter":
      return { ok: true, records: await getRows("certificados_depicenter") }
    case "saveCertificadoDepicenter": {
      const record = parsePayload(params)
      const row = {
        codigo: String(record.codigo ?? record.Codigo ?? params.codigo ?? `DEPI-GC-${Date.now()}`),
        tipo: String(record.tipo ?? record.Tipo ?? "Digital"),
        fecha: dateValue(record.fecha ?? record.Fecha),
        fecha_vencimiento: dateValue(record.fechaVencimiento ?? record.FechaVencimiento),
        sucursal: String(record.sucursal ?? record.Sucursal ?? ""),
        otorgado_a: String(record.otorgadoA ?? record.OtorgadoA ?? ""),
        cortesia_de: String(record.cortesiaDe ?? record.CortesiaDe ?? ""),
        valido_por: String(record.validoPor ?? record.ValidoPor ?? ""),
        monto: record.monto != null && record.monto !== "" ? Number(record.monto) : null,
        servicio: String(record.servicio ?? ""),
        firma: String(record.firma ?? record.Firma ?? ""),
        emitido_en: String(record.emitidoEn ?? record.EmitidoEn ?? new Date().toISOString()),
        emitido_por: String(record.emitidoPor ?? record.EmitidoPor ?? ""),
        estado: String(record.estado ?? record.Estado ?? "Activo"),
        usado_en: record.usadoEn ? String(record.usadoEn) : null,
        fecha_uso: record.fechaUso ? String(record.fechaUso) : null,
        cancelado_en: record.canceladoEn ? String(record.canceladoEn) : null,
        notas_estado: String(record.notasEstado ?? record.NotasEstado ?? ""),
        cliente_nombre: String(record.clienteNombre ?? record.ClienteNombre ?? ""),
        cliente_telefono: String(record.clienteTelefono ?? record.ClienteTelefono ?? ""),
        cliente_correo: String(record.clienteCorreo ?? record.ClienteCorreo ?? ""),
        cliente_documento: String(record.clienteDocumento ?? record.ClienteDocumento ?? ""),
        observaciones: String(record.observaciones ?? record.Observaciones ?? ""),
      }
      await upsertRow("certificados_depicenter", row)
      return { ok: true, record: fromDb("certificados_depicenter", row) }
    }
    case "deleteCertificadoDepicenter":
      await deleteRow("certificados_depicenter", textValue(params, "codigo") || textValue(params, "id"))
      return { ok: true }
    default:
      throw new Error(`Acción de certificados no reconocida: ${action}`)
  }
}
