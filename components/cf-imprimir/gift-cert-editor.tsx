"use client"

/**
 * CF PARA IMPRIMIR · Editor de certificado (formulario + preview en vivo).
 *
 * Formulario a la izquierda, previsualización en tiempo real a la derecha
 * (apilado en móvil). Selector de 3 diseños, zoom, y botones de acción
 * gateados por PERMISO (RBAC) y por ESTADO (máquina de estados). El backend
 * revalida todo; aquí solo mostramos/ocultamos y evitamos el doble clic.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import {
  ArrowLeft, Save, Send, Printer, FileDown, ImageDown, Copy,
  PackageCheck, BadgeCheck, Ban, ZoomIn, ZoomOut, Loader2, AlertCircle, CheckCircle2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { canPerm } from "@/lib/permissions"
import type { SystemUser } from "@/lib/security"
import {
  validateGiftCert, addDaysIso,
  type GiftCertData, type GiftTemplateId,
} from "@/lib/certificados/cert-layout"
import { canDo, effectiveEstado, type GiftCertAction } from "@/lib/certificados/cert-state"
import {
  buildExportSvg, makeQrDataUri, rasterizeSvg, svgToPdfBytes,
  downloadBlob, downloadBytes, certFilenameBase, printSvg,
} from "@/lib/certificados/cert-export"
import { CertificadoPreview } from "./certificado-preview"
import { errMsg, useGiftCertificates, type GiftCertRecord } from "./use-gift-certificates"

const TODAY = new Date().toISOString().slice(0, 10)

interface FormState {
  codigo: string
  estado: string
  otorgadoA: string
  cortesiaDe: string
  validoPara: string
  validoHasta: string
  fechaEmision: string
  sucursal: string
  telefono: string
  correo: string
  notaInterna: string
  templateId: GiftTemplateId
}

function toForm(rec: GiftCertRecord | null, sucursales: { nombre: string }[]): FormState {
  return {
    codigo: rec?.codigo || "",
    estado: rec?.estado || "Borrador",
    otorgadoA: rec?.otorgadoA || "",
    cortesiaDe: rec?.cortesiaDe || "",
    validoPara: rec?.validoPara || "",
    validoHasta: rec?.validoHasta || addDaysIso(TODAY, 30),
    fechaEmision: rec?.fechaEmision || TODAY,
    sucursal: rec?.sucursal || sucursales[0]?.nombre || "",
    telefono: rec?.telefono || "",
    correo: rec?.correo || "",
    notaInterna: rec?.notaInterna || "",
    templateId: rec?.templateId || "moderno",
  }
}

const ESTADO_STYLES: Record<string, string> = {
  Borrador: "bg-slate-100 text-slate-700",
  Emitido: "bg-sky-100 text-sky-800",
  Entregado: "bg-indigo-100 text-indigo-800",
  Canjeado: "bg-emerald-100 text-emerald-800",
  Vencido: "bg-amber-100 text-amber-800",
  Anulado: "bg-rose-100 text-rose-800",
}

export function GiftCertEditor({
  initial,
  sucursales,
  user,
  gc,
  onBack,
  onChanged,
}: {
  initial: GiftCertRecord | null
  sucursales: { nombre: string; direccion: string; telefono: string }[]
  user: SystemUser | null
  gc: ReturnType<typeof useGiftCertificates>
  onBack: () => void
  onChanged: (rec: GiftCertRecord) => void
}) {
  const [form, setForm] = useState<FormState>(() => toForm(initial, sucursales))
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [msg, setMsg] = useState("")
  const [zoom, setZoom] = useState(100)
  const [qrDataUri, setQrDataUri] = useState<string>("")
  const [confirm, setConfirm] = useState<null | { accion: GiftCertAction; needsReason: boolean }>(null)
  const [reason, setReason] = useState("")

  const isDraft = effectiveEstado(form.estado, form.validoHasta, TODAY) === "Borrador"
  const editable = isDraft
  const can = (p: string) => canPerm(user, p)

  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }))
  const branch = useMemo(() => sucursales.find((s) => s.nombre === form.sucursal), [sucursales, form.sucursal])
  const sucursalDireccion = branch?.direccion || ""
  const sucursalTelefono = branch?.telefono || ""

  const previewData: GiftCertData = useMemo(
    () => ({
      codigo: form.codigo || "CSL-REG-XXXX-XXXXXX",
      otorgadoA: form.otorgadoA,
      cortesiaDe: form.cortesiaDe,
      validoPara: form.validoPara,
      validoHasta: form.validoHasta,
      fechaEmision: form.fechaEmision,
      sucursal: form.sucursal,
      sucursalDireccion,
      sucursalTelefono,
      templateId: form.templateId,
    }),
    [form, sucursalDireccion, sucursalTelefono],
  )

  // QR (local) para el preview: depende solo del código (una vez guardado).
  const qrReqId = useRef(0)
  useEffect(() => {
    const id = ++qrReqId.current
    if (!form.codigo) {
      setQrDataUri("")
      return
    }
    const url = `${typeof window !== "undefined" ? window.location.origin : ""}/certificado-regalo/validar?c=${encodeURIComponent(form.codigo)}`
    void makeQrDataUri(url).then((uri) => {
      if (qrReqId.current === id) setQrDataUri(uri)
    })
  }, [form.codigo])

  function flash(m: string) {
    setMsg(m)
    setError("")
    window.setTimeout(() => setMsg(""), 4000)
  }
  function fail(e: unknown) {
    setError(errMsg(e))
    setMsg("")
  }

  function validateNow(): boolean {
    const errs = validateGiftCert({ ...form })
    if (errs.length) {
      setError(errs.join(" "))
      setMsg("")
      return false
    }
    return true
  }

  /** Persiste el borrador si hace falta y devuelve el registro vigente (con código). */
  async function ensureSaved(): Promise<GiftCertRecord | null> {
    if (!validateNow()) return null
    if (form.estado === "Borrador" || !form.codigo) {
      const rec = await gc.save({
        codigo: form.codigo,
        otorgadoA: form.otorgadoA,
        cortesiaDe: form.cortesiaDe,
        validoPara: form.validoPara,
        validoHasta: form.validoHasta,
        fechaEmision: form.fechaEmision,
        sucursal: form.sucursal,
        sucursalDireccion,
        sucursalTelefono,
        telefono: form.telefono,
        correo: form.correo,
        notaInterna: form.notaInterna,
        templateId: form.templateId,
      })
      set({ codigo: rec.codigo, estado: rec.estado })
      onChanged(rec)
      return rec
    }
    // Ya emitido/entregado → inmutable, se usa tal cual.
    return { ...(initial as GiftCertRecord), ...form } as GiftCertRecord
  }

  async function run(key: string, fn: () => Promise<void>) {
    if (busy) return
    setBusy(key)
    try {
      await fn()
    } catch (e) {
      fail(e)
    } finally {
      setBusy(null)
    }
  }

  const doSaveDraft = () =>
    run("save", async () => {
      const rec = await ensureSaved()
      if (rec) flash(`Borrador guardado · ${rec.codigo}`)
    })

  const doEmit = () =>
    run("emit", async () => {
      const rec = await ensureSaved()
      if (!rec) return
      const emitted = await gc.emit(rec.codigo)
      set({ codigo: emitted.codigo, estado: emitted.estado })
      onChanged(emitted)
      flash(`Certificado emitido · ${emitted.codigo}`)
    })

  async function exportSvg(): Promise<{ svg: string; code: string } | null> {
    const rec = await ensureSaved()
    if (!rec) return null
    const data: GiftCertData = { ...previewData, codigo: rec.codigo, sucursalDireccion: rec.sucursalDireccion || sucursalDireccion, sucursalTelefono: rec.sucursalTelefono || sucursalTelefono }
    const url = `${window.location.origin}/certificado-regalo/validar?c=${encodeURIComponent(rec.codigo)}`
    const qr = await makeQrDataUri(url)
    const svg = await buildExportSvg(data, qr)
    return { svg, code: rec.codigo }
  }

  const doPrint = () =>
    run("print", async () => {
      const out = await exportSvg()
      if (!out) return
      if (!printSvg(out.svg, out.code)) {
        setError("Habilita las ventanas emergentes para imprimir.")
        return
      }
      gc.logExport(out.code, "imprimir")
      flash("Enviado a impresión")
    })

  const doDownload = (kind: "pdf" | "png" | "jpg") =>
    run(kind, async () => {
      const out = await exportSvg()
      if (!out) return
      const base = certFilenameBase({ ...previewData, codigo: out.code })
      if (kind === "pdf") {
        const bytes = await svgToPdfBytes(out.svg)
        downloadBytes(bytes, `${base}.pdf`)
        gc.logExport(out.code, "descargar_pdf")
      } else {
        const blob = await rasterizeSvg(out.svg, { scale: 3, type: kind === "png" ? "image/png" : "image/jpeg", quality: 0.95 })
        downloadBlob(blob, `${base}.${kind}`)
        gc.logExport(out.code, kind === "png" ? "descargar_png" : "descargar_jpg")
      }
      flash(`Descarga ${kind.toUpperCase()} lista`)
    })

  function askConfirm(accion: GiftCertAction, needsReason: boolean) {
    setConfirm({ accion, needsReason })
    setReason("")
    setError("")
  }

  const doConfirm = () =>
    run("transition", async () => {
      if (!confirm) return
      const { accion } = confirm
      if (accion === "anular" && !reason.trim()) {
        setError("La anulación requiere un motivo.")
        setBusy(null)
        return
      }
      const extra: Record<string, string> = {}
      if (accion === "anular") extra.motivo = reason.trim()
      if (accion === "canjear") extra.sucursal = form.sucursal
      const rec = await gc.transition(form.codigo, accion as "entregar" | "canjear" | "anular", extra)
      set({ estado: rec.estado })
      onChanged(rec)
      setConfirm(null)
      flash(`Certificado ${rec.estado.toLowerCase()}`)
    })

  const eff = effectiveEstado(form.estado, form.validoHasta, TODAY)
  // Acceso por MENÚ (decisión del usuario): las acciones comunes se muestran a
  // quien tenga el módulo; solo "Anular" (destructiva) queda con permiso.
  const stCanDeliver = canDo("entregar", form.estado, form.validoHasta, TODAY)
  const stCanRedeem = canDo("canjear", form.estado, form.validoHasta, TODAY)
  const stCanVoid = can("gift_certificates.void") && canDo("anular", form.estado, form.validoHasta, TODAY)
  const canExport = true

  return (
    <div className="space-y-4">
      {/* Barra superior */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={onBack}><ArrowLeft className="mr-2 h-4 w-4" />Volver al listado</Button>
          {form.codigo ? <span className="font-mono text-sm text-muted-foreground">{form.codigo}</span> : <span className="text-sm text-muted-foreground">Nuevo certificado</span>}
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${ESTADO_STYLES[eff] || "bg-slate-100 text-slate-700"}`}>{eff}</span>
        </div>
      </div>

      {error ? (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span>
        </div>
      ) : null}
      {msg ? (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          <CheckCircle2 className="h-4 w-4 shrink-0" /><span>{msg}</span>
        </div>
      ) : null}

      {confirm ? (
        <Card className="border-primary/40">
          <CardContent className="space-y-3 py-4">
            <p className="text-sm font-medium">
              {confirm.accion === "entregar" && "¿Marcar este certificado como ENTREGADO al cliente?"}
              {confirm.accion === "canjear" && "¿Registrar el CANJE de este certificado? Esta acción no se puede deshacer."}
              {confirm.accion === "anular" && "¿ANULAR este certificado? Indica el motivo (obligatorio)."}
            </p>
            {confirm.needsReason ? (
              <textarea
                className="min-h-[70px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="Motivo de la anulación"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            ) : null}
            <div className="flex gap-2">
              <Button size="sm" onClick={doConfirm} disabled={busy === "transition"}>
                {busy === "transition" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Confirmar
              </Button>
              <Button size="sm" variant="outline" onClick={() => setConfirm(null)} disabled={busy === "transition"}>Cancelar</Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,420px)_1fr]">
        {/* ── Formulario ── */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Datos del certificado</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <Field label="Otorgado a" required>
                <Input value={form.otorgadoA} disabled={!editable} onChange={(e) => set({ otorgadoA: e.target.value })} placeholder="Nombre del beneficiario" />
              </Field>
              <Field label="Cortesía de" required>
                <Input value={form.cortesiaDe} disabled={!editable} onChange={(e) => set({ cortesiaDe: e.target.value })} placeholder="Quien obsequia" />
              </Field>
              <Field label="Válido para" required>
                <Input value={form.validoPara} disabled={!editable} onChange={(e) => set({ validoPara: e.target.value })} placeholder="Servicio (ej. Masaje relajante)" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Fecha de emisión" required>
                  <Input type="date" value={form.fechaEmision} disabled={!editable} onChange={(e) => set({ fechaEmision: e.target.value })} />
                </Field>
                <Field label="Válido hasta" required>
                  <Input type="date" value={form.validoHasta} disabled={!editable} onChange={(e) => set({ validoHasta: e.target.value })} />
                </Field>
              </div>
              {editable ? (
                <div className="flex flex-wrap gap-1.5">
                  <span className="text-xs text-muted-foreground">Vigencia rápida:</span>
                  {[30, 60, 90].map((d) => (
                    <button key={d} type="button" className="rounded border px-2 py-0.5 text-xs hover:bg-muted" onClick={() => set({ validoHasta: addDaysIso(form.fechaEmision, d) })}>
                      {d} días
                    </button>
                  ))}
                </div>
              ) : null}
              <Field label="Sucursal de entrega" required>
                <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-60" value={form.sucursal} disabled={!editable} onChange={(e) => set({ sucursal: e.target.value })}>
                  {sucursales.length === 0 ? <option value="">(sin sucursales)</option> : null}
                  {sucursales.map((s) => <option key={s.nombre} value={s.nombre}>{s.nombre}</option>)}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Teléfono (opcional)">
                  <Input value={form.telefono} disabled={!editable} onChange={(e) => set({ telefono: e.target.value })} />
                </Field>
                <Field label="Correo (opcional)">
                  <Input value={form.correo} disabled={!editable} onChange={(e) => set({ correo: e.target.value })} />
                </Field>
              </div>
              <Field label="Nota interna (opcional)">
                <Input value={form.notaInterna} disabled={!editable} onChange={(e) => set({ notaInterna: e.target.value })} placeholder="No se imprime en el certificado" />
              </Field>
            </CardContent>
          </Card>

        </div>

        {/* ── Preview + acciones ── */}
        <div className="space-y-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
              <CardTitle className="text-base">Previsualización</CardTitle>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setZoom((z) => Math.max(50, z - 15))}><ZoomOut className="h-4 w-4" /></Button>
                <span className="w-12 text-center text-xs text-muted-foreground">{zoom}%</span>
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setZoom((z) => Math.min(160, z + 15))}><ZoomIn className="h-4 w-4" /></Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="max-h-[70vh] overflow-auto rounded-lg bg-slate-100 p-3">
                <div className="mx-auto" style={{ width: `${zoom}%` }}>
                  <div className="overflow-hidden rounded-lg shadow-xl ring-1 ring-black/5">
                    <CertificadoPreview data={previewData} qrDataUri={qrDataUri} />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Acciones */}
          <div className="flex flex-wrap gap-2">
            {editable ? (
              <Button variant="outline" onClick={doSaveDraft} disabled={!!busy}>
                {busy === "save" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Guardar borrador
              </Button>
            ) : null}
            {isDraft ? (
              <Button onClick={doEmit} disabled={!!busy}>
                {busy === "emit" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}Emitir certificado
              </Button>
            ) : null}
            {canExport ? (
              <>
                <Button variant="outline" onClick={doPrint} disabled={!!busy}>
                  {busy === "print" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Printer className="mr-2 h-4 w-4" />}Imprimir certificado
                </Button>
                <Button variant="outline" onClick={() => doDownload("pdf")} disabled={!!busy}>
                  {busy === "pdf" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileDown className="mr-2 h-4 w-4" />}PDF
                </Button>
                <Button variant="outline" onClick={() => doDownload("png")} disabled={!!busy}>
                  {busy === "png" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImageDown className="mr-2 h-4 w-4" />}PNG
                </Button>
                <Button variant="outline" onClick={() => doDownload("jpg")} disabled={!!busy}>
                  {busy === "jpg" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImageDown className="mr-2 h-4 w-4" />}JPG
                </Button>
              </>
            ) : null}
            {stCanDeliver ? (
              <Button variant="outline" onClick={() => askConfirm("entregar", false)} disabled={!!busy}><PackageCheck className="mr-2 h-4 w-4" />Marcar entregado</Button>
            ) : null}
            {stCanRedeem ? (
              <Button variant="outline" onClick={() => askConfirm("canjear", false)} disabled={!!busy}><BadgeCheck className="mr-2 h-4 w-4" />Canjear</Button>
            ) : null}
            {stCanVoid ? (
              <Button variant="outline" className="text-rose-700 hover:text-rose-800" onClick={() => askConfirm("anular", true)} disabled={!!busy}><Ban className="mr-2 h-4 w-4" />Anular</Button>
            ) : null}
            {form.codigo ? (
              <Button
                variant="ghost"
                onClick={() =>
                  run("dup", async () => {
                    const rec = await gc.duplicate(form.codigo)
                    onChanged(rec)
                    setForm(toForm(rec, sucursales))
                    flash(`Duplicado como ${rec.codigo}`)
                  })
                }
                disabled={!!busy}
              >
                {busy === "dup" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Copy className="mr-2 h-4 w-4" />}Duplicar como nuevo
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">
        {label} {required ? <span className="text-rose-500">*</span> : null}
      </Label>
      {children}
    </div>
  )
}
