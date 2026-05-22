"use client"

import { useEffect, useState } from "react"
import { Check, Copy, Loader2, MessageCircle, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { supabaseBrowser } from "@/lib/supabase-client"

type FormType =
  | "ficha_dermatologica"
  | "consentimiento_masajes"
  | "consentimiento_tatuajes_cejas"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  formType: FormType
  title: string
}

interface GeneratedLink {
  url: string
  whatsappUrl: string
  expiraEn: string
}

export function LinkGeneratorDialog({ open, onOpenChange, formType, title }: Props) {
  const [clienteNombre, setClienteNombre] = useState("")
  const [clienteTelefono, setClienteTelefono] = useState("")
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState("")
  const [result, setResult] = useState<GeneratedLink | null>(null)
  const [copied, setCopied] = useState(false)

  // Reset al cerrar/reabrir.
  useEffect(() => {
    if (!open) {
      setClienteNombre("")
      setClienteTelefono("")
      setError("")
      setResult(null)
      setCopied(false)
      setGenerating(false)
    }
  }, [open])

  const generate = async () => {
    setError("")
    setGenerating(true)
    try {
      const { data: { session } } = await supabaseBrowser.auth.getSession()
      if (!session?.access_token) throw new Error("Sesión no válida — vuelve a iniciar sesión")
      const response = await fetch("/api/public-form-links", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          formType,
          clienteNombre: clienteNombre.trim() || undefined,
          clienteTelefono: clienteTelefono.trim() || undefined,
        }),
      })
      const raw = await response.text()
      let parsed: { ok?: boolean; url?: string; whatsappUrl?: string; expiraEn?: string; error?: string } = {}
      try { parsed = raw ? JSON.parse(raw) : {} } catch { parsed = { error: raw } }
      if (!response.ok || !parsed.ok || !parsed.url || !parsed.whatsappUrl || !parsed.expiraEn) {
        throw new Error(parsed.error || `Error ${response.status}`)
      }
      setResult({ url: parsed.url, whatsappUrl: parsed.whatsappUrl, expiraEn: parsed.expiraEn })
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : "Error al generar el link")
    } finally {
      setGenerating(false)
    }
  }

  const copy = async () => {
    if (!result) return
    try {
      await navigator.clipboard.writeText(result.url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback ultra-simple: select + execCommand legacy si clipboard falla.
      const el = document.getElementById("public-link-input") as HTMLInputElement | null
      if (el) {
        el.select()
        try { document.execCommand("copy"); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* noop */ }
      }
    }
  }

  const fmtExpires = (iso: string) => {
    try {
      const date = new Date(iso)
      return date.toLocaleString("es-DO", { dateStyle: "medium", timeStyle: "short" })
    } catch { return iso }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            El cliente recibirá un enlace válido por <b>12 horas</b> y de <b>un solo uso</b>.
          </DialogDescription>
        </DialogHeader>

        {!result ? (
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-xs">Nombre del cliente (opcional)</Label>
              <Input
                value={clienteNombre}
                onChange={(e) => setClienteNombre(e.target.value)}
                placeholder="Para pre-llenar el form"
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">Teléfono del cliente (opcional)</Label>
              <Input
                value={clienteTelefono}
                onChange={(e) => setClienteTelefono(e.target.value)}
                placeholder="Solo referencia, no se envía SMS"
                className="mt-1"
              />
            </div>
            {error ? (
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs font-semibold text-rose-700">
                ⚠ {error}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="space-y-3 py-2">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700">
              <div className="flex items-center gap-1.5 font-semibold">
                <Check className="h-3.5 w-3.5" /> Link creado
              </div>
              <div className="mt-1">Expira: <b>{fmtExpires(result.expiraEn)}</b></div>
            </div>
            <div>
              <Label className="text-xs">Enlace público (un solo uso)</Label>
              <div className="mt-1 flex gap-1">
                <Input id="public-link-input" value={result.url} readOnly className="font-mono text-xs" />
                <Button type="button" variant="outline" size="icon" onClick={copy} title="Copiar">
                  {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <a
              href={result.whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-[#25D366] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#1ebe57]"
            >
              <MessageCircle className="h-4 w-4" />
              Enviar por WhatsApp
            </a>
            <p className="text-[11px] text-muted-foreground">
              El botón abre WhatsApp Web (escritorio) o la app (móvil) para que elijas el contacto.
            </p>
          </div>
        )}

        <DialogFooter>
          {!result ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={generating}>Cancelar</Button>
              <Button onClick={generate} disabled={generating} className="gap-2">
                {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {generating ? "Generando..." : "Generar link"}
              </Button>
            </>
          ) : (
            <Button onClick={() => onOpenChange(false)} className="w-full sm:w-auto">Cerrar</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
