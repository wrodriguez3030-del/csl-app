"use client"

import { useRef, useState } from "react"
import { useAppStore, apiJsonp, normalizeApiUrl } from "@/lib/store"
import { supabaseBrowser } from "@/lib/supabase-client"
import { Button } from "@/components/ui/button"
import { Paperclip, Camera, Eye, Loader2, X } from "lucide-react"

/**
 * Input de adjunto para Compras: subir archivo (PDF/imagen), TOMAR FOTO (cámara
 * trasera en móvil) y VER el adjunto guardado (URL firmada). Devuelve el PATH
 * interno del bucket purchase-docs; el formulario lo persiste en su tabla.
 */
export function AttachmentInput({
  kind, refId = "nuevo", value, onChange, disabled,
}: {
  kind: string
  refId?: string
  value: string | null
  onChange: (path: string | null) => void
  disabled?: boolean
}) {
  const { apiUrl, showToast } = useAppStore()
  const [uploading, setUploading] = useState(false)
  const [viewing, setViewing] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const camRef = useRef<HTMLInputElement>(null)

  const upload = async (file: File | undefined) => {
    if (!file) return
    setUploading(true)
    try {
      const { data: { session } } = await supabaseBrowser.auth.getSession()
      if (!session?.access_token) throw new Error("Sesión no válida — vuelve a iniciar sesión")
      const fd = new FormData()
      fd.append("file", file)
      fd.append("kind", kind)
      fd.append("ref_id", refId)
      const res = await fetch("/api/purchases/documents/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: fd,
      })
      const result = (await res.json().catch(() => ({}))) as { ok?: boolean; path?: string; error?: string }
      if (!result.ok || !result.path) throw new Error(result.error || "No se pudo subir")
      onChange(result.path)
      showToast("Adjunto guardado", "success")
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error al subir", "error")
    } finally {
      setUploading(false)
    }
  }

  const view = async () => {
    if (!value) return
    setViewing(true)
    try {
      const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "getPurchaseAttachmentUrl", path: value }) as { ok?: boolean; url?: string; error?: string }
      if (res?.ok && res.url) window.open(res.url, "_blank", "noopener")
      else showToast(res?.error || "No se pudo abrir", "error")
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error", "error")
    } finally {
      setViewing(false)
    }
  }

  const fileName = value ? value.split("/").pop()?.replace(/^\d{4}-\d{2}-\d{2}_\d+_/, "") : ""

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input ref={fileRef} type="file" accept=".pdf,image/*,.doc,.docx,.xls,.xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; void upload(f) }} />
      <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; void upload(f) }} />
      <Button type="button" variant="outline" size="sm" className="h-9" disabled={disabled || uploading} onClick={() => fileRef.current?.click()}>
        {uploading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Paperclip className="mr-1.5 h-4 w-4" />}Archivo
      </Button>
      <Button type="button" variant="outline" size="sm" className="h-9" disabled={disabled || uploading} onClick={() => camRef.current?.click()}>
        <Camera className="mr-1.5 h-4 w-4" />Tomar foto
      </Button>
      {value ? (
        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-xs text-emerald-700">
          <button type="button" className="inline-flex items-center gap-1" onClick={view} disabled={viewing} title="Ver adjunto">
            {viewing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Eye className="h-3 w-3" />}
            {fileName?.slice(0, 24) || "adjunto"}
          </button>
          {!disabled && <button type="button" onClick={() => onChange(null)} title="Quitar"><X className="h-3 w-3" /></button>}
        </span>
      ) : null}
    </div>
  )
}

/** Botón compacto "Ver adjunto" para tablas/detalle (solo ver). */
export function ViewAttachmentButton({ path }: { path: string | null | undefined }) {
  const { apiUrl, showToast } = useAppStore()
  const [viewing, setViewing] = useState(false)
  if (!path) return null
  const view = async () => {
    setViewing(true)
    try {
      const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "getPurchaseAttachmentUrl", path }) as { ok?: boolean; url?: string; error?: string }
      if (res?.ok && res.url) window.open(res.url, "_blank", "noopener")
      else showToast(res?.error || "No se pudo abrir", "error")
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error", "error")
    } finally { setViewing(false) }
  }
  return (
    <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={view} disabled={viewing} title="Ver adjunto">
      {viewing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
    </Button>
  )
}
