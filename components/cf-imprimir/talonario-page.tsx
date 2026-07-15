"use client"

/**
 * CF PARA IMPRIMIR · Modo TALONARIO PRE-IMPRESO.
 *
 * El papel ya trae el diseño impreso (lazo, logo, título, cintas). Aquí solo se
 * completan los CAMPOS y se imprimen **solo ellos** (fondo transparente) para
 * que caigan sobre el papel. La previsualización muestra la foto del talonario
 * de fondo para ver dónde caen; la calibración ajusta a la impresora real.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react"
import { Printer, RotateCcw, Save, Loader2, AlertCircle, CheckCircle2, Eye, EyeOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAppStore } from "@/lib/store"
import { useSessionUser } from "@/hooks/use-session-user"
import { canPerm } from "@/lib/permissions"
import { addDaysIso, validateGiftCert, type GiftCertData } from "@/lib/certificados/cert-layout"
import {
  renderTalonarioSvg, TALON_CARD, defaultTalonarioCalibration, type TalonarioCalibration,
} from "@/lib/certificados/cert-talonario"
import { loadCertAssets, makeQrDataUri } from "@/lib/certificados/cert-export"
import { useGiftCertificates, errMsg } from "./use-gift-certificates"

const TODAY = new Date().toISOString().slice(0, 10)
const CAL_KEY = "csl_talonario_calibracion_v1"
const GUIDE_SRC = "/certificados/talonario-preimpreso.jpg"

let fontInjected = false
function ensureFont() {
  if (fontInjected || typeof document === "undefined") return
  fontInjected = true
  const style = document.createElement("style")
  style.textContent = `@font-face{font-family:'CFMont';src:url('/fonts/Montserrat.ttf') format('truetype');font-weight:100 900;font-display:swap}.talon-overlay svg{position:absolute;inset:0;width:100%;height:100%}`
  document.head.appendChild(style)
}

interface TalonForm {
  codigo: string
  otorgadoA: string
  cortesiaDe: string
  validoPara: string
  validoHasta: string
  fechaEmision: string
  sucursal: string
}

export function TalonarioPage() {
  const sucursalesDb = useAppStore((s) => s.db.sucursales)
  const user = useSessionUser()
  const gc = useGiftCertificates()

  const sucursales = useMemo(
    () => (sucursalesDb || []).filter((s) => s.Estado !== "Inactiva").map((s) => ({ nombre: s.Nombre, direccion: s.Direccion || "", telefono: s.Telefono || "" })).filter((s) => s.nombre),
    [sucursalesDb],
  )

  const [form, setForm] = useState<TalonForm>({
    codigo: "", otorgadoA: "", cortesiaDe: "", validoPara: "",
    validoHasta: addDaysIso(TODAY, 30), fechaEmision: TODAY, sucursal: "",
  })
  const [qrDataUri, setQrDataUri] = useState("")
  const [cal, setCal] = useState<TalonarioCalibration>(defaultTalonarioCalibration)
  const [showGuide, setShowGuide] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [msg, setMsg] = useState("")

  useEffect(() => {
    ensureFont()
    try {
      const saved = JSON.parse(localStorage.getItem(CAL_KEY) || "{}")
      setCal({ ...defaultTalonarioCalibration, ...saved })
    } catch {}
  }, [])

  useEffect(() => {
    if (!form.sucursal && sucursales[0]) setForm((f) => ({ ...f, sucursal: sucursales[0].nombre }))
  }, [form.sucursal, sucursales])

  const set = (patch: Partial<TalonForm>) => setForm((f) => ({ ...f, ...patch }))
  const updateCal = (patch: Partial<TalonarioCalibration>) => {
    setCal((c) => {
      const next = { ...c, ...patch }
      localStorage.setItem(CAL_KEY, JSON.stringify(next))
      return next
    })
  }
  const resetCal = () => {
    localStorage.setItem(CAL_KEY, JSON.stringify(defaultTalonarioCalibration))
    setCal(defaultTalonarioCalibration)
  }

  const branch = useMemo(() => sucursales.find((s) => s.nombre === form.sucursal), [sucursales, form.sucursal])
  const sucursalDireccion = branch?.direccion || ""
  const sucursalTelefono = branch?.telefono || ""
  const data: GiftCertData = useMemo(
    () => ({ ...form, sucursalDireccion, sucursalTelefono, templateId: "moderno" }),
    [form, sucursalDireccion, sucursalTelefono],
  )
  const previewSvg = useMemo(() => renderTalonarioSvg(data, cal, { qrDataUri, code: form.codigo }), [data, cal, qrDataUri, form.codigo])

  // QR (local) desde el código, una vez guardado el certificado.
  useEffect(() => {
    if (!form.codigo) { setQrDataUri(""); return }
    const url = `${typeof window !== "undefined" ? window.location.origin : ""}/certificado-regalo/validar?c=${encodeURIComponent(form.codigo)}`
    void makeQrDataUri(url).then(setQrDataUri).catch(() => setQrDataUri(""))
  }, [form.codigo])

  function validateNow(): boolean {
    const errs = validateGiftCert({ ...form })
    if (errs.length) { setError(errs.join(" ")); setMsg(""); return false }
    setError("")
    return true
  }

  function flash(m: string) { setMsg(m); setError(""); window.setTimeout(() => setMsg(""), 4000) }

  function validationUrl(code: string) {
    return `${typeof window !== "undefined" ? window.location.origin : ""}/certificado-regalo/validar?c=${encodeURIComponent(code)}`
  }

  /** Guarda+emite (si aún no tiene código) y devuelve el código para el QR. */
  async function ensureRecord(): Promise<string> {
    if (form.codigo) return form.codigo
    if (!canPerm(user, "gift_certificates.create")) return ""
    const rec = await gc.save({
      otorgadoA: form.otorgadoA, cortesiaDe: form.cortesiaDe, validoPara: form.validoPara,
      validoHasta: form.validoHasta, fechaEmision: form.fechaEmision, sucursal: form.sucursal,
      sucursalDireccion, sucursalTelefono, templateId: "moderno",
    })
    await gc.emit(rec.codigo).catch(() => undefined)
    set({ codigo: rec.codigo })
    void gc.refresh()
    return rec.codigo
  }

  async function doPrint() {
    if (busy) return
    if (!validateNow()) return
    setBusy("print")
    try {
      // Asegura un código real → el QR valida (si el usuario puede registrar).
      const code = await ensureRecord()
      const qr = code ? (qrDataUri || (await makeQrDataUri(validationUrl(code)))) : ""
      const assets = await loadCertAssets()
      const svg = renderTalonarioSvg(data, cal, { embedFonts: true, montserratB64: assets.montserratB64, qrDataUri: qr, code })
      const w = window.open("", "_blank")
      if (!w) { setError("Habilita las ventanas emergentes para imprimir."); return }
      w.document.write(
        `<!doctype html><html><head><meta charset="utf-8"><title>Talonario</title>` +
          `<style>@page{size:9.78in 6.3in;margin:0}html,body{margin:0;padding:0;background:#fff}svg{width:9.78in;height:6.3in;display:block}</style>` +
          `</head><body>${svg}</body></html>`,
      )
      w.document.close()
      w.focus()
      window.setTimeout(() => w.print(), 450)
      flash("Enviado a impresión. Coloca el talonario pre-impreso en la bandeja.")
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(null)
    }
  }

  async function doSave() {
    if (busy) return
    if (!validateNow()) return
    if (!canPerm(user, "gift_certificates.create")) { setError("No tienes permiso para registrar certificados."); return }
    setBusy("save")
    try {
      const code = await ensureRecord()
      flash(code ? `Registrado y emitido · ${code}` : "Guardado")
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-bold">Talonario pre-impreso</h3>
          <p className="text-sm text-muted-foreground">Completa los campos; se imprimen solo ellos sobre el certificado ya impreso.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowGuide((v) => !v)}>
            {showGuide ? <EyeOff className="mr-2 h-4 w-4" /> : <Eye className="mr-2 h-4 w-4" />}
            {showGuide ? "Ocultar guía" : "Ver guía"}
          </Button>
          {canPerm(user, "gift_certificates.create") ? (
            <Button variant="outline" size="sm" onClick={doSave} disabled={!!busy}>
              {busy === "save" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Guardar registro
            </Button>
          ) : null}
          <Button size="sm" onClick={doPrint} disabled={!!busy}>
            {busy === "print" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Printer className="mr-2 h-4 w-4" />}Imprimir en talonario
          </Button>
        </div>
      </div>

      {error ? (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span></div>
      ) : null}
      {msg ? (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"><CheckCircle2 className="h-4 w-4 shrink-0" /><span>{msg}</span></div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,380px)_1fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Datos a imprimir</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <F label="Otorgado a" req><Input value={form.otorgadoA} onChange={(e) => set({ otorgadoA: e.target.value })} placeholder="Nombre del beneficiario" /></F>
              <F label="Cortesía de" req><Input value={form.cortesiaDe} onChange={(e) => set({ cortesiaDe: e.target.value })} placeholder="Quien obsequia" /></F>
              <F label="Válido para" req><Input value={form.validoPara} onChange={(e) => set({ validoPara: e.target.value })} placeholder="Servicio" /></F>
              <div className="grid grid-cols-2 gap-3">
                <F label="Emisión" req><Input type="date" value={form.fechaEmision} onChange={(e) => set({ fechaEmision: e.target.value })} /></F>
                <F label="Válido hasta" req><Input type="date" value={form.validoHasta} onChange={(e) => set({ validoHasta: e.target.value })} /></F>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <span className="text-xs text-muted-foreground">Vigencia:</span>
                {[30, 60, 90].map((d) => (
                  <button key={d} type="button" className="rounded border px-2 py-0.5 text-xs hover:bg-muted" onClick={() => set({ validoHasta: addDaysIso(form.fechaEmision, d) })}>{d} días</button>
                ))}
              </div>
              <F label="Sucursal de entrega" req>
                <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.sucursal} onChange={(e) => set({ sucursal: e.target.value })}>
                  {sucursales.length === 0 ? <option value="">(sin sucursales)</option> : null}
                  {sucursales.map((s) => <option key={s.nombre} value={s.nombre}>{s.nombre}</option>)}
                </select>
              </F>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Calibración de impresión</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">Ajusta si el texto no cae exacto en tu impresora. 100 = 1 pulgada. Haz una prueba y corrige.</p>
              <div className="grid grid-cols-2 gap-3">
                <F label="Mover horizontal (→ +)"><Input type="number" step="2" value={cal.offsetX} onChange={(e) => updateCal({ offsetX: Number(e.target.value) || 0 })} /></F>
                <F label="Mover vertical (↓ +)"><Input type="number" step="2" value={cal.offsetY} onChange={(e) => updateCal({ offsetY: Number(e.target.value) || 0 })} /></F>
                <F label="Escala general"><Input type="number" step="0.02" value={cal.scale} onChange={(e) => updateCal({ scale: Number(e.target.value) || 1 })} /></F>
                <F label="Tamaño de letra"><Input type="number" step="0.05" value={cal.fontScale} onChange={(e) => updateCal({ fontScale: Number(e.target.value) || 1 })} /></F>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={resetCal}><RotateCcw className="mr-2 h-4 w-4" />Restablecer</Button>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Previsualización sobre el talonario</CardTitle></CardHeader>
          <CardContent>
            <div className="relative mx-auto max-w-[820px] overflow-hidden rounded-lg shadow-xl ring-1 ring-black/10" style={{ aspectRatio: `${TALON_CARD.w} / ${TALON_CARD.h}`, background: "#fff" }}>
              {showGuide ? (
                <img src={GUIDE_SRC} alt="Talonario pre-impreso" className="absolute inset-0 h-full w-full object-cover" />
              ) : null}
              <div className="talon-overlay absolute inset-0" dangerouslySetInnerHTML={{ __html: previewSvg }} />
            </div>
            <p className="mt-2 text-center text-xs text-muted-foreground">La guía es solo referencia; al imprimir salen únicamente los campos.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function F({ label, req, children }: { label: string; req?: boolean; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label} {req ? <span className="text-rose-500">*</span> : null}</Label>
      {children}
    </div>
  )
}
