"use client"

import { useMemo, useState } from "react"
import { useAppStore, apiJsonp, normalizeApiUrl } from "@/lib/store"
import { loadXLSX } from "@/lib/load-xlsx"
import { scanPulseScreen } from "@/lib/pulse-vision"
import { SEQ_HEADER_CLASS, SeqBadge } from "@/components/seq-badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Plus, Save, X, BookOpen, Camera, ChevronDown, ChevronRight, Loader2, Upload, FileSpreadsheet } from "lucide-react"
import { RecordActions } from "@/components/record-actions"
import type { LecturaSemanal } from "@/lib/types"

const today = new Date().toISOString().split("T")[0]

const empty: LecturaSemanal = {
  LecturaID: "", FechaSemana: today, EquipoID: "", Sucursal: "",
  Cabina: "", OperadoraID: "", LecturaInicial: 0, LecturaFinal: 0,
  DiferenciaReal: 0, Observaciones: "",
}

function fmt(d: string) {
  if (!d) return "-"
  try {
    // Handle ISO strings, date objects converted to string, etc.
    const clean = String(d).split("T")[0].trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) return d
    return new Date(clean + "T12:00:00").toLocaleDateString("es-DO", { day: "2-digit", month: "short", year: "numeric" })
  } catch { return d }
}

function fmtSemanaRango(d: string) {
  if (!d) return "-"
  try {
    const clean = String(d).split("T")[0].trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) return d
    const start = new Date(clean + "T12:00:00")
    const end = new Date(start)
    end.setDate(end.getDate() + 6)
    const startText = start.toLocaleDateString("es-DO", { day: "2-digit", month: "short" })
    const endText = end.toLocaleDateString("es-DO", { day: "2-digit", month: "short", year: "numeric" })
    return `Del ${startText} al ${endText}`
  } catch { return d }
}

function excelDate(value: unknown) {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === "number") return new Date((value - 25569) * 86400000).toISOString().slice(0, 10)
  const text = String(value || "").trim()
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const local = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/)
  if (local) return `${local[3]}-${local[2].padStart(2, "0")}-${local[1].padStart(2, "0")}`
  return text
}

function excelNumber(value: unknown) {
  const parsed = Number(String(value ?? 0).replace(/[^\d.-]/g, ""))
  return Number.isFinite(parsed) ? parsed : 0
}

function rowValue(record: Record<string, unknown>, aliases: string[]) {
  for (const alias of aliases) {
    const value = record[alias.toLowerCase()]
    if (value !== undefined && value !== null && String(value).trim() !== "") return value
  }
  return ""
}

