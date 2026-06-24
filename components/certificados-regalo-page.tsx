"use client"

import { useEffect, useMemo, useState } from "react"
import { PDFDocument, StandardFonts, rgb } from "pdf-lib"
import { ArrowUpDown, Download, FileSpreadsheet, FileText, Gift, RotateCcw, Search, ShieldCheck, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { apiJsonp, useAppStore } from "@/lib/store"
import { usePagination } from "@/lib/use-pagination"
import { DataPagination } from "@/components/ui/data-pagination"
import { loadXLSX } from "@/lib/load-xlsx"
import {
  CERTIFICADOS_REGALO_STORAGE_KEY,
  CertificadoRegaloData,
  CertificadoRegaloEmitido,
  certificateSignature,
  certificateValidationUrl,
  createCertificateCode,
  normalizeCertificateText,
} from "@/lib/certificado-regalo"

type SortKey = "fecha" | "otorgadoA" | "cortesiaDe" | "validoPor" | "sucursal" | "tipo" | "codigo"
type SortDirection = "asc" | "desc"

const today = new Date().toISOString().slice(0, 10)
const meses = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]
const fallbackSucursales = ["Rafael Vidal", "Los Jardines", "Villa Olga", "La Vega"]

function dateParts(value: string) {
  const date = value ? new Date(`${value}T12:00:00`) : new Date()
  if (Number.isNaN(date.getTime())) return { dia: "", mes: "", ano: "" }
  return { dia: String(date.getDate()), mes: meses[date.getMonth()], ano: String(date.getFullYear()) }
}

function centeredX(text: string, center: number, size: number, font: { widthOfTextAtSize: (text: string, size: number) => number }) {
  return center - font.widthOfTextAtSize(text, size) / 2
}

