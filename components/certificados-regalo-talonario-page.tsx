"use client"

import { useEffect, useMemo, useState } from "react"
import { PDFDocument, StandardFonts, rgb } from "pdf-lib"
import { Gift, Printer, RotateCcw, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { apiJsonp, useAppStore } from "@/lib/store"
import {
  CERTIFICADOS_REGALO_STORAGE_KEY,
  CertificadoRegaloData,
  CertificadoRegaloEmitido,
  certificateSignature,
  certificateValidationUrl,
  createCertificateCode,
  normalizeCertificateText,
} from "@/lib/certificado-regalo"

const today = new Date().toISOString().slice(0, 10)
const meses = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]
const fallbackSucursales = ["Rafael Vidal", "Los Jardines", "Villa Olga", "La Vega"]
const printPage = { width: 936, height: 612 }
const certificateArea = { width: 581.1, height: 368.5, x: 0, y: 612 - 368.5 }
const printBlack = rgb(0, 0, 0)
const CALIBRATION_KEY = "csl_cf_regalo_print_calibration_v1"

type PrintCalibration = {
  offsetX: number
  offsetY: number
  scale: number
  fontSize: number
  qrOffsetX: number
  qrOffsetY: number
  diaX: number
  diaY: number
  mesX: number
  mesY: number
  anoX: number
  anoY: number
}

const defaultCalibration: PrintCalibration = {
  offsetX: 0,
  offsetY: 0,
  scale: 1,
  fontSize: 10,
  qrOffsetX: 0,
  qrOffsetY: 0,
  diaX: 86,
  diaY: 52,
  mesX: 308,
  mesY: 52,
  anoX: 478,
  anoY: 52,
}

function dateParts(value: string) {
  const date = value ? new Date(`${value}T12:00:00`) : new Date()
  if (Number.isNaN(date.getTime())) return { dia: "", mes: "", ano: "" }
  return {
    dia: String(date.getDate()).padStart(2, "0"),
    mes: meses[date.getMonth()],
    ano: String(date.getFullYear()),
  }
}

