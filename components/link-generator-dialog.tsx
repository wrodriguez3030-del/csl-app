"use client"

import { useEffect, useMemo, useState } from "react"
import { Check, Copy, Loader2, MessageCircle, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useAppStore } from "@/lib/store"
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

// Estado de pre-fill — los campos opcionales según el tipo de form.
// El cliente verá estos datos PRE-CARGADOS al abrir el link.
interface PrefillState {
  nombre: string
  telefono: string
  documento: string
  correo: string
  direccion: string
  sucursal: string
  motivoConsulta: string  // solo aplica a ficha_dermatologica
  servicio: string        // solo aplica a consents
}

const emptyPrefill: PrefillState = {
  nombre: "",
  telefono: "",
  documento: "",
  correo: "",
  direccion: "",
  sucursal: "",
  motivoConsulta: "",
  servicio: "",
}

export function LinkGeneratorDialog({ open, onOpenChange, formType, title }: Props) {
  const sucursalesDb = useAppStore((state) => state.db.sucursales)
  const sucursalesOptions = useMemo(
    () => (sucursalesDb || []).map((s) => s.Nombre).filter(Boolean),
    [sucursalesDb],
  )

  const [prefill, setPrefill] = useState<PrefillState>(emptyPrefill)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState("")
  const [result, setResult] = useState<GeneratedLink | null>(null)
  const [copied, setCopied] = useState(false)

  // Reset al cerrar/reabrir.
  useEffect(() => {
    if (!open) {
      setPrefill(emptyPrefill)
      setError("")
      setResult(null)
      setCopied(false)
      setGenerating(false)
    }
  }, [open])

  const update = (patch: Partial<PrefillState>) => setPrefill((c) => ({ ...c, ...patch }))

  const generate = async () => {
    setError("")
    setGenerating(true)
    try {
      const { data: { session } } = await supabaseBrowser.auth.getSession()
      if (!session?.access_token) throw new Error("Sesión no válida — vuelve a iniciar sesión")

      // Solo enviamos prefill fields que el form_type usa, para evitar ruido.
      const prefillPayload: Record<string, string> = {}
      const include = (key: keyof PrefillState) => {
        const v = prefill[key].trim()
        if (v) prefillPayload[key] = v
      }
      include("nombre")
      include("telefono")
      include("documento")
      include("correo")
      include("direccion")
      include("sucursal")
      if (formType === "ficha_dermatologica") include("motivoConsulta")
      if (formType !== "ficha_dermatologica") include("servicio")

      const response = await fetch("/api/public-form-links", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          formType,
          clienteNombre: prefill.nombre.trim() || undefined,
          clienteTelefono: prefill.telefono.trim() || undefined,
          prefillPayload: Object.keys(prefillPayload).length > 0 ? prefillPayload : undefined,
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

  const isFicha = formType === "ficha_dermatologica"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Pre-carga los datos del cliente para que vea el form listo al abrir el link. El
            enlace es válido por <b>12 horas</b> y de <b>un solo uso</b>.
          </DialogDescription>
        </DialogHeader>

        {!result ? (
          <div className="space-y-3 py-2">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-xs">Nombre del cliente</Label>
                <Input
                  value={prefill.nombre}
                  onChange={(e) => update({ nombre: e.target.value })}
                  placeholder="Nombre completo"
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-xs">Teléfono</Label>
                <Input
                  value={prefill.telefono}
                  onChange={(e) => update({ telefono: e.target.value })}
                  placeholder="809-555-1234"
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-xs">Cédula / Documento</Label>
                <Input
                  value={prefill.documento}
                  onChange={(e) => update({ documento: e.target.value })}
                  placeholder="000-0000000-0"
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-xs">Correo</Label>
                <Input
                  type="email"
                  value={prefill.correo}
                  onChange={(e) => update({ correo: e.target.value })}
                  placeholder="cliente@ejemplo.com"
                  className="mt-1"
                />
              </div>
              <div className="sm:col-span-2">
                <Label className="text-xs">Dirección</Label>
                <Input
                  value={prefill.direccion}
                  onChange={(e) => update({ direccion: e.target.value })}
                  placeholder="Calle, sector, ciudad"
                  className="mt-1"
                />
              </div>
              <div className={isFicha ? "" : "sm:col-span-2"}>
                <Label className="text-xs">Sucursal</Label>
                {sucursalesOptions.length ? (
                  <Select value={prefill.sucursal} onValueChange={(value) => update({ sucursal: value })}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Opcional" /></SelectTrigger>
                    <SelectContent>
                      {sucursalesOptions.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    value={prefill.sucursal}
                    onChange={(e) => update({ sucursal: e.target.value })}
                    placeholder="Opcional"
                    className="mt-1"
                  />
                )}
              </div>
              {isFicha ? (
                <div>
                  <Label className="text-xs">Motivo de consulta</Label>
                  <Input
                    value={prefill.motivoConsulta}
                    onChange={(e) => update({ motivoConsulta: e.target.value })}
                    placeholder="Ej. Manchas, acné..."
                    className="mt-1"
                  />
                </div>
              ) : (
                <div className="sm:col-span-2">
                  <Label className="text-xs">Servicio / Procedimiento</Label>
                  <Input
                    value={prefill.servicio}
                    onChange={(e) => update({ servicio: e.target.value })}
                    placeholder="Tipo de masaje, eliminación de tatuaje, etc."
                    className="mt-1"
                  />
                </div>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Todos los campos son opcionales — solo se incluyen los que llenes.
              El cliente puede corregirlos en el form si hace falta.
            </p>
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
              <div className="mt-1">
                Este enlace vence en 12 horas (<b>{fmtExpires(result.expiraEn)}</b>) y solo puede usarse una vez.
              </div>
            </div>
            <div>
              <Label className="text-xs">Enlace público</Label>
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
