"use client"

import { useMemo, useState } from "react"
import { useAppStore } from "@/lib/store"
import { loadXLSX } from "@/lib/load-xlsx"
import { SeqBadge } from "@/components/seq-badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Activity, Download, CheckCircle, AlertTriangle, XCircle, TrendingUp, TrendingDown, Upload, FileSpreadsheet, Pencil, Save, X } from "lucide-react"

function fmt(n: number) { return n.toLocaleString("es-DO") }

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

function getAlerta(pct: number) {
  const a = Math.abs(pct)
  if (a <= 5) return "OK"
  if (a <= 15) return "Advertencia"
  return "Critico"
}

function alertaBadge(alerta: string) {
  if (alerta === "OK") return <Badge className="bg-green-500/20 text-green-400 border-green-500/30 gap-1 text-xs"><CheckCircle className="h-3 w-3" />OK</Badge>
  if (alerta === "Advertencia") return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 gap-1 text-xs"><AlertTriangle className="h-3 w-3" />Advert.</Badge>
  return <Badge className="bg-red-500/20 text-red-400 border-red-500/30 gap-1 text-xs"><XCircle className="h-3 w-3" />Crítico</Badge>
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

// Mapa de sucursales cortas
const SUC_MAP: Record<string, string> = {
  "Rafael Vidal": "R VIDAL",
  "Los Jardines": "JARDINES",
  "Villa Olga": "V OLGA",
  "La Vega": "LA VEGA",
}

function normalizeSucursal(value: string) {
  const text = String(value || "").toLowerCase()
  if (text.includes("plaza") || text.includes("mediterr")) return "rafael vidal"
  if (text.includes("rafael") || text.includes("vidal") || text.includes("r vidal")) return "rafael vidal"
  if (text.includes("jardines")) return "los jardines"
  if (text.includes("villa") || text.includes("olga") || text.includes("v olga")) return "villa olga"
  if (text.includes("vega")) return "la vega"
  return text.trim()
}

function normalizeCabina(value: string) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").replace("cabina", "").trim()
}

function normalizeEquipo(value: string) {
  return String(value || "").toLowerCase().trim()
}

function safeKey(value: string) {
  return String(value || "").replace(/[^\w-]+/g, "_")
}

function auditManualSessionId(fecha: string, sucursal: string, equipo: string, operadora: string, cabina: string) {
  return `ses_audit_manual_${safeKey(`${fecha}_${sucursal}_${equipo}_${operadora}_${cabina}`)}`
}

