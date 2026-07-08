/**
 * POST /api/purchases/documents/upload  (multipart/form-data, auth Bearer)
 *
 * Sube el adjunto de una compra/gasto (foto o PDF de la factura, comprobante)
 * al bucket privado `purchase-docs` y devuelve el path interno, que el cliente
 * persiste en la columna *_attachment_path de la fila correspondiente. Se puede
 * subir antes de tener id (path temporal por `kind`+timestamp) y asociarlo al
 * guardar. Multi-tenant por business_id. Máx 10 MB. Self-heal del bucket.
 */
import { NextResponse } from "next/server"
import { requireAuthenticatedUser, getSupabaseAdmin } from "@/lib/server/supabase"
import { loadBusinessContext } from "@/lib/server/csl-crud"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

const BUCKET = "purchase-docs"
const MAX = 10 * 1024 * 1024
const ALLOWED_EXT = ["pdf", "jpg", "jpeg", "png", "webp", "heic", "doc", "docx", "xls", "xlsx"]
const json = (d: Record<string, unknown>, status = 200) =>
  NextResponse.json(d, { status, headers: { "Cache-Control": "no-store" } })

export async function POST(request: Request) {
  let user
  try {
    user = await requireAuthenticatedUser(request)
  } catch {
    return json({ ok: false, error: "No autenticado" }, 401)
  }
  const ctx = await loadBusinessContext(user.id)
  if (!ctx?.businessId) return json({ ok: false, error: "Contexto de negocio no encontrado" }, 403)
  const businessId = ctx.businessId

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return json({ ok: false, error: "Formato inválido (se esperaba multipart/form-data)" }, 400)
  }
  const file = form.get("file")
  // `kind` agrupa el archivo por submódulo: facturas | pagos | gastos | menores | recurrentes
  const kind = (String(form.get("kind") || "compras").trim().replace(/[^a-z0-9_-]/gi, "") || "compras").toLowerCase()
  const refId = String(form.get("ref_id") || "nuevo").trim().replace(/[^\w-]/g, "").slice(0, 40) || "nuevo"

  if (!(file instanceof File)) return json({ ok: false, error: "Adjunta un archivo" }, 400)
  if (file.size <= 0) return json({ ok: false, error: "El archivo está vacío" }, 400)
  if (file.size > MAX) return json({ ok: false, error: "El archivo supera el máximo de 10 MB" }, 400)
  const ext = (file.name.split(".").pop() || "").toLowerCase()
  if (!ALLOWED_EXT.includes(ext))
    return json({ ok: false, error: `Tipo no permitido (.${ext}). Use PDF o imagen (JPG, PNG, WEBP, HEIC).` }, 400)

  const sb = getSupabaseAdmin()
  const buf = Buffer.from(await file.arrayBuffer())
  const safe = (file.name || "archivo")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\w.\-]+/g, "_")
    .slice(0, 120)
  const date = new Date().toISOString().slice(0, 10)
  const path = `${businessId}/${kind}/${refId}/${date}_${Date.now()}_${safe}`

  const opts = { contentType: file.type || "application/octet-stream", upsert: false }
  let up = await sb.storage.from(BUCKET).upload(path, buf, opts)
  // Self-heal: si el bucket aún no existe, lo creamos (privado) y reintentamos.
  if (up.error && /bucket.*not.*found/i.test(up.error.message)) {
    await sb.storage.createBucket(BUCKET, { public: false, fileSizeLimit: MAX }).catch(() => undefined)
    up = await sb.storage.from(BUCKET).upload(path, buf, opts)
  }
  if (up.error) {
    return json({ ok: false, error: `No se pudo subir el archivo: ${up.error.message}` }, 500)
  }

  return json({ ok: true, path, file_name: file.name || safe })
}
