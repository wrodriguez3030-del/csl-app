/**
 * Tokens de un solo uso para formularios públicos enviados a clientes
 * por WhatsApp. Server-only.
 *
 * Estrategia:
 *  - Token plain = 32 bytes random, base64url-encoded (~43 chars).
 *  - DB guarda SHA-256 hex del token (64 chars). Si la DB se filtra,
 *    los URLs no se pueden forjar (preimage de SHA-256 es infeasible).
 *  - Validación atómica al usar: UPDATE ... WHERE usado=false AND
 *    expira_en>now() AND cancelado=false RETURNING. Si retorna 1 fila,
 *    el token se "consumió" y se puede persistir el form. Si 0, rechazar.
 *
 * Ver supabase/migrations/202605220007_public_form_links.sql
 */

import { createHash, randomBytes } from "node:crypto"
import { getSupabaseAdmin } from "./supabase"

export type FormType =
  | "ficha_dermatologica"
  | "consentimiento_masajes"
  | "consentimiento_peeling"
  | "consentimiento_tatuajes_cejas"
  | "solicitud_empleo"

export const FORM_TYPE_LABEL: Record<FormType, string> = {
  ficha_dermatologica: "Ficha Dermatológica",
  consentimiento_masajes: "Consentimiento de Masajes",
  consentimiento_peeling: "Consentimiento Informado para Peeling",
  consentimiento_tatuajes_cejas: "Consentimiento de Eliminación de Tatuajes y Cejas",
  solicitud_empleo: "Solicitud de empleo",
}

export const FORM_TYPES = Object.keys(FORM_TYPE_LABEL) as FormType[]

export function isFormType(value: unknown): value is FormType {
  return typeof value === "string" && FORM_TYPES.includes(value as FormType)
}

/** Genera un token plain de 32 bytes en base64url (~43 chars URL-safe). */
export function generateToken(): string {
  return randomBytes(32).toString("base64url")
}

/** SHA-256 hex (64 chars). Determinístico — mismo input siempre da el mismo hash. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex")
}

export interface PrefillPayload {
  nombre?: string
  telefono?: string
  documento?: string
  correo?: string
  direccion?: string
  sucursal?: string
  especialista?: string
  motivoConsulta?: string
  servicio?: string
  [key: string]: string | undefined
}

export interface PublicFormLink {
  id: string
  business_id: string
  token_hash: string
  form_type: FormType
  cliente_nombre: string | null
  cliente_telefono: string | null
  creado_por: string | null
  usado: boolean
  usado_en: string | null
  expira_en: string
  cancelado: boolean
  submitted_record_id: string | null
  created_at: string
  prefill_payload: PrefillPayload | null
}

export type LinkStatus = "valido" | "usado" | "expirado" | "cancelado" | "invalido"

export interface VerifyResult {
  status: LinkStatus
  formType?: FormType
  clienteNombre?: string | null
  clienteTelefono?: string | null
  prefillPayload?: PrefillPayload | null
  expiraEn?: string
  link?: PublicFormLink
}

/**
 * Busca el link por token plain (lo hashea internamente) y devuelve su estado.
 * No muta nada — solo lectura.
 */
export async function verifyPublicFormLink(token: string): Promise<VerifyResult> {
  if (!token || typeof token !== "string") return { status: "invalido" }
  const hash = hashToken(token.trim())
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from("csl_public_form_links")
    .select("*")
    .eq("token_hash", hash)
    .maybeSingle()
  if (error || !data) return { status: "invalido" }
  const link = data as PublicFormLink
  if (link.cancelado) return { status: "cancelado", link }
  // Recovery path: si un submit anterior consumió el token pero NO grabó
  // submitted_record_id (bug histórico: orden CLAIM→INSERT, INSERT fallaba),
  // tratamos el link como recuperable — el cliente puede reintentar.
  const usadoYRegistrado = link.usado && link.submitted_record_id && link.submitted_record_id.trim() !== ""
  if (usadoYRegistrado) return { status: "usado", link }
  if (new Date(link.expira_en) <= new Date()) return { status: "expirado", link }
  return {
    status: "valido",
    formType: link.form_type,
    clienteNombre: link.cliente_nombre,
    clienteTelefono: link.cliente_telefono,
    prefillPayload: link.prefill_payload,
    expiraEn: link.expira_en,
    link,
  }
}

