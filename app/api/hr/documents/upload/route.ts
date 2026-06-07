/**
 * POST /api/hr/documents/upload  (multipart/form-data, auth Bearer)
 * Sube un documento de empleado al bucket privado hr-documents y crea el
 * registro en hr_documents. Multi-tenant por business_id. Máx 10 MB.
 */
import { NextResponse } from "next/server"
import { requireAuthenticatedUser, getSupabaseAdmin } from "@/lib/server/supabase"
import { loadBusinessContext } from "@/lib/server/csl-crud"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

const MAX = 10 * 1024 * 1024
const ALLOWED_EXT = ["pdf", "jpg", "jpeg", "png", "doc", "docx", "xls", "xlsx"]
const json = (d: Record<string, unknown>, status = 200) => NextResponse.json(d, { status, headers: { "Cache-Control": "no-store" } })

export async function POST(request: Request) {
  let user
  try { user = await requireAuthenticatedUser(request) } catch { return json({ ok: false, error: "No autenticado" }, 401) }
  const ctx = await loadBusinessContext(user.id)
  if (!ctx?.businessId) return json({ ok: false, error: "Contexto de negocio no encontrado" }, 403)
  const businessId = ctx.businessId

  let form: FormData
  try { form = await request.formData() } catch { return json({ ok: false, error: "Formato inválido (se esperaba multipart/form-data)" }, 400) }
  const file = form.get("file")
  const employee_id = String(form.get("employee_id") || "").trim()
  const document_type = String(form.get("document_type") || "otros").trim()
  const title = String(form.get("title") || "").trim()
  const visibility = String(form.get("visibility") || "rrhh").trim()
  const expires_at = String(form.get("expires_at") || "").trim()
  const observations = String(form.get("observations") || "").trim()

  if (!employee_id) return json({ ok: false, error: "Selecciona un empleado" }, 400)
  if (!(file instanceof File)) return json({ ok: false, error: "Adjunta un archivo" }, 400)
  if (file.size <= 0) return json({ ok: false, error: "El archivo está vacío" }, 400)
  if (file.size > MAX) return json({ ok: false, error: "El archivo supera el máximo de 10 MB" }, 400)
  const ext = (file.name.split(".").pop() || "").toLowerCase()
  if (!ALLOWED_EXT.includes(ext)) return json({ ok: false, error: `Tipo no permitido (.${ext}). Use PDF, JPG, PNG, DOC, DOCX, XLS o XLSX.` }, 400)

  const sb = getSupabaseAdmin()
  const buf = Buffer.from(await file.arrayBuffer())
  const safe = (file.name || "archivo").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.\-]+/g, "_").slice(0, 120)
  const date = new Date().toISOString().slice(0, 10)
  const path = `${businessId}/${employee_id}/${document_type}/${date}_${Date.now()}_${safe}`

  const up = await sb.storage.from("hr-documents").upload(path, buf, { contentType: file.type || "application/octet-stream", upsert: false })
  if (up.error) {
    if (/bucket.*not.*found/i.test(up.error.message)) return json({ ok: false, error: "Falta el bucket hr-documents en Storage" }, 500)
    return json({ ok: false, error: `No se pudo subir el archivo: ${up.error.message}` }, 500)
  }

  const row = {
    business_id: businessId, employee_id, document_type, title: title || safe,
    visibility, status: "activo", observations: observations || null, expires_at: expires_at || null,
    file_path: path, file_name: file.name || safe, file_mime_type: file.type || null, file_size: file.size,
    created_by: user.id, updated_at: new Date().toISOString(),
  }
  const { data, error } = await sb.from("hr_documents").insert(row).select().single()
  if (error) {
    await sb.storage.from("hr-documents").remove([path]).catch(() => undefined) // rollback storage
    return json({ ok: false, error: `No se pudo registrar el documento: ${error.message}` }, 500)
  }
  try { await sb.from("hr_audit_logs").insert({ business_id: businessId, module: "documentos", action: "upload", entity_type: "hr_documents", entity_id: String((data as { id: string }).id), new_values: { employee_id, document_type, file_name: row.file_name, file_size: row.file_size } }) } catch { /* best-effort */ }
  return json({ ok: true, record: data })
}