export function PulsosLecturasPage() {
  const { db, dbPulsos, setDbPulsos, apiUrl, showToast } = useAppStore()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<LecturaSemanal>(empty)
  const [isEditing, setIsEditing] = useState(false)
  const [saving, setSaving] = useState(false)

  const [scanning, setScanning] = useState(false)
  const [sortCol, setSortCol] = useState<string>("")
  const [sortDir, setSortDir] = useState<"asc"|"desc">("asc")
  const handleSort = (col: string) => {
    if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc")
    else { setSortCol(col); setSortDir("asc") }
  }
  const sortIcon = (col: string) => {
    if (sortCol !== col) return <span className="text-muted-foreground/30 ml-1">⇅</span>
    return <span className="ml-1 text-primary">{sortDir === "asc" ? "↑" : "↓"}</span>
  }
  const diferencia = (Number(form.LecturaFinal) || 0) - (Number(form.LecturaInicial) || 0)

  const handleScanPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setScanning(true)
    try {
      // OCR centralizado en lib/pulse-vision.ts — mismo helper que usa el
      // wizard "Cuadre semanal".
      const reading = await scanPulseScreen(file)
      if (reading.totalPulses !== null) {
        setForm((prev) => ({ ...prev, LecturaFinal: reading.totalPulses as number }))
        showToast(`✓ Pulsos extraídos: ${reading.totalPulses.toLocaleString("es-DO")}${reading.serial ? ` — Serial: ${reading.serial}` : ""}`, "success")
      } else {
        showToast("No se pudo leer la pantalla. Ingresa el número manualmente.", "error")
      }
    } catch {
      showToast("Error al procesar la imagen", "error")
    } finally {
      setScanning(false)
      e.target.value = ""
    }
  }

  const openNew = () => { setForm({ ...empty }); setIsEditing(false); setOpen(true) }
  const openEdit = (l: LecturaSemanal) => { setForm({ ...l }); setIsEditing(true); setOpen(true) }

  const syncApi = async (params: Record<string, string>) => {
    const normalized = normalizeApiUrl(apiUrl)
    if (!normalized) return
    try { await apiJsonp(normalized, params) } catch(e) { console.warn(e) }
  }

  const handleSave = async () => {
    if (!form.EquipoID || !form.Sucursal) { showToast("Equipo y sucursal son obligatorios", "error"); return }
    if (diferencia < 0) { showToast("Lectura final no puede ser menor que la inicial", "error"); return }

    const record: LecturaSemanal = { ...form, LecturaID: form.LecturaID || `lec_${Date.now()}`, DiferenciaReal: diferencia }

    // Guardar local primero
    if (isEditing) {
      setDbPulsos({ ...dbPulsos, lecturasSemanales: sortedLecturas.map(l => l.LecturaID === record.LecturaID ? record : l) })
    } else {
      setDbPulsos({ ...dbPulsos, lecturasSemanales: [...dbPulsos.lecturasSemanales, record] })
    }
    showToast(isEditing ? "Lectura actualizada" : "Lectura registrada", "success")
    setOpen(false)

    // Sync API
    await syncApi({
      action: isEditing ? "updateLectura" : "addLectura",
      data: JSON.stringify(record),
    })
  }

  const handleDelete = async (l: LecturaSemanal) => {
    if (!confirm(`¿Eliminar lectura del ${fmtSemanaRango(l.FechaSemana)}?`)) return
    setDbPulsos({ ...dbPulsos, lecturasSemanales: dbPulsos.lecturasSemanales.filter(x => x.LecturaID !== l.LecturaID) })
    showToast("Lectura eliminada", "success")
    await syncApi({ action: "deleteLectura", id: l.LecturaID })
  }

  const downloadTemplate = async () => {
    let XLSX: any
    try {
      XLSX = await loadXLSX()
    } catch {
      showToast("No se pudo cargar la librería Excel. Revisa tu conexión.", "error")
      return
    }
    const headers = ["FechaSemana","EquipoID","Sucursal","Cabina","OperadoraID","LecturaInicial","LecturaFinal","Observaciones"]
    const rows = [
      ["2026-04-25","7","Rafael Vidal","Cabina 1","Diana","125000","128500","Semana del 25 abr de 2026"],
      ["2026-04-25","9","Los Jardines","Cabina 4","YAMILKA","90000","92450",""],
    ]
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
    XLSX.utils.book_append_sheet(wb, ws, "Lecturas")
    XLSX.writeFile(wb, "Formato_Lecturas_Semanales.xlsx")
  }

  const handleExcelUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    let XLSX: any
    try {
      XLSX = await loadXLSX()
    } catch {
      showToast("No se pudo cargar la librería Excel. Revisa tu conexión.", "error")
      event.target.value = ""
      return
    }

    const reader = new FileReader()
    reader.onload = async (ev) => {
      try {
        setSaving(true)
        const workbook = XLSX.read(ev.target?.result, { type: "binary" })
        const sheet = workbook.Sheets[workbook.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" }) as Record<string, unknown>[]
        const nuevas = rows.map((raw, index) => {
          const record = Object.entries(raw).reduce<Record<string, unknown>>((acc, [key, value]) => {
            acc[key.trim().toLowerCase()] = value
            return acc
          }, {})
          const fechaSemana = excelDate(rowValue(record, ["FechaSemana", "Fecha Semana", "Semana", "Fecha"]))
          const equipoId = String(rowValue(record, ["EquipoID", "Equipo", "Eq."])).trim()
          const sucursal = String(rowValue(record, ["Sucursal"])).trim()
          const cabina = String(rowValue(record, ["Cabina", "Cab."])).trim()
          const operadoraId = String(rowValue(record, ["OperadoraID", "Operadora", "Operador"])).trim()
          const lecturaInicial = excelNumber(rowValue(record, ["LecturaInicial", "Lectura Inicial", "PulsosInicio", "Pulsos Inicio"]))
          const lecturaFinal = excelNumber(rowValue(record, ["LecturaFinal", "Lectura Final", "PulsosFin", "Pulsos Fin"]))
          const observaciones = String(rowValue(record, ["Observaciones", "Notas"])).trim()
          if (!fechaSemana || !equipoId || !sucursal) return null
          const suffix = `${fechaSemana}_${equipoId}_${operadoraId || "sinop"}_${cabina || index}`.replace(/[^\w-]+/g, "_")
          return {
            LecturaID: `lec_xlsx_${suffix}`,
            FechaSemana: fechaSemana,
            EquipoID: equipoId,
            Sucursal: sucursal,
            Cabina: cabina,
            OperadoraID: operadoraId,
            LecturaInicial: lecturaInicial,
            LecturaFinal: lecturaFinal,
            DiferenciaReal: Math.max(0, lecturaFinal - lecturaInicial),
            Observaciones: observaciones,
          } as LecturaSemanal
        }).filter(Boolean) as LecturaSemanal[]

        if (!nuevas.length) {
          showToast("No se encontraron filas válidas. Revisa el formato ejemplo.", "error")
          return
        }

        const ids = new Set(nuevas.map(item => item.LecturaID))
        setDbPulsos({
          ...dbPulsos,
          lecturasSemanales: [...dbPulsos.lecturasSemanales.filter(item => !ids.has(item.LecturaID)), ...nuevas],
        })
        for (const lectura of nuevas) await syncApi({ action: "saveLectura", data: JSON.stringify(lectura) })
        showToast(`${nuevas.length} lecturas importadas correctamente`, "success")
      } catch (error) {
        showToast("Error importando Excel: " + String(error), "error")
      } finally {
        setSaving(false)
      }
    }
    reader.readAsBinaryString(file)
    event.target.value = ""
  }

  const sorted = [...dbPulsos.lecturasSemanales].sort((a, b) => b.FechaSemana.localeCompare(a.FechaSemana))

  // Agrupación por semana (FechaSemana ya es el lunes ISO). Cada bloque
  // calcula su propio resumen: lecturas, equipos, sucursales únicas,
  // total diferencia, mayor diferencia con equipo. Orden: semana más
  // reciente arriba; dentro de cada semana ordena por sucursal → cabina → equipo.
  const semanasAgrupadas = useMemo(() => {
    const map = new Map<string, typeof sorted>()
    for (const l of sorted) {
      const key = String(l.FechaSemana || "").slice(0, 10) || "sin-fecha"
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(l)
    }
    return Array.from(map.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([fechaSemana, lecturas]) => {
        const ordered = [...lecturas].sort((a, b) => {
          const cmpSuc = String(a.Sucursal || "").localeCompare(String(b.Sucursal || ""), "es")
          if (cmpSuc !== 0) return cmpSuc
          const cmpCab = String(a.Cabina || "").localeCompare(String(b.Cabina || ""), "es")
          if (cmpCab !== 0) return cmpCab
          return Number(a.EquipoID || 0) - Number(b.EquipoID || 0)
        })
        const sucursales = Array.from(new Set(lecturas.map((l) => l.Sucursal).filter(Boolean)))
        const totalDif = lecturas.reduce((s, l) => s + (Number(l.DiferenciaReal) || 0), 0)
        const peor = [...lecturas].sort((a, b) => Number(b.DiferenciaReal || 0) - Number(a.DiferenciaReal || 0))[0]
        return { fechaSemana, lecturas: ordered, sucursales, totalDif, peor, equiposCount: lecturas.length }
      })
  }, [sorted])

  // Estado de bloques colapsados — por default todas las semanas EXCEPTO
  // la más reciente están contraídas. El usuario puede expandir las que quiera.
  const [collapsedWeeks, setCollapsedWeeks] = useState<Set<string>>(() => new Set())
  const toggleWeek = (key: string) => setCollapsedWeeks((current) => {
    const next = new Set(current)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })
  // La primera semana en la lista (más reciente) por convención está expandida
  // a menos que el usuario explícitamente la cierre. Las otras: contraídas
  // por default. Implementamos "isCollapsed" como: collapsedWeeks.has(key)
  // para la primera, !collapsedWeeks.has(key) para las demás — invertimos
  // así el default queda correcto sin pre-poblar el Set con todas las keys.
  const isWeekExpanded = (key: string, idx: number) => idx === 0
    ? !collapsedWeeks.has(key)
    : collapsedWeeks.has(key)

  const sortedLecturas = [...dbPulsos.lecturasSemanales].sort((a, b) => {
    if (!sortCol) return 0
    let va: any, vb: any
    switch(sortCol) {
      case "FechaSemana": va = String(a.FechaSemana || ""); vb = String(b.FechaSemana || ""); break
      case "EquipoID": va = Number(a.EquipoID) || 0; vb = Number(b.EquipoID) || 0; break
      case "Sucursal": va = String(a.Sucursal || ""); vb = String(b.Sucursal || ""); break
      case "OperadoraID": va = String(a.OperadoraID || ""); vb = String(b.OperadoraID || ""); break
      case "LecturaInicial": va = Number(a.LecturaInicial) || 0; vb = Number(b.LecturaInicial) || 0; break
      case "LecturaFinal": va = Number(a.LecturaFinal) || 0; vb = Number(b.LecturaFinal) || 0; break
      case "DiferenciaReal": va = Number(a.DiferenciaReal) || 0; vb = Number(b.DiferenciaReal) || 0; break
      default: return 0
    }
    if (typeof va === "string") { va = va.toLowerCase(); vb = vb.toLowerCase() }
    if (va < vb) return sortDir === "asc" ? -1 : 1
    if (va > vb) return sortDir === "asc" ? 1 : -1
    return 0
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2"><BookOpen className="h-5 w-5 text-primary" />Lecturas pantalla equipos</h2>
          <p className="text-sm text-muted-foreground">Registro del contador del equipo — inicio y fin de cada semana</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={downloadTemplate}>
            <FileSpreadsheet className="h-4 w-4 mr-2" />Formato ejemplo
          </Button>
          <label>
            <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleExcelUpload} />
            <Button variant="outline" size="sm" asChild>
              <span><Upload className="h-4 w-4 mr-2" />Importar Excel</span>
            </Button>
          </label>
          <Button onClick={openNew} size="sm"><Plus className="h-4 w-4 mr-2" />Nueva Lectura</Button>
        </div>
      </div>

      {/* Bloques por semana — cada semana es una Card independiente con
          header expandible. La más reciente queda abierta por default. */}
      {semanasAgrupadas.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Sin lecturas. Registra la primera lectura semanal del equipo.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {semanasAgrupadas.map((bloque, idx) => {
            const expanded = isWeekExpanded(bloque.fechaSemana, idx)
            return (
              <Card key={bloque.fechaSemana} className="overflow-hidden">
                <CardHeader
                  className="cursor-pointer border-b border-slate-100 bg-slate-50/70 py-4 transition-colors hover:bg-slate-100/70"
                  onClick={() => toggleWeek(bloque.fechaSemana)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </div>
                      <div className="min-w-0">
                        <CardTitle className="text-base font-bold">
                          {fmtSemanaRango(bloque.fechaSemana)}
                        </CardTitle>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {bloque.equiposCount} {bloque.equiposCount === 1 ? "lectura" : "lecturas"}
                          {bloque.sucursales.length > 0 ? (
                            <> · {bloque.sucursales.length} {bloque.sucursales.length === 1 ? "sucursal" : "sucursales"} ({bloque.sucursales.join(", ")})</>
                          ) : null}
                          {" "}· Total diferencia <span className="font-bold text-foreground">+{bloque.totalDif.toLocaleString("es-DO")}</span>
                        </p>
                      </div>
                    </div>
                    {bloque.peor ? (
                      <div className="hidden shrink-0 text-right text-xs text-muted-foreground sm:block">
                        <div className="font-bold uppercase tracking-wide text-[10px]">Mayor diferencia</div>
                        <div className="mt-0.5">
                          Equipo {bloque.peor.EquipoID}
                          <span className="ml-2 font-mono text-emerald-600">
                            +{Number(bloque.peor.DiferenciaReal || 0).toLocaleString("es-DO")}
                          </span>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </CardHeader>
                {expanded ? (
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className={SEQ_HEADER_CLASS}>#</TableHead>
                            <TableHead>Equipo</TableHead>
                            <TableHead>Sucursal / Cabina</TableHead>
                            <TableHead>Operadora</TableHead>
                            <TableHead className="text-right">Inicial</TableHead>
                            <TableHead className="text-right">Final</TableHead>
                            <TableHead className="text-right">Diferencia</TableHead>
                            <TableHead className="text-right">Acciones</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {bloque.lecturas.map((l, i) => (
                            <TableRow key={l.LecturaID}>
                              <TableCell className="text-center"><SeqBadge n={i + 1} /></TableCell>
                              <TableCell className="font-mono text-sm">{l.EquipoID}</TableCell>
                              <TableCell className="text-sm text-muted-foreground">{l.Sucursal}{l.Cabina ? ` / ${l.Cabina}` : ""}</TableCell>
                              <TableCell className="text-sm">{dbPulsos.operadoras.find(o => o.OperadoraID === l.OperadoraID)?.Nombre || l.OperadoraID || "-"}</TableCell>
                              <TableCell className="text-right font-mono text-sm">{Number(l.LecturaInicial).toLocaleString("es-DO")}</TableCell>
                              <TableCell className="text-right font-mono text-sm">{Number(l.LecturaFinal).toLocaleString("es-DO")}</TableCell>
                              <TableCell className="text-right">
                                <Badge variant="outline" className="font-mono text-green-400 border-green-500/30">
                                  +{Number(l.DiferenciaReal).toLocaleString("es-DO")}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="flex gap-1 justify-end">
                                  <RecordActions
                                    title={`Lectura: ${l.EquipoID} ${fmtSemanaRango(l.FechaSemana)}`}
                                    record={l as unknown as Record<string, unknown>}
                                    onEdit={() => openEdit(l)}
                                    onDelete={() => handleDelete(l)}
                                  />
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                ) : null}
              </Card>
            )
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{isEditing ? "Editar Lectura" : "Nueva Lectura Semanal"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="space-y-1.5 col-span-2">
              <Label>Fecha de semana (lunes del período)</Label>
              <Input type="date" value={form.FechaSemana} onChange={e => setForm({ ...form, FechaSemana: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Equipo *</Label>
              <Select value={form.EquipoID} onValueChange={v => setForm({ ...form, EquipoID: v })}>
                <SelectTrigger><SelectValue placeholder="Seleccionar" /></SelectTrigger>
                <SelectContent>
                  {db.equipos.filter(e => e.Estado === "Activo").map(e => (
                    <SelectItem key={e.EquipoID} value={e.EquipoID}>{e.EquipoID} — {e.Modelo}</SelectItem>
                  ))}
                  {db.equipos.length === 0 && <>
                    <SelectItem value="133">133 — CANDELA GENTLEYAG</SelectItem>
                    <SelectItem value="158">158 — CANDELA GENTLEYAG</SelectItem>
                  </>}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Sucursal *</Label>
              <Select value={form.Sucursal} onValueChange={v => setForm({ ...form, Sucursal: v })}>
                <SelectTrigger><SelectValue placeholder="Sucursal" /></SelectTrigger>
                <SelectContent>
                  {db.sucursales.length > 0
                    ? db.sucursales.map(s => <SelectItem key={s.Codigo} value={s.Nombre}>{s.Nombre}</SelectItem>)
                    : <>
                        <SelectItem value="Rafael Vidal">Rafael Vidal</SelectItem>
                        <SelectItem value="Los Jardines">Los Jardines</SelectItem>
                        <SelectItem value="Villa Olga">Villa Olga</SelectItem>
                        <SelectItem value="La Vega">La Vega</SelectItem>
                      </>}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Cabina</Label>
              <Input value={form.Cabina} onChange={e => setForm({ ...form, Cabina: e.target.value })} placeholder="Ej: Cabina 1" />
            </div>
            <div className="space-y-1.5">
              <Label>Operadora responsable</Label>
              <Select value={form.OperadoraID} onValueChange={v => setForm({ ...form, OperadoraID: v })}>
                <SelectTrigger><SelectValue placeholder="Operadora" /></SelectTrigger>
                <SelectContent>
                  {dbPulsos.operadoras.filter(o => o.Estado === "Activa").map(o => (
                    <SelectItem key={o.OperadoraID} value={o.OperadoraID}>{o.Nombre}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Lectura inicial (pantalla)</Label>
              <Input type="number" value={form.LecturaInicial} onChange={e => setForm({ ...form, LecturaInicial: Number(e.target.value) })} min={0} />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Lectura final (pantalla)</Label>
                <label className="cursor-pointer">
                  <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleScanPhoto} />
                  <span className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors">
                    {scanning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Camera className="h-3 w-3" />}
                    {scanning ? "Leyendo..." : "Escanear foto"}
                  </span>
                </label>
              </div>
              <Input type="number" value={form.LecturaFinal} onChange={e => setForm({ ...form, LecturaFinal: Number(e.target.value) })} min={0} />
            </div>
            <div className="col-span-2 bg-muted/40 rounded-lg p-3 flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Diferencia real de pulsos:</span>
              <span className={`font-bold text-xl ${diferencia < 0 ? "text-destructive" : "text-green-400"}`}>
                {diferencia < 0 ? "⚠ " : "+"}{diferencia.toLocaleString()} pulsos
              </span>
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label>Observaciones</Label>
              <Input value={form.Observaciones} onChange={e => setForm({ ...form, Observaciones: e.target.value })} placeholder="Notas opcionales" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}><X className="h-4 w-4 mr-2" />Cancelar</Button>
            <Button onClick={handleSave} disabled={saving}><Save className="h-4 w-4 mr-2" />{saving ? "Guardando..." : "Guardar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