/**
 * Reclama atómicamente un token: lo marca como usado SOLO si sigue válido.
 * Devuelve el link reclamado o null si la condición falló (race / ya usado /
 * expirado). El submitted_record_id se setea acá para que quede atado.
 *
 * Importante: hacer el INSERT del form ANTES o DESPUÉS de esta función debe
 * tener una compensación. Patrón recomendado:
 *   1. claim el token (este func)
 *   2. si claim OK → INSERT form con business_id del link.business_id
 *   3. si INSERT falla → opcional: revertir claim (usado=false). En este
 *      caso preferimos NO revertir: usuario re-pide link nuevo, evita
 *      double-submit races.
 */
export async function claimPublicFormLink(
  token: string,
  submittedRecordId: string,
): Promise<PublicFormLink | null> {
  const hash = hashToken(token.trim())
  const supabase = getSupabaseAdmin()
  const nowIso = new Date().toISOString()
  // CLAIM acepta dos casos:
  //   (a) token nunca consumido: usado=false
  //   (b) token consumido por bug histórico (usado=true pero
  //       submitted_record_id null/'') — permitimos reclamar y registrar.
  // Implementación: usamos .or() en PostgREST. Filtros base siguen siendo
  // cancelado=false y expira_en>now().
  const { data, error } = await supabase
    .from("csl_public_form_links")
    .update({
      usado: true,
      usado_en: nowIso,
      submitted_record_id: submittedRecordId,
    })
    .eq("token_hash", hash)
    .eq("cancelado", false)
    .gt("expira_en", nowIso)
    .or("usado.eq.false,submitted_record_id.is.null")
    .select("*")
    .maybeSingle()
  if (error || !data) return null
  return data as PublicFormLink
}

export interface CreateLinkParams {
  businessId: string
  formType: FormType
  createdBy: string
  clienteNombre?: string
  clienteTelefono?: string
  /** Payload completo de pre-fill — campos opcionales que se hidratan
   *  en el form público al abrir el link. Ver PrefillPayload. */
  prefillPayload?: PrefillPayload
  /** TTL en horas; default 12. */
  ttlHours?: number
}

/**
 * Crea un link nuevo. Devuelve el plain token (mostrar UNA vez al usuario)
 * y el registro DB. El plain token NO se persiste; solo el hash.
 */
export async function createPublicFormLink(
  params: CreateLinkParams,
): Promise<{ token: string; link: PublicFormLink }> {
  const token = generateToken()
  const tokenHash = hashToken(token)
  const ttlHours = params.ttlHours ?? 12
  const expiraEn = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString()

  const supabase = getSupabaseAdmin()
  // Sanitizar prefill: solo guardar strings no vacíos para evitar JSON con
  // {"correo":""} que después aparece como string vacío en el form público.
  const cleanedPrefill: PrefillPayload | null = params.prefillPayload
    ? Object.fromEntries(
        Object.entries(params.prefillPayload)
          .filter(([, v]) => typeof v === "string" && v.trim() !== "")
          .map(([k, v]) => [k, String(v).trim()]),
      )
    : null
  const hasPrefill = cleanedPrefill && Object.keys(cleanedPrefill).length > 0

  // Auto-cancelar links previos del mismo cliente + form_type que sigan
  // vivos (no usados, no cancelados, no expirados). Resuelve el caso
  // "el cliente no abrió el primer link, mando otro" sin dejar dos URLs
  // válidas circulando. Solo aplica cuando hay clienteId identificable.
  const clienteIdToCancel = cleanedPrefill?.clienteId
  if (clienteIdToCancel) {
    try {
      await supabase
        .from("csl_public_form_links")
        .update({ cancelado: true })
        .eq("business_id", params.businessId)
        .eq("form_type", params.formType)
        .eq("usado", false)
        .eq("cancelado", false)
        .filter("prefill_payload->>clienteId", "eq", clienteIdToCancel)
    } catch {
      // No bloqueamos la creación del link nuevo si la limpieza falla.
    }
  }

  const { data, error } = await supabase
    .from("csl_public_form_links")
    .insert({
      business_id: params.businessId,
      token_hash: tokenHash,
      form_type: params.formType,
      cliente_nombre: params.clienteNombre || cleanedPrefill?.nombre || null,
      cliente_telefono: params.clienteTelefono || cleanedPrefill?.telefono || null,
      creado_por: params.createdBy,
      expira_en: expiraEn,
      prefill_payload: hasPrefill ? cleanedPrefill : null,
    })
    .select("*")
    .single()
  if (error || !data) {
    throw new Error(`No se pudo crear el link: ${error?.message || "error desconocido"}`)
  }
  return { token, link: data as PublicFormLink }
}