function downloadBytes(bytes: Uint8Array, filename: string) {
  const blob = new Blob([bytes], { type: "application/pdf" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function filenameFor(data: CertificadoRegaloData) {
  const name = normalizeCertificateText(data.otorgadoA || data.codigo).replace(/[^\w-]+/g, "_").slice(0, 40)
  return `CF_Regalo_${name || data.codigo}.pdf`
}

function readRecords(): CertificadoRegaloEmitido[] {
  try {
    const saved = JSON.parse(localStorage.getItem(CERTIFICADOS_REGALO_STORAGE_KEY) || "[]")
    if (!Array.isArray(saved)) return []
    return saved.map((item) => ({
      ...item,
      sucursal: item.sucursal || "",
      tipo: item.tipo || "Digital",
      firma: item.firma || certificateSignature(item),
      emitidoEn: item.emitidoEn || new Date().toISOString(),
      estado: item.estado || "Emitido",
      canjeadoEn: item.canjeadoEn || "",
      notasEstado: item.notasEstado || "",
    }))
  } catch {
    return []
  }
}

function saveRecords(records: CertificadoRegaloEmitido[]) {
  localStorage.setItem(CERTIFICADOS_REGALO_STORAGE_KEY, JSON.stringify(records))
}

export function CertificadosRegaloPage() {
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
  const [records, setRecords] = useState<CertificadoRegaloEmitido[]>([])
  const [searchTerm, setSearchTerm] = useState("")
  const [sortKey, setSortKey] = useState<SortKey>("fecha")
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc")
  const [isGenerating, setIsGenerating] = useState(false)

  useEffect(() => {
    let cancelled = false
    const loadRecords = async () => {
      const localRecords = readRecords()
      try {
        const result = await apiJsonp(apiUrl, { action: "getCertificadosRegalo" })
        const serverRecords = Array.isArray(result.records) ? (result.records as CertificadoRegaloEmitido[]) : []
        if (cancelled) return
        const merged = [
          ...serverRecords,
          ...localRecords.filter((local) => !serverRecords.some((server) => server.codigo === local.codigo)),
        ]
        setRecords(merged)
        saveRecords(merged)
        for (const local of localRecords) {
          if (!serverRecords.some((server) => server.codigo === local.codigo)) {
            void apiJsonp(apiUrl, { action: "saveCertificadoRegalo", data: JSON.stringify(local) }).catch(() => undefined)
          }
        }
      } catch {
        if (!cancelled) setRecords(localRecords)
      }
    }
    void loadRecords()
    return () => {
      cancelled = true
    }
  }, [apiUrl])

  useEffect(() => {
    if (!form.sucursal && sucursales[0]) setForm((current) => ({ ...current, sucursal: sucursales[0] }))
  }, [form.sucursal, sucursales])

  const signature = certificateSignature(form)
  const validationUrl = useMemo(() => {
    if (typeof window === "undefined") return ""
    return certificateValidationUrl(window.location.origin, form)
  }, [form])

  const filteredRecords = useMemo(() => {
    const term = searchTerm.trim().toLowerCase()
    const rows = term
      ? records.filter((record) =>
          [record.fecha, record.otorgadoA, record.cortesiaDe, record.validoPor, record.sucursal, record.tipo, record.codigo]
            .join(" ")
            .toLowerCase()
            .includes(term)
        )
      : records
    return [...rows].sort((left, right) => {
      const leftValue = String(left[sortKey] || "")
      const rightValue = String(right[sortKey] || "")
      const result = leftValue.localeCompare(rightValue, "es", { numeric: true, sensitivity: "base" })
      return sortDirection === "asc" ? result : -result
    })
  }, [records, searchTerm, sortDirection, sortKey])

  const pag = usePagination(filteredRecords, {
    initialPageSize: 50,
    resetKey: `${searchTerm}|${sortKey}|${sortDirection}`,
  })

  const update = (patch: Partial<CertificadoRegaloData>) => setForm((current) => ({ ...current, ...patch }))
  const resetCode = () => update({ codigo: createCertificateCode() })
  const changeSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"))
      return
    }
    setSortKey(key)
    setSortDirection("asc")
  }

  const saveRecord = (data: CertificadoRegaloData) => {
    const record: CertificadoRegaloEmitido = {
      ...data,
      tipo: "Digital",
      estado: "Emitido",
      firma: certificateSignature(data),
      emitidoEn: new Date().toISOString(),
      sucursal: data.sucursal || "",
    }
    setRecords((current) => {
      const next = [record, ...current.filter((item) => item.codigo !== record.codigo)]
      saveRecords(next)
      void apiJsonp(apiUrl, { action: "saveCertificadoRegalo", data: JSON.stringify(record) }).catch(() => undefined)
      return next
    })
  }

  const createPdf = async (data: CertificadoRegaloData) => {
    const bytes = await fetch("/certificados/certificado-regalo-digital.pdf", { cache: "no-store" }).then((response) => response.arrayBuffer())
    const pdf = await PDFDocument.load(bytes)
    const page = pdf.getPages()[0]
    const font = await pdf.embedFont(StandardFonts.TimesRomanBold)
    const smallFont = await pdf.embedFont(StandardFonts.HelveticaBold)
    const black = rgb(0.05, 0.05, 0.05)
    const parts = dateParts(data.fecha)
    const drawCentered = (text: string, center: number, y: number, size: number) => {
      const clean = normalizeCertificateText(text)
      page.drawText(clean, { x: centeredX(clean, center, size, font), y, size, font, color: black })
    }

    drawCentered(data.otorgadoA, 463, 236, 20)
    drawCentered(data.cortesiaDe, 463, 195, 19)
    drawCentered(data.validoPor, 441, 141, 19)
    drawCentered(parts.dia, 103, 43, 18)
    drawCentered(parts.mes, 311, 43, 16)
    drawCentered(parts.ano, 489, 43, 18)

    const url = certificateValidationUrl(window.location.origin, data)
    try {
      const qrBytes = await fetch(`https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(url)}`).then((response) => response.arrayBuffer())
      const qr = await pdf.embedPng(qrBytes)
      page.drawImage(qr, { x: 694, y: 22, width: 58, height: 58 })
    } catch {}
    page.drawText(data.codigo, { x: 670, y: 12, size: 7, font: smallFont, color: black })

    return pdf.save()
  }

  const downloadPdf = async (data: CertificadoRegaloData = form, shouldSave = true) => {
    if (!data.otorgadoA || !data.cortesiaDe || !data.validoPor || !data.fecha) return
    setIsGenerating(true)
    try {
      const pdfBytes = await createPdf(data)
      downloadBytes(pdfBytes, filenameFor(data))
      if (shouldSave) saveRecord(data)
    } finally {
      setIsGenerating(false)
    }
  }

  const deleteRecord = (codigo: string) => {
    const next = records.filter((record) => record.codigo !== codigo)
    setRecords(next)
    saveRecords(next)
    void apiJsonp(apiUrl, { action: "deleteCertificadoRegalo", codigo }).catch(() => undefined)
  }

  const exportExcel = async () => {
    let XLSX: any
    try {
      XLSX = await loadXLSX()
    } catch {
      alert("No se pudo cargar la librería Excel. Revisa tu conexión.")
      return
    }
    const rows = filteredRecords.map((record) => ({
      Fecha: record.fecha,
      Tipo: record.tipo,
      Estado: record.estado || "Emitido",
      Sucursal: record.sucursal || "",
      "Otorgado a": record.otorgadoA,
      "Cortesia de": record.cortesiaDe,
      "Valido por": record.validoPor,
      Codigo: record.codigo,
      Firma: record.firma,
      "Canjeado en": record.canjeadoEn || "",
      Notas: record.notasEstado || "",
      "Emitido en": record.emitidoEn,
    }))
    const workbook = XLSX.utils.book_new()
    const sheet = XLSX.utils.json_to_sheet(rows)
    XLSX.utils.book_append_sheet(workbook, sheet, "Certificados")
    XLSX.writeFile(workbook, `Certificados_Regalo_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  const SortHeader = ({ label, field }: { label: string; field: SortKey }) => (
    <Button type="button" variant="ghost" size="sm" className="h-auto px-0 font-semibold hover:bg-transparent" onClick={() => changeSort(field)}>
      {label} <ArrowUpDown className="ml-1 h-3 w-3" />
    </Button>
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold"><Gift className="h-5 w-5 text-primary" />CF Regalo Digital</h2>
          <p className="text-sm text-muted-foreground">Completa el certificado y descarga el PDF listo para enviar al cliente.</p>
        </div>
        <Button onClick={() => downloadPdf()} disabled={isGenerating || !form.otorgadoA || !form.cortesiaDe || !form.validoPor}>
          <Download className="mr-2 h-4 w-4" />{isGenerating ? "Generando..." : "Descargar PDF"}
        </Button>
      </div>

      <Card>
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
          <div className="space-y-1.5 md:col-span-2">
            <Label>Codigo de validacion</Label>
            <div className="flex gap-2">
              <Input value={form.codigo} onChange={(event) => update({ codigo: event.target.value.toUpperCase() })} />
              <Button type="button" variant="outline" onClick={resetCode}><RotateCcw className="h-4 w-4" /></Button>
            </div>
          </div>
          <div className="space-y-1.5 md:col-span-3">
            <Label>Validacion QR</Label>
            <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3 text-sm">
              <ShieldCheck className="h-5 w-5 text-primary" />
              <span>Firma: <b>{signature}</b></span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <CardTitle className="flex items-center gap-2 text-base"><FileText className="h-4 w-4" />Certificados emitidos</CardTitle>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input className="pl-9 sm:w-80" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Buscar por cliente, sucursal, codigo..." />
              </div>
              <Button type="button" variant="outline" onClick={exportExcel}>
                <FileSpreadsheet className="mr-2 h-4 w-4" />Excel
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b bg-muted/30">
                <th className="px-3 py-2 text-left"><SortHeader label="Fecha" field="fecha" /></th>
                <th className="px-3 py-2 text-left"><SortHeader label="Tipo" field="tipo" /></th>
                <th className="px-3 py-2 text-left"><SortHeader label="Sucursal" field="sucursal" /></th>
                <th className="px-3 py-2 text-left"><SortHeader label="Otorgado a" field="otorgadoA" /></th>
                <th className="px-3 py-2 text-left"><SortHeader label="Cortesia de" field="cortesiaDe" /></th>
                <th className="px-3 py-2 text-left"><SortHeader label="Valido por" field="validoPor" /></th>
                <th className="px-3 py-2 text-left"><SortHeader label="Codigo" field="codigo" /></th>
                <th className="px-3 py-2 text-right">Acciones</th>
              </tr></thead>
              <tbody>
                {filteredRecords.length ? pag.pageItems.map((record) => (
                  <tr key={record.codigo} className="border-b">
                    <td className="px-3 py-2">{record.fecha}</td>
                    <td className="px-3 py-2">{record.tipo}</td>
                    <td className="px-3 py-2">{record.sucursal || "-"}</td>
                    <td className="px-3 py-2 font-medium">{record.otorgadoA}</td>
                    <td className="px-3 py-2">{record.cortesiaDe}</td>
                    <td className="px-3 py-2">{record.validoPor}</td>
                    <td className="px-3 py-2 font-mono text-xs">{record.codigo}</td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        {record.tipo === "Digital" ? (
                          <Button size="sm" variant="outline" onClick={() => downloadPdf(record, false)}><Download className="mr-2 h-3.5 w-3.5" />PDF</Button>
                        ) : null}
                        <Button size="icon" variant="ghost" onClick={() => deleteRecord(record.codigo)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                      </div>
                    </td>
                  </tr>
                )) : (
                  <tr><td className="px-3 py-10 text-center text-muted-foreground" colSpan={8}>No hay certificados emitidos todavia.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <DataPagination
            page={pag.page}
            totalPages={pag.totalPages}
            total={pag.total}
            from={pag.from}
            to={pag.to}
            pageSize={pag.pageSize}
            onPage={pag.setPage}
            onPageSize={pag.setPageSize}
            label="certificados"
          />
        </CardContent>
      </Card>
      <div className="hidden text-xs">{validationUrl}</div>
    </div>
  )
}