export function CertificadosRegaloTalonarioPage() {
  const sucursalesDb = useAppStore((state) => state.db.sucursales)
  const apiUrl = useAppStore((state) => state.apiUrl)
  const sucursales = sucursalesDb.length ? sucursalesDb.map((sucursal) => sucursal.Nombre).filter(Boolean) : fallbackSucursales
  const [form, setForm] = useState<CertificadoRegaloData>({
    codigo: createCertificateCode(),
    otorgadoA: "",
    cortesiaDe: "",
    validoPor: "",
    fecha: today,
    sucursal: sucursales[0] || "",
  })
  const [isPrinting, setIsPrinting] = useState(false)
  const [calibration, setCalibration] = useState<PrintCalibration>(defaultCalibration)
  const [showCalibration, setShowCalibration] = useState(false)

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(CALIBRATION_KEY) || "{}")
      setCalibration({ ...defaultCalibration, ...saved })
    } catch {}
  }, [])

  useEffect(() => {
    if (!form.sucursal && sucursales[0]) setForm((current) => ({ ...current, sucursal: sucursales[0] }))
  }, [form.sucursal, sucursales])

  const parts = dateParts(form.fecha)
  const signature = certificateSignature(form)
  const validationUrl = useMemo(() => {
    if (typeof window === "undefined") return ""
    return certificateValidationUrl(window.location.origin, form)
  }, [form])
  const qrUrl = validationUrl ? `https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(validationUrl)}` : ""

  const update = (patch: Partial<CertificadoRegaloData>) => setForm((current) => ({ ...current, ...patch }))
  const updateCalibration = (patch: Partial<PrintCalibration>) => {
    setCalibration((current) => {
      const next = { ...current, ...patch }
      localStorage.setItem(CALIBRATION_KEY, JSON.stringify(next))
      return next
    })
  }
  const resetCalibration = () => updateCalibration(defaultCalibration)
  const resetCode = () => update({ codigo: createCertificateCode() })
  const savePrintRecord = () => {
    if (!form.otorgadoA || !form.cortesiaDe || !form.validoPor || !form.fecha) return
    try {
      const saved = JSON.parse(localStorage.getItem(CERTIFICADOS_REGALO_STORAGE_KEY) || "[]")
      const current: CertificadoRegaloEmitido[] = Array.isArray(saved) ? saved : []
      const record: CertificadoRegaloEmitido = {
        ...form,
        tipo: "Talonario pre-impreso",
        estado: "Emitido",
        firma: certificateSignature(form),
        emitidoEn: new Date().toISOString(),
        sucursal: form.sucursal || "",
      }
      const next = [record, ...current.filter((item) => item.codigo !== record.codigo)]
      localStorage.setItem(CERTIFICADOS_REGALO_STORAGE_KEY, JSON.stringify(next))
      void apiJsonp(apiUrl, { action: "saveCertificadoRegalo", data: JSON.stringify(record) }).catch(() => undefined)
    } catch {}
  }

  const createPrintPdf = async () => {
    const pdf = await PDFDocument.create()
    const page = pdf.addPage([printPage.width, printPage.height])
    const font = await pdf.embedFont(StandardFonts.HelveticaBold)
    const drawValue = (value: string, x: number, y: number, size = calibration.fontSize) => {
      page.drawText(normalizeCertificateText(value), {
        x: (certificateArea.x + x) * calibration.scale + calibration.offsetX,
        y: (certificateArea.y + y) * calibration.scale + calibration.offsetY,
        size,
        font,
        color: printBlack,
      })
    }

    drawValue(form.otorgadoA, 252, 188)
    drawValue(form.cortesiaDe, 252, 153)
    drawValue(form.validoPor, 252, 118)
    drawValue(parts.dia, calibration.diaX, calibration.diaY)
    drawValue(parts.mes, calibration.mesX, calibration.mesY)
    drawValue(parts.ano, calibration.anoX, calibration.anoY)

    if (validationUrl) {
      try {
        const qrBytes = await fetch(`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(validationUrl)}`).then((response) => response.arrayBuffer())
        const qr = await pdf.embedPng(qrBytes)
        page.drawImage(qr, { x: certificateArea.x + certificateArea.width - 70 + calibration.qrOffsetX, y: certificateArea.y + 22 + calibration.qrOffsetY, width: 58, height: 58 })
        page.drawText(form.codigo, { x: certificateArea.x + certificateArea.width - 78 + calibration.qrOffsetX, y: certificateArea.y + 14 + calibration.qrOffsetY, size: 4.5, font, color: printBlack })
      } catch {}
    }

    return pdf.save()
  }

  const createCalibrationPdf = async () => {
    const pdf = await PDFDocument.create()
    const page = pdf.addPage([printPage.width, printPage.height])
    const font = await pdf.embedFont(StandardFonts.HelveticaBold)
    const point = (x: number, y: number) => ({
      x: (certificateArea.x + x) * calibration.scale + calibration.offsetX,
      y: (certificateArea.y + y) * calibration.scale + calibration.offsetY,
    })
    const drawMark = (label: string, x: number, y: number) => {
      const mark = point(x, y)
      page.drawLine({ start: { x: mark.x - 8, y: mark.y }, end: { x: mark.x + 8, y: mark.y }, thickness: 0.8, color: printBlack })
      page.drawLine({ start: { x: mark.x, y: mark.y - 8 }, end: { x: mark.x, y: mark.y + 8 }, thickness: 0.8, color: printBlack })
      page.drawText(label, { x: mark.x + 10, y: mark.y - 3, size: 7, font, color: printBlack })
    }

    page.drawText("PRUEBA DE ALINEACION - 8.5 x 13 in / 100%", {
      x: certificateArea.x + 20,
      y: certificateArea.y + certificateArea.height - 20,
      size: 8,
      font,
      color: printBlack,
    })
    drawMark("OTORGADO A", 252, 188)
    drawMark("CORTESIA DE", 252, 153)
    drawMark("VALIDO POR", 252, 118)
    drawMark("DIA", calibration.diaX, calibration.diaY)
    drawMark("MES", calibration.mesX, calibration.mesY)
    drawMark("ANO", calibration.anoX, calibration.anoY)
    drawMark("QR", certificateArea.width - 41, 51)

    return pdf.save()
  }

  const printPdfBytes = (bytes: Uint8Array) => {
    const blob = new Blob([bytes], { type: "application/pdf" })
    const url = URL.createObjectURL(blob)
    const printWindow = window.open(url, "_blank")
    if (!printWindow) {
      const link = document.createElement("a")
      link.href = url
      link.download = `${form.codigo}.pdf`
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 30000)
      return
    }
    setTimeout(() => {
      printWindow.focus()
      printWindow.print()
      setTimeout(() => URL.revokeObjectURL(url), 30000)
    }, 900)
  }

  const handlePrint = async () => {
    setIsPrinting(true)
    savePrintRecord()
    try {
      const pdfBytes = await createPrintPdf()
      printPdfBytes(pdfBytes)
    } finally {
      setIsPrinting(false)
    }
  }

  const handleCalibrationPrint = async () => {
    setIsPrinting(true)
    try {
      const pdfBytes = await createCalibrationPdf()
      printPdfBytes(pdfBytes)
    } finally {
      setIsPrinting(false)
    }
  }

  return (
    <div className="space-y-6">
      <style>{`
        .cf-print-sheet{position:relative;width:9.78in;height:6.3in;margin:0 auto;background:white;overflow:hidden}
        .cf-guide{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
        .cf-field{position:absolute;display:flex;align-items:flex-end;justify-content:center;height:0.28in;font-family:"Times New Roman",serif;font-weight:700;color:#111;text-align:center;white-space:nowrap;overflow:hidden;line-height:1}
        .cf-otorgado{left:31.6%;top:51.4%;width:52.3%;font-size:0.21in}
        .cf-cortesia{left:31.2%;top:59.6%;width:53%;font-size:0.2in}
        .cf-valido{left:33.6%;top:69.5%;width:44%;font-size:0.2in}
        .cf-date{top:88.6%;height:0.24in}
        .cf-dia{left:7.7%;width:7.2%;font-size:0.18in}
        .cf-mes{left:32.7%;width:11.6%;font-size:0.17in}
        .cf-ano{left:55.2%;width:8.2%;font-size:0.18in}
        .cf-code{position:absolute;right:0.18in;bottom:0.12in;font:700 0.08in Arial;color:#111;text-align:center}
        .cf-qr{display:block;width:0.9in;height:0.9in;margin:0 auto 0.03in}
        @media print{
          @page{size:9.78in 6.3in;margin:0}
          body *{visibility:hidden!important}
          .print-area,.print-area *{visibility:visible!important}
          .print-area{position:fixed!important;inset:0!important;margin:0!important;padding:0!important;border:0!important;background:white!important}
          .cf-print-sheet{margin:0!important;box-shadow:none!important}
          .cf-guide{display:none!important}
          .no-print{display:none!important}
        }
      `}</style>

      <div className="no-print flex items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold"><Gift className="h-5 w-5 text-primary" />CF de Regalos Talonario Pre-impreso</h2>
          <p className="text-sm text-muted-foreground">Coloca el talonario pre-impreso en la impresora. Se imprimen solo valores, fecha y QR.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowCalibration((value) => !value)}>Calibrar impresiÃ³n</Button>
          <Button variant="outline" onClick={handleCalibrationPrint} disabled={isPrinting}>Imprimir prueba</Button>
          <Button onClick={handlePrint} disabled={isPrinting || !form.otorgadoA || !form.cortesiaDe || !form.validoPor}><Printer className="mr-2 h-4 w-4" />{isPrinting ? "Preparando..." : "Imprimir campos"}</Button>
        </div>
      </div>

      <Card className="no-print">
        <CardHeader><CardTitle className="text-base">Datos del certificado</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
          <div className="space-y-1.5">
            <Label>Otorgado a</Label>
            <Input value={form.otorgadoA} onChange={(event) => update({ otorgadoA: event.target.value })} placeholder="Nombre del cliente" />
          </div>
          <div className="space-y-1.5">
            <Label>Cortesia de</Label>
            <Input value={form.cortesiaDe} onChange={(event) => update({ cortesiaDe: event.target.value })} placeholder="Nombre de quien regala" />
          </div>
          <div className="space-y-1.5">
            <Label>Valido por</Label>
            <Input value={form.validoPor} onChange={(event) => update({ validoPor: event.target.value })} placeholder="Servicio o monto" />
          </div>
          <div className="space-y-1.5">
            <Label>Sucursal</Label>
            <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.sucursal || ""} onChange={(event) => update({ sucursal: event.target.value })}>
              {sucursales.map((sucursal) => <option key={sucursal} value={sucursal}>{sucursal}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Fecha</Label>
            <Input type="date" value={form.fecha} onChange={(event) => update({ fecha: event.target.value })} />
          </div>
          <div className="space-y-1.5 md:col-span-3">
            <Label>Codigo de validacion</Label>
            <div className="flex gap-2">
              <Input value={form.codigo} onChange={(event) => update({ codigo: event.target.value.toUpperCase() })} />
              <Button type="button" variant="outline" onClick={resetCode}><RotateCcw className="h-4 w-4" /></Button>
            </div>
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label>Validacion QR</Label>
            <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3 text-sm">
              <ShieldCheck className="h-5 w-5 text-primary" />
              <span>Firma: <b>{signature}</b></span>
            </div>
          </div>
        </CardContent>
      </Card>

      {showCalibration ? (
        <Card className="no-print border-primary/40">
          <CardHeader><CardTitle className="text-base">CalibraciÃ³n de impresiÃ³n</CardTitle></CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
            <div className="space-y-1.5">
              <Label>Mover X pt</Label>
              <Input type="number" step="0.5" value={calibration.offsetX} onChange={(event) => updateCalibration({ offsetX: Number(event.target.value) || 0 })} />
            </div>
            <div className="space-y-1.5">
              <Label>Mover Y pt</Label>
              <Input type="number" step="0.5" value={calibration.offsetY} onChange={(event) => updateCalibration({ offsetY: Number(event.target.value) || 0 })} />
            </div>
            <div className="space-y-1.5">
              <Label>Escala</Label>
              <Input type="number" step="0.001" value={calibration.scale} onChange={(event) => updateCalibration({ scale: Number(event.target.value) || 1 })} />
            </div>
            <div className="space-y-1.5">
              <Label>Letra pt</Label>
              <Input type="number" step="0.5" value={calibration.fontSize} onChange={(event) => updateCalibration({ fontSize: Number(event.target.value) || 10 })} />
            </div>
            <div className="space-y-1.5">
              <Label>QR X pt</Label>
              <Input type="number" step="0.5" value={calibration.qrOffsetX} onChange={(event) => updateCalibration({ qrOffsetX: Number(event.target.value) || 0 })} />
            </div>
            <div className="space-y-1.5">
              <Label>QR Y pt</Label>
              <Input type="number" step="0.5" value={calibration.qrOffsetY} onChange={(event) => updateCalibration({ qrOffsetY: Number(event.target.value) || 0 })} />
            </div>
            <div className="space-y-1.5">
              <Label>DÃ­a X</Label>
              <Input type="number" step="0.5" value={calibration.diaX} onChange={(event) => updateCalibration({ diaX: Number(event.target.value) || 0 })} />
            </div>
            <div className="space-y-1.5">
              <Label>DÃ­a Y</Label>
              <Input type="number" step="0.5" value={calibration.diaY} onChange={(event) => updateCalibration({ diaY: Number(event.target.value) || 0 })} />
            </div>
            <div className="space-y-1.5">
              <Label>Mes X</Label>
              <Input type="number" step="0.5" value={calibration.mesX} onChange={(event) => updateCalibration({ mesX: Number(event.target.value) || 0 })} />
            </div>
            <div className="space-y-1.5">
              <Label>Mes Y</Label>
              <Input type="number" step="0.5" value={calibration.mesY} onChange={(event) => updateCalibration({ mesY: Number(event.target.value) || 0 })} />
            </div>
            <div className="space-y-1.5">
              <Label>AÃ±o X</Label>
              <Input type="number" step="0.5" value={calibration.anoX} onChange={(event) => updateCalibration({ anoX: Number(event.target.value) || 0 })} />
            </div>
            <div className="space-y-1.5">
              <Label>AÃ±o Y</Label>
              <Input type="number" step="0.5" value={calibration.anoY} onChange={(event) => updateCalibration({ anoY: Number(event.target.value) || 0 })} />
            </div>
            <div className="md:col-span-3 lg:col-span-6 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Button type="button" variant="outline" size="sm" onClick={resetCalibration}>Restablecer</Button>
              <span>Fecha base: Día 86/52, Mes 308/52, Año 478/52. Si sale muy a la derecha usa X negativo. Si sale muy abajo usa Y positivo.</span>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="print-area rounded-xl border bg-muted/20 p-4">
        <div className="cf-print-sheet shadow-2xl">
          <img className="cf-guide" src="/certificados/certificado-regalo.jpg" alt="Guia del certificado" />
          <div className="cf-field cf-otorgado">{normalizeCertificateText(form.otorgadoA)}</div>
          <div className="cf-field cf-cortesia">{normalizeCertificateText(form.cortesiaDe)}</div>
          <div className="cf-field cf-valido">{normalizeCertificateText(form.validoPor)}</div>
          <div className="cf-field cf-date cf-dia">{parts.dia}</div>
          <div className="cf-field cf-date cf-mes">{parts.mes}</div>
          <div className="cf-field cf-date cf-ano">{parts.ano}</div>
          <div className="cf-code">
            {qrUrl ? <img className="cf-qr" src={qrUrl} alt="QR de validacion" /> : null}
            {form.codigo}
          </div>
        </div>
      </div>
    </div>
  )
}