export function PulsosAuditoriaPage() {
  const { dbPulsos, setDbPulsos, apiUrl, showToast, setIsLoading, setLoadingMessage } = useAppStore()
  const [filterSuc, setFilterSuc] = useState("todas")
  const [filterSemana, setFilterSemana] = useState("todas")
  const [sortCol, setSortCol] = useState<string>("")
  const [sortDir, setSortDir] = useState<"asc"|"desc">("asc")
  const [editRow, setEditRow] = useState<any | null>(null)
  const [editForm, setEditForm] = useState({ operadora: "", pulsosInicio: 0, pulsosFin: 0, dispOperador: 0 })
  const syncApi = async (params: Record<string, string>) => {
    try {
      const { apiJsonp, normalizeApiUrl } = await import("@/lib/store")
      await apiJsonp(normalizeApiUrl(apiUrl), params)
    } catch (error) {
      console.warn(error)
    }
  }

  const handleSort = (col: string) => {
    if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc")
    else { setSortCol(col); setSortDir("asc") }
  }
  const SortIcon = ({col}:{col:string}) =>
    sortCol !== col ? <span className="text-muted-foreground/30 ml-1">⇅</span>
    : <span className="ml-1 text-primary">{sortDir === "asc" ? "↑" : "↓"}</span>

  // Agrupar lecturas por semana
  const semanas = useMemo(() => {
    const map: Record<string, any[]> = {}
    dbPulsos.lecturasSemanales.forEach(lec => {
      const desde = String(lec.FechaSemana || "").split("T")[0].trim()
      if (!desde || !/^\d{4}-\d{2}-\d{2}$/.test(desde)) return
      if (!map[desde]) map[desde] = []
      
      // Buscar disparos en la misma sucursal/cabina/equipo durante la semana
      const d = new Date(desde + "T12:00:00")
      if (isNaN(d.getTime())) return
      const dEnd = new Date(d)
      dEnd.setDate(dEnd.getDate() + 6)
      const hasta = dEnd.toISOString().split("T")[0]

      const manualId = auditManualSessionId(desde, lec.Sucursal || "", lec.EquipoID || "", lec.OperadoraID || "", lec.Cabina || "")
      const manualSesion = dbPulsos.sesionesCliente.find(s => s.SesionID === manualId)
      const sesiones = dbPulsos.sesionesCliente.filter(s => {
        if (s.SesionID === manualId) return false
        const mismaSucursal = normalizeSucursal(s.Sucursal) === normalizeSucursal(lec.Sucursal)
        const mismaCabina = normalizeCabina(s.Cabina) === normalizeCabina(lec.Cabina)
        const mismoEquipo = normalizeEquipo(s.EquipoID) === normalizeEquipo(lec.EquipoID)
        const fechaSesion = String(s.Fecha || "").split("T")[0].trim()
        const enRango = fechaSesion >= desde && fechaSesion <= hasta
        return mismaSucursal && mismaCabina && mismoEquipo && enRango
      })
      const dispLaser = Number(lec.DiferenciaReal) || 0
      const dispOperador = manualSesion ? Number(manualSesion.DisparosReportados) || 0 : sesiones.reduce((sum, s) => sum + (Number(s.DisparosReportados) || 0), 0)
      const diferencia = dispOperador - dispLaser
      const pct = dispLaser > 0 ? Math.round((diferencia / dispLaser) * 100) : 0

      map[desde].push({
        lecturaId: lec.LecturaID,
        fechaSemana: desde,
        sucursal: lec.Sucursal || "",
        cabina: (lec.Cabina || "").replace("Cabina ", ""),
        cabinaRaw: lec.Cabina || "",
        operadora: lec.OperadoraID || "",
        equipo: lec.EquipoID || "",
        serial: lec.Observaciones || "",
        pulsosInicio: Number(lec.LecturaInicial) || 0,
        pulsosFin: Number(lec.LecturaFinal) || 0,
        dispLaser: dispLaser,
        dispOperador: dispOperador,
        diferencia: diferencia,
        pct: pct,
        alerta: getAlerta(pct),
      })
    })
    // Ordenar semanas de más reciente a más antigua
    return Object.entries(map)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([fecha, rows]) => {
        // Ordenar filas por sucursal y cabina
        rows.sort((a: any, b: any) => {
          if (a.sucursal !== b.sucursal) return a.sucursal.localeCompare(b.sucursal)
          return Number(a.cabina) - Number(b.cabina)
        })
        const totDispLaser = rows.reduce((s: number, r: any) => s + r.dispLaser, 0)
        const totDispOp = rows.reduce((s: number, r: any) => s + r.dispOperador, 0)
        return {
          fecha,
          rows,
          totPulsosInicio: rows.reduce((s: number, r: any) => s + r.pulsosInicio, 0),
          totPulsosFin: rows.reduce((s: number, r: any) => s + r.pulsosFin, 0),
          totDispLaser,
          totDispOp,
          totDiferencia: totDispOp - totDispLaser,
        }
      })
  }, [dbPulsos.lecturasSemanales, dbPulsos.sesionesCliente])

  const semanasDisponibles = semanas.map(s => s.fecha)
  const sucursales = Array.from(new Set(dbPulsos.lecturasSemanales.map(l => l.Sucursal).filter(Boolean)))

  const filtered = semanas.filter(s => {
    if (filterSemana !== "todas" && s.fecha !== filterSemana) return false
    return true
  }).map(s => ({
    ...s,
    rows: (filterSuc === "todas" ? s.rows : s.rows.filter((r: any) => r.sucursal === filterSuc))
      .sort((a: any, b: any) => {
        if (!sortCol) {
          // Default: por sucursal y cabina
          if (a.sucursal !== b.sucursal) return a.sucursal.localeCompare(b.sucursal)
          return Number(a.cabina) - Number(b.cabina)
        }
        let va: any, vb: any
        switch(sortCol) {
          case "sucursal": va = a.sucursal; vb = b.sucursal; break
          case "cabina": va = Number(a.cabina); vb = Number(b.cabina); break
          case "operadora": va = a.operadora; vb = b.operadora; break
          case "equipo": va = a.equipo; vb = b.equipo; break
          case "pulsosInicio": va = a.pulsosInicio; vb = b.pulsosInicio; break
          case "pulsosFin": va = a.pulsosFin; vb = b.pulsosFin; break
          case "dispLaser": va = a.dispLaser; vb = b.dispLaser; break
          case "dispOperador": va = a.dispOperador; vb = b.dispOperador; break
          case "diferencia": va = a.diferencia; vb = b.diferencia; break
          case "pct": va = a.pct; vb = b.pct; break
          case "alerta": va = a.alerta; vb = b.alerta; break
          default: return 0
        }
        if (typeof va === "string") { va = va.toLowerCase(); vb = vb.toLowerCase() }
        if (va < vb) return sortDir === "asc" ? -1 : 1
        if (va > vb) return sortDir === "asc" ? 1 : -1
        return 0
      })
  })).filter(s => s.rows.length > 0)

  // KPIs
  const allRows = filtered.flatMap(s => s.rows)
  const kpis = {
    total: allRows.length,
    ok: allRows.filter((r: any) => r.alerta === "OK").length,
    warn: allRows.filter((r: any) => r.alerta === "Advertencia").length,
    crit: allRows.filter((r: any) => r.alerta === "Critico").length,
    totLaser: allRows.reduce((s: number, r: any) => s + r.dispLaser, 0),
    totOp: allRows.reduce((s: number, r: any) => s + r.dispOperador, 0),
  }

  const operadorasEditables = Array.from(new Set([
    ...dbPulsos.operadoras.filter(op => op.Estado !== "Inactiva").map(op => op.OperadoraID || op.Nombre),
    ...dbPulsos.lecturasSemanales.map(item => item.OperadoraID),
    editForm.operadora,
  ].filter(Boolean))).sort((a, b) => String(a).localeCompare(String(b)))

  const exportExcel = async () => {
    let XLSX: any
    try {
      XLSX = await loadXLSX()
    } catch {
      showToast("No se pudo cargar la librería Excel. Revisa tu conexión.", "error")
      return
    }
    const rows: unknown[][] = [["SUCURSAL","Cabina","Operador","Equipo","Serial","Pulsos Inicio","Pulsos Fin","DISP LASER","OPERADOR","DISP OPERADOR","DIFERENCIA","%"]]
    filtered.forEach(s => {
      rows.push(["Semana: " + s.fecha])
      s.rows.forEach((r: any) => {
        rows.push([SUC_MAP[r.sucursal]||r.sucursal, r.cabina, r.operadora, r.equipo, r.serial,
          r.pulsosInicio, r.pulsosFin, r.dispLaser, r.operadora, r.dispOperador, r.diferencia, r.pct + "%"])
      })
      rows.push(["TOTAL","","","","",s.totPulsosInicio,s.totPulsosFin,s.totDispLaser,"",s.totDispOp,s.totDiferencia,""])
    })
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet(rows)
    XLSX.utils.book_append_sheet(wb, ws, "Auditoria PULSE")
    XLSX.writeFile(wb, "PULSE_CSL_" + new Date().toISOString().slice(0,10) + ".xlsx")
  }

  const downloadTemplate = async () => {
    let XLSX: any
    try {
      XLSX = await loadXLSX()
    } catch {
      showToast("No se pudo cargar la librería Excel. Revisa tu conexión.", "error")
      return
    }
    const headers = ["FechaSemana","Sucursal","Cabina","OperadoraID","EquipoID","PulsosInicio","PulsosFin","DisparosOperador","Serial","Observaciones"]
    const rows = [
      ["2026-04-25","Rafael Vidal","Cabina 1","Diana","7","125000","128500","3400","SN-001","Semana del 25 abr de 2026"],
      ["2026-04-25","Los Jardines","Cabina 4","YAMILKA","9","90000","92450","2500","SN-002",""],
    ]
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
    XLSX.utils.book_append_sheet(wb, ws, "Formato PULSE")
    XLSX.writeFile(wb, "Formato_Auditoria_PULSE_Semana_2026-04-25.xlsx")
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
        setIsLoading(true)
        setLoadingMessage("Importando auditoría PULSE...")
        const workbook = XLSX.read(ev.target?.result, { type: "binary" })
        const sheet = workbook.Sheets[workbook.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" }) as Record<string, unknown>[]
        const lecturas = rows.map((raw, index) => {
          const record = Object.entries(raw).reduce<Record<string, unknown>>((acc, [key, value]) => {
            acc[key.trim().toLowerCase()] = value
            return acc
          }, {})
          const fechaSemana = excelDate(rowValue(record, ["FechaSemana", "Fecha Semana", "Semana", "Fecha"]))
          const sucursal = String(rowValue(record, ["Sucursal", "SUCURSAL"])).trim()
          const cabina = String(rowValue(record, ["Cabina", "Cab."])).trim()
          const operadora = String(rowValue(record, ["OperadoraID", "Operadora", "Operador"])).trim()
          const equipo = String(rowValue(record, ["EquipoID", "Equipo", "Eq."])).trim()
          const lecturaInicial = excelNumber(rowValue(record, ["PulsosInicio", "Pulsos Inicio", "LecturaInicial", "Lectura Inicial"]))
          const lecturaFinal = excelNumber(rowValue(record, ["PulsosFin", "Pulsos Fin", "LecturaFinal", "Lectura Final"]))
          const disparosOperador = excelNumber(rowValue(record, ["DisparosOperador", "Disp Operador", "DISP OPERADOR", "Operador"]))
          const serial = String(rowValue(record, ["Serial", "Serie"])).trim()
          const observaciones = String(rowValue(record, ["Observaciones", "Notas"])).trim()
          if (!fechaSemana || !sucursal || !operadora || !equipo) return null
          const suffix = `${fechaSemana}_${equipo}_${operadora}_${cabina || index}`.replace(/[^\w-]+/g, "_")
          return {
            lectura: {
              LecturaID: `lec_pulse_${suffix}`,
              FechaSemana: fechaSemana,
              EquipoID: equipo,
              Sucursal: sucursal,
              Cabina: cabina,
              OperadoraID: operadora,
              LecturaInicial: lecturaInicial,
              LecturaFinal: lecturaFinal,
              DiferenciaReal: Math.max(0, lecturaFinal - lecturaInicial),
              Observaciones: [serial, observaciones].filter(Boolean).join(" · "),
            },
            sesion: disparosOperador > 0 ? {
              SesionID: `ses_pulse_${suffix}`,
              Fecha: fechaSemana,
              Sucursal: sucursal,
              Cabina: cabina,
              OperadoraID: operadora,
              Cliente: "Importación auditoría",
              AreaTrabajada: "PULSE",
              DisparosReportados: disparosOperador,
              Duracion: undefined,
              EquipoID: equipo,
              Observaciones: "Importado desde Auditoría PULSE",
            } : null,
          }
        }).filter(Boolean) as { lectura: any; sesion: any | null }[]

        if (!lecturas.length) {
          showToast("No se encontraron filas válidas. Revisa el formato ejemplo.", "error")
          return
        }

        const nuevasLecturas = lecturas.map(item => item.lectura)
        const nuevasSesiones = lecturas.map(item => item.sesion).filter(Boolean)
        const lecturaIds = new Set(nuevasLecturas.map(item => item.LecturaID))
        const sesionIds = new Set(nuevasSesiones.map(item => item.SesionID))
        setDbPulsos({
          ...dbPulsos,
          lecturasSemanales: [...dbPulsos.lecturasSemanales.filter(item => !lecturaIds.has(item.LecturaID)), ...nuevasLecturas],
          sesionesCliente: [...dbPulsos.sesionesCliente.filter(item => !sesionIds.has(item.SesionID)), ...nuevasSesiones],
        })
        for (const lectura of nuevasLecturas) await syncApi({ action: "saveLectura", data: JSON.stringify(lectura) })
        for (const sesion of nuevasSesiones) await syncApi({ action: "saveSesion", data: JSON.stringify(sesion) })
        setFilterSemana(nuevasLecturas[0]?.FechaSemana || "todas")
        showToast(`${nuevasLecturas.length} lecturas importadas para Auditoría PULSE`, "success")
      } catch (error) {
        showToast("Error importando Excel: " + String(error), "error")
      } finally {
        setIsLoading(false)
      }
    }
    reader.readAsBinaryString(file)
    event.target.value = ""
  }

  const openEdit = (row: any) => {
    setEditRow(row)
    setEditForm({
      operadora: String(row.operadora || ""),
      pulsosInicio: Number(row.pulsosInicio) || 0,
      pulsosFin: Number(row.pulsosFin) || 0,
      dispOperador: Number(row.dispOperador) || 0,
    })
  }

  const saveEdit = async () => {
    if (!editRow) return
    const lectura = dbPulsos.lecturasSemanales.find(item => item.LecturaID === editRow.lecturaId)
    if (!lectura) {
      showToast("No se encontr? la lectura para editar", "error")
      return
    }

    const updatedLectura = {
      ...lectura,
      OperadoraID: editForm.operadora,
      LecturaInicial: editForm.pulsosInicio,
      LecturaFinal: editForm.pulsosFin,
      DiferenciaReal: Math.max(0, editForm.pulsosFin - editForm.pulsosInicio),
    }
    const oldManualId = auditManualSessionId(editRow.fechaSemana, editRow.sucursal, editRow.equipo, editRow.operadora, editRow.cabinaRaw || editRow.cabina)
    const manualId = auditManualSessionId(editRow.fechaSemana, editRow.sucursal, editRow.equipo, editForm.operadora, editRow.cabinaRaw || editRow.cabina)
    const weekStart = String(editRow.fechaSemana || "").split("T")[0]
    const weekEndDate = new Date(weekStart + "T12:00:00")
    weekEndDate.setDate(weekEndDate.getDate() + 6)
    const weekEnd = weekEndDate.toISOString().split("T")[0]
    const relatedSessions = dbPulsos.sesionesCliente
      .filter(item => item.SesionID !== oldManualId && item.SesionID !== manualId)
      .filter(item => {
        const fecha = String(item.Fecha || "").split("T")[0]
        return fecha >= weekStart &&
          fecha <= weekEnd &&
          normalizeSucursal(item.Sucursal) === normalizeSucursal(editRow.sucursal) &&
          normalizeCabina(item.Cabina) === normalizeCabina(editRow.cabinaRaw || editRow.cabina) &&
          normalizeEquipo(item.EquipoID) === normalizeEquipo(editRow.equipo)
      })
      .map(item => ({ ...item, OperadoraID: editForm.operadora }))
    const manualSesion = {
      SesionID: manualId,
      Fecha: editRow.fechaSemana,
      Sucursal: editRow.sucursal,
      Cabina: editRow.cabinaRaw || `Cabina ${editRow.cabina}`,
      OperadoraID: editForm.operadora,
      Cliente: "Ajuste auditor?a",
      AreaTrabajada: "PULSE",
      DisparosReportados: editForm.dispOperador,
      Duracion: undefined,
      EquipoID: editRow.equipo,
      Observaciones: "Ajuste manual Auditor?a PULSE",
    }

    setDbPulsos({
      ...dbPulsos,
      lecturasSemanales: dbPulsos.lecturasSemanales.map(item => item.LecturaID === updatedLectura.LecturaID ? updatedLectura : item),
      sesionesCliente: [
        ...dbPulsos.sesionesCliente
          .filter(item => item.SesionID !== oldManualId && item.SesionID !== manualId)
          .filter(item => !relatedSessions.some(updated => updated.SesionID === item.SesionID)),
        ...relatedSessions,
        manualSesion,
      ],
    })
    await syncApi({ action: "saveLectura", data: JSON.stringify(updatedLectura) })
    if (oldManualId !== manualId) await syncApi({ action: "deleteSesion", id: oldManualId })
    for (const sesion of relatedSessions) await syncApi({ action: "saveSesion", data: JSON.stringify(sesion) })
    await syncApi({ action: "saveSesion", data: JSON.stringify(manualSesion) })
    showToast("Auditor?a actualizada en todo el sistema", "success")
    setEditRow(null)
  }

  if (false && dbPulsos.lecturasSemanales.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
        <Activity className="h-12 w-12 text-muted-foreground opacity-30" />
        <h2 className="text-lg font-semibold">Sin datos de auditoría</h2>
        <p className="text-sm text-muted-foreground max-w-md">
          Registra lecturas semanales y sesiones para generar la auditoría PULSE.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2"><Activity className="h-5 w-5 text-primary" />Auditoría PULSE</h2>
          <p className="text-sm text-muted-foreground">
            Comparativo de pulsos por equipo — Disp. Láser vs Disp. Operador
            <span className="ml-3 text-xs text-muted-foreground/60">
              ({dbPulsos.lecturasSemanales.length} lecturas · {dbPulsos.sesionesCliente.length} sesiones · {dbPulsos.operadoras.length} operadoras)
            </span>
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={downloadTemplate}>
            <FileSpreadsheet className="h-4 w-4 mr-2" />Formato ejemplo
          </Button>
          <label>
            <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleExcelUpload} />
            <Button variant="outline" size="sm" asChild>
              <span><Upload className="h-4 w-4 mr-2" />Importar Excel</span>
            </Button>
          </label>
          <Button variant="outline" size="sm" onClick={exportExcel} disabled={!filtered.length}>
            <Download className="h-4 w-4 mr-2" />Exportar Excel
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-6">
        <Card className="border-primary/20">
          <CardContent className="pt-3 pb-2 text-center">
            <p className="text-[10px] text-muted-foreground uppercase">Registros</p>
            <p className="text-2xl font-bold text-primary">{kpis.total}</p>
          </CardContent>
        </Card>
        <Card className="border-green-500/20">
          <CardContent className="pt-3 pb-2 text-center">
            <p className="text-[10px] text-muted-foreground uppercase">OK</p>
            <p className="text-2xl font-bold text-green-500">{kpis.ok}</p>
          </CardContent>
        </Card>
        <Card className="border-yellow-500/20">
          <CardContent className="pt-3 pb-2 text-center">
            <p className="text-[10px] text-muted-foreground uppercase">Advertencia</p>
            <p className="text-2xl font-bold text-yellow-500">{kpis.warn}</p>
          </CardContent>
        </Card>
        <Card className="border-red-500/20">
          <CardContent className="pt-3 pb-2 text-center">
            <p className="text-[10px] text-muted-foreground uppercase">Crítico</p>
            <p className="text-2xl font-bold text-red-500">{kpis.crit}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-3 pb-2 text-center">
            <p className="text-[10px] text-muted-foreground uppercase">Disp. Láser</p>
            <p className="text-lg font-bold font-mono">{fmt(kpis.totLaser)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-3 pb-2 text-center">
            <p className="text-[10px] text-muted-foreground uppercase">Disp. Operador</p>
            <p className="text-lg font-bold font-mono">{fmt(kpis.totOp)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filtros */}
      <div className="flex gap-3 flex-wrap items-end">
        <div className="flex items-center gap-2">
          <Label className="text-sm">Semana:</Label>
          <Select value={filterSemana} onValueChange={setFilterSemana}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas las semanas</SelectItem>
              {semanasDisponibles.map(s => <SelectItem key={s} value={s}>{fmtSemanaRango(s)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-sm">Sucursal:</Label>
          <Select value={filterSuc} onValueChange={setFilterSuc}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas</SelectItem>
              {sucursales.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {(filterSemana !== "todas" || filterSuc !== "todas") && (
          <Button variant="ghost" size="sm" onClick={() => { setFilterSemana("todas"); setFilterSuc("todas") }}>Limpiar</Button>
        )}
      </div>

      {/* Tablas por semana */}
      {filtered.map((semana, idx) => (
        <Card key={`${semana.fecha}-${idx}`}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center justify-between">
              <span>Semana {fmtSemanaRango(semana.fecha)}</span>
              <span className="text-xs font-normal text-muted-foreground">{semana.rows.length} equipos</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="w-12 px-2 py-2 text-center text-[10px] font-black uppercase tracking-widest text-muted-foreground">#</th>
                  <th className="px-3 py-2 text-left font-semibold text-xs text-muted-foreground cursor-pointer select-none hover:text-foreground" onClick={() => handleSort("sucursal")}>SUCURSAL<SortIcon col="sucursal" /></th>
                  <th className="px-2 py-2 text-center font-semibold text-xs text-muted-foreground cursor-pointer select-none hover:text-foreground" onClick={() => handleSort("cabina")}>Cab.<SortIcon col="cabina" /></th>
                  <th className="px-3 py-2 text-left font-semibold text-xs text-muted-foreground cursor-pointer select-none hover:text-foreground" onClick={() => handleSort("operadora")}>OPERADOR<SortIcon col="operadora" /></th>
                  <th className="px-2 py-2 text-center font-semibold text-xs text-muted-foreground cursor-pointer select-none hover:text-foreground" onClick={() => handleSort("equipo")}>Eq.<SortIcon col="equipo" /></th>
                  <th className="px-3 py-2 text-right font-semibold text-xs text-muted-foreground cursor-pointer select-none hover:text-foreground" onClick={() => handleSort("pulsosInicio")}>Pulsos Inicio<SortIcon col="pulsosInicio" /></th>
                  <th className="px-3 py-2 text-right font-semibold text-xs text-muted-foreground cursor-pointer select-none hover:text-foreground" onClick={() => handleSort("pulsosFin")}>Pulsos Fin<SortIcon col="pulsosFin" /></th>
                  <th className="px-3 py-2 text-right font-semibold text-xs text-primary cursor-pointer select-none hover:text-foreground" onClick={() => handleSort("dispLaser")}>DISP LÁSER<SortIcon col="dispLaser" /></th>
                  <th className="px-3 py-2 text-right font-semibold text-xs text-primary cursor-pointer select-none hover:text-foreground" onClick={() => handleSort("dispOperador")}>DISP OPERADOR<SortIcon col="dispOperador" /></th>
                  <th className="px-3 py-2 text-right font-semibold text-xs text-muted-foreground cursor-pointer select-none hover:text-foreground" onClick={() => handleSort("diferencia")}>DIFERENCIA<SortIcon col="diferencia" /></th>
                  <th className="px-2 py-2 text-right font-semibold text-xs text-muted-foreground cursor-pointer select-none hover:text-foreground" onClick={() => handleSort("pct")}>%<SortIcon col="pct" /></th>
                  <th className="px-2 py-2 text-center font-semibold text-xs text-muted-foreground cursor-pointer select-none hover:text-foreground" onClick={() => handleSort("alerta")}>Estado<SortIcon col="alerta" /></th>
                  <th className="px-2 py-2 text-center font-semibold text-xs text-muted-foreground">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {semana.rows.map((r: any, i: number) => (
                  <tr key={i} className={`border-b border-border/50 ${r.alerta === "Critico" ? "bg-red-500/5" : r.alerta === "Advertencia" ? "bg-yellow-500/5" : "hover:bg-muted/20"}`}>
                    <td className="px-2 py-2 text-center"><SeqBadge n={i + 1} /></td>
                    <td className="px-3 py-2 text-xs font-semibold text-muted-foreground">{SUC_MAP[r.sucursal] || r.sucursal}</td>
                    <td className="px-2 py-2 text-center text-xs">{r.cabina}</td>
                    <td className="px-3 py-2 font-semibold text-sm">{r.operadora}</td>
                    <td className="px-2 py-2 text-center font-mono text-xs">{r.equipo}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-muted-foreground">{r.pulsosInicio > 0 ? fmt(r.pulsosInicio) : "-"}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-muted-foreground">{r.pulsosFin > 0 ? fmt(r.pulsosFin) : "-"}</td>
                    <td className="px-3 py-2 text-right font-mono text-sm font-bold">{fmt(r.dispLaser)}</td>
                    <td className="px-3 py-2 text-right font-mono text-sm font-bold">{fmt(r.dispOperador)}</td>
                    <td className="px-3 py-2 text-right">
                      <span className={`font-mono text-sm font-bold inline-flex items-center gap-1 ${r.diferencia > 0 ? "text-orange-400" : r.diferencia < 0 ? "text-blue-400" : "text-green-400"}`}>
                        {r.diferencia > 0 ? <TrendingUp className="h-3 w-3" /> : r.diferencia < 0 ? <TrendingDown className="h-3 w-3" /> : null}
                        {r.diferencia > 0 ? "+" : ""}{fmt(r.diferencia)}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-right">
                      <span className={`font-mono text-xs font-bold ${Math.abs(r.pct) <= 5 ? "text-green-400" : Math.abs(r.pct) <= 15 ? "text-yellow-400" : "text-red-400"}`}>
                        {r.pct > 0 ? "+" : ""}{r.pct}%
                      </span>
                    </td>
                    <td className="px-2 py-2 text-center">{alertaBadge(r.alerta)}</td>
                    <td className="px-2 py-2 text-center">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(r)} title="Editar">
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
                {/* Fila TOTAL */}
                <tr className="bg-muted/40 border-t-2 border-primary/30 font-bold">
                  <td className="px-3 py-2 text-xs" colSpan={5}>TOTAL</td>
                  <td className="px-3 py-2 text-right font-mono text-xs">{semana.totPulsosInicio > 0 ? fmt(semana.totPulsosInicio) : "-"}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs">{semana.totPulsosFin > 0 ? fmt(semana.totPulsosFin) : "-"}</td>
                  <td className="px-3 py-2 text-right font-mono text-sm text-primary">{fmt(semana.totDispLaser)}</td>
                  <td className="px-3 py-2 text-right font-mono text-sm text-primary">{fmt(semana.totDispOp)}</td>
                  <td className="px-3 py-2 text-right">
                    <span className={`font-mono text-sm font-bold ${semana.totDiferencia > 0 ? "text-orange-400" : semana.totDiferencia < 0 ? "text-blue-400" : "text-green-400"}`}>
                      {semana.totDiferencia > 0 ? "+" : ""}{fmt(semana.totDiferencia)}
                    </span>
                  </td>
                  <td className="px-2 py-2" colSpan={3}></td>
                </tr>
              </tbody>
            </table>
          </CardContent>
        </Card>
      ))}

      <Dialog open={!!editRow} onOpenChange={(open) => !open && setEditRow(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Editar auditoría PULSE</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-lg border border-border bg-muted/20 p-3 text-sm">
              <p className="font-semibold">{editForm.operadora || editRow?.operadora || "-"}</p>
              <p className="text-xs text-muted-foreground">
                {editRow?.sucursal || "-"} · Cabina {editRow?.cabina || "-"} · Equipo {editRow?.equipo || "-"}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5 col-span-2">
                <Label>Operador</Label>
                <Select value={editForm.operadora} onValueChange={value => setEditForm({ ...editForm, operadora: value })}>
                  <SelectTrigger><SelectValue placeholder="Seleccionar operador" /></SelectTrigger>
                  <SelectContent>
                    {operadorasEditables.map(operadora => (
                      <SelectItem key={operadora} value={operadora}>{operadora}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Pulsos inicio</Label>
                <Input type="number" value={editForm.pulsosInicio} onChange={e => setEditForm({ ...editForm, pulsosInicio: Number(e.target.value) || 0 })} />
              </div>
              <div className="space-y-1.5">
                <Label>Pulsos fin</Label>
                <Input type="number" value={editForm.pulsosFin} onChange={e => setEditForm({ ...editForm, pulsosFin: Number(e.target.value) || 0 })} />
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label>Disp. operador</Label>
                <Input type="number" value={editForm.dispOperador} onChange={e => setEditForm({ ...editForm, dispOperador: Number(e.target.value) || 0 })} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditRow(null)}><X className="h-4 w-4 mr-2" />Cancelar</Button>
            <Button onClick={saveEdit}><Save className="h-4 w-4 mr-2" />Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Leyenda */}
      <Card className="bg-muted/20">
        <CardContent className="py-3 px-4">
          <div className="flex flex-wrap gap-6 text-xs">
            <div className="flex items-center gap-1.5"><CheckCircle className="h-3 w-3 text-green-500" /><span className="text-green-400 font-semibold">OK</span> — Diferencia ≤ 5%</div>
            <div className="flex items-center gap-1.5"><AlertTriangle className="h-3 w-3 text-yellow-500" /><span className="text-yellow-400 font-semibold">Advertencia</span> — 5–15%</div>
            <div className="flex items-center gap-1.5"><XCircle className="h-3 w-3 text-red-500" /><span className="text-red-400 font-semibold">Crítico</span> — &gt;15%</div>
            <div className="flex items-center gap-1.5"><TrendingUp className="h-3 w-3 text-orange-400" /><span className="text-orange-400">Positivo</span> = operador reporta más</div>
            <div className="flex items-center gap-1.5"><TrendingDown className="h-3 w-3 text-blue-400" /><span className="text-blue-400">Negativo</span> = uso sin registro</div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
