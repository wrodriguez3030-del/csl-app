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
import { Activity, Download, CheckCircle, AlertTriangle, XCircle, TrendingUp, TrendingDown, Upload, FileSpreadsheet, Pencil, Save, X, Trash2, Loader2, FileText } from "lucide-react"
import { printAuditoria, type AuditoriaPdfSnapshot } from "@/lib/pulse-auditoria-pdf"
import { useCurrentBusiness } from "@/hooks/use-current-business"
import { getBusinessBranding } from "@/lib/business"
import { fmtN } from "@/lib/fmt"
import { makeAgendaMatchKey, normalizeSucursal as canonicalSucursal } from "@/lib/normalize-pulse"
import { signedColorClass, signedColorClassDark, signedIcon, getAlerta as getAlertaShared, alertaBadge as alertaBadgeShared } from "@/lib/pulse-colors"

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

// getAlerta / alertaBadge re-exportadas desde lib/pulse-colors para
// consistencia con el resto del módulo. Se conservan los nombres locales.
const getAlerta = getAlertaShared
const alertaBadge = alertaBadgeShared

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
  const business = useCurrentBusiness()
  const [filterSuc, setFilterSuc] = useState("todas")
  const [filterSemana, setFilterSemana] = useState("todas")
  const [sortCol, setSortCol] = useState<string>("")
  const [sortDir, setSortDir] = useState<"asc"|"desc">("asc")
  const [editRow, setEditRow] = useState<any | null>(null)
  const [editForm, setEditForm] = useState({ operadora: "", pulsosInicio: 0, pulsosFin: 0, dispOperador: 0, observaciones: "" })
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

  // Agrupar por semana, alimentado por:
  //   1) csl_pulse_readings (canónico, multi-tenant filtrado en backend)
  //   2) Fallback: lecturasSemanales legacy para períodos sin pulseReadings
  // disp_operador: si el reading lo trae (poblado por Cuadre semanal), se usa;
  // si no, se suma desde sesionesCliente para ese período + equipo.
  const semanas = useMemo(() => {
    const map: Record<string, any[]> = {}
    const seenKeys = new Set<string>() // period|equipo|sucursal|cabina

    // ── 1) Fuente PRIMARIA: csl_pulse_readings ────────────────────────────
    for (const r of (dbPulsos.pulseReadings ?? [])) {
      const desde = String(r.period_start || "").split("T")[0].trim()
      if (!desde || !/^\d{4}-\d{2}-\d{2}$/.test(desde)) continue
      const hasta = String(r.period_end || "").split("T")[0].trim() || desde

      // disp_operador con jerarquía de fuentes:
      //   1) reading.disp_operador (lo poblado por Cuadre semanal)
      //   2) csl_operator_shots (match exacto por período + sucursal_norm + op_norm)
      //   3) Fallback final: sumar csl_sesiones_cliente por rango + match key
      // Cada fuente filtra estrictamente por la misma semana y sucursal+operadora.
      let dispOperador = Number(r.disp_operador) || 0
      const matchKey = makeAgendaMatchKey(r.sucursal, r.operadora)
      if (dispOperador === 0 && matchKey) {
        const [sucNorm, opNorm] = matchKey.split("|")
        // Intento 2: operator_shots
        const shot = (dbPulsos.operatorShots ?? []).find(
          os =>
            String(os.period_start).slice(0, 10) === desde &&
            String(os.period_end).slice(0, 10) === hasta &&
            String(os.sucursal_normalizada || "").toUpperCase() === sucNorm &&
            String(os.operadora_normalizada || "").toUpperCase() === opNorm,
        )
        if (shot) {
          dispOperador = Number(shot.disparos) || 0
        } else {
          // Intento 3: sesiones individuales
          const sum = dbPulsos.sesionesCliente.reduce((acc, s) => {
            const sKey = makeAgendaMatchKey(s.Sucursal, s.OperadoraID)
            if (!sKey || sKey !== matchKey) return acc
            const fechaSesion = String(s.Fecha || "").split("T")[0].trim()
            if (!fechaSesion || fechaSesion < desde || fechaSesion > hasta) return acc
            return acc + (Number(s.DisparosReportados) || 0)
          }, 0)
          dispOperador = sum
        }
      }

      const dispLaser = Number(r.disp_laser) || Math.max(0, (Number(r.lectura_final) || 0) - (Number(r.lectura_inicial) || 0))
      const diferencia = dispOperador - dispLaser
      const pct = dispLaser > 0 ? Math.round((diferencia / dispLaser) * 100) : 0

      if (!map[desde]) map[desde] = []
      const cabinaRaw = String(r.cabina || "").trim()
      map[desde].push({
        lecturaId: r.id,
        sourceTable: "pulse_readings",
        fechaSemana: desde,
        fechaFin: hasta,
        sucursal: canonicalSucursal(r.sucursal) || r.sucursal || "",
        cabina: cabinaRaw.replace(/^Cabina\s*/i, ""),
        cabinaRaw,
        operadora: r.operadora || "",
        equipo: r.equipo_id || "",
        serial: r.serial || "",
        pulsosInicio: Number(r.lectura_inicial) || 0,
        pulsosFin: Number(r.lectura_final) || 0,
        dispLaser,
        dispOperador,
        diferencia,
        pct,
        alerta: getAlerta(pct),
        observaciones: String(r.observaciones || ""),
      })

      const key = `${desde}|${r.equipo_id}|${canonicalSucursal(r.sucursal)}|${cabinaRaw}`
      seenKeys.add(key)
    }

    // ── 2) Fallback LEGACY: lecturasSemanales para combinaciones sin reading
    for (const lec of dbPulsos.lecturasSemanales) {
      const desde = String(lec.FechaSemana || "").split("T")[0].trim()
      if (!desde || !/^\d{4}-\d{2}-\d{2}$/.test(desde)) continue
      const cabinaRaw = String(lec.Cabina || "").trim()
      const key = `${desde}|${lec.EquipoID || ""}|${canonicalSucursal(lec.Sucursal || "")}|${cabinaRaw}`
      if (seenKeys.has(key)) continue // ya cubierto por pulseReadings

      const d = new Date(desde + "T12:00:00")
      if (isNaN(d.getTime())) continue
      const dEnd = new Date(d); dEnd.setDate(dEnd.getDate() + 6)
      const hasta = dEnd.toISOString().split("T")[0]

      const manualId = auditManualSessionId(desde, lec.Sucursal || "", lec.EquipoID || "", lec.OperadoraID || "", lec.Cabina || "")
      const manualSesion = dbPulsos.sesionesCliente.find(s => s.SesionID === manualId)
      const sesiones = dbPulsos.sesionesCliente.filter(s => {
        if (s.SesionID === manualId) return false
        const mismaSucursal = normalizeSucursal(s.Sucursal) === normalizeSucursal(lec.Sucursal)
        const mismaCabina = normalizeCabina(s.Cabina) === normalizeCabina(lec.Cabina)
        const mismoEquipo = normalizeEquipo(s.EquipoID) === normalizeEquipo(lec.EquipoID)
        const fechaSesion = String(s.Fecha || "").split("T")[0].trim()
        return mismaSucursal && mismaCabina && mismoEquipo && fechaSesion >= desde && fechaSesion <= hasta
      })
      const dispLaser = Number(lec.DiferenciaReal) || 0
      const dispOperador = manualSesion
        ? Number(manualSesion.DisparosReportados) || 0
        : sesiones.reduce((sum, s) => sum + (Number(s.DisparosReportados) || 0), 0)
      const diferencia = dispOperador - dispLaser
      const pct = dispLaser > 0 ? Math.round((diferencia / dispLaser) * 100) : 0

      if (!map[desde]) map[desde] = []
      map[desde].push({
        lecturaId: lec.LecturaID,
        sourceTable: "lecturas_semanales",
        fechaSemana: desde,
        sucursal: lec.Sucursal || "",
        cabina: cabinaRaw.replace(/^Cabina\s*/i, ""),
        cabinaRaw,
        operadora: lec.OperadoraID || "",
        equipo: lec.EquipoID || "",
        serial: lec.Observaciones || "",
        pulsosInicio: Number(lec.LecturaInicial) || 0,
        pulsosFin: Number(lec.LecturaFinal) || 0,
        dispLaser,
        dispOperador,
        diferencia,
        pct,
        alerta: getAlerta(pct),
      })
    }

    // Ordenar semanas de más reciente a más antigua
    return Object.entries(map)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([fecha, rows]) => {
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
  }, [dbPulsos.pulseReadings, dbPulsos.lecturasSemanales, dbPulsos.sesionesCliente])

  const semanasDisponibles = semanas.map(s => s.fecha)
  const sucursales = Array.from(new Set([
    ...((dbPulsos.pulseReadings ?? []).map(r => canonicalSucursal(r.sucursal) || r.sucursal).filter(Boolean)),
    ...dbPulsos.lecturasSemanales.map(l => l.Sucursal).filter(Boolean),
  ]))

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

  /** Exporta PDF profesional vía window.print() sobre HTML formal.
   *  Respeta los filtros activos (semana + sucursal) y los rangos
   *  ordenados por fecha descendente como la tabla de pantalla. */
  const exportPdf = () => {
    if (!filtered.length) {
      showToast("No hay datos para exportar", "error")
      return
    }
    const snapshot: AuditoriaPdfSnapshot = {
      semanas: filtered.map(s => ({
        fecha: s.fecha,
        rows: s.rows.map((r: any) => ({
          sucursal: String(r.sucursal || ""),
          cabina: String(r.cabina || ""),
          operadora: String(r.operadora || ""),
          equipo: String(r.equipo || ""),
          pulsosInicio: Number(r.pulsosInicio) || 0,
          pulsosFin: Number(r.pulsosFin) || 0,
          dispLaser: Number(r.dispLaser) || 0,
          dispOperador: Number(r.dispOperador) || 0,
          diferencia: Number(r.diferencia) || 0,
          pct: Number(r.pct) || 0,
          alerta: r.alerta,
        })),
        totPulsosInicio: s.totPulsosInicio,
        totPulsosFin: s.totPulsosFin,
        totDispLaser: s.totDispLaser,
        totDispOp: s.totDispOp,
        totDiferencia: s.totDiferencia,
      })),
      filtroSemana: filterSemana === "todas" ? "Todas" : fmtSemanaRango(filterSemana),
      filtroSucursal: filterSuc === "todas" ? "Todas" : filterSuc,
      generadoEn: new Date().toLocaleString("es-DO", {
        day: "2-digit", month: "long", year: "numeric",
        hour: "2-digit", minute: "2-digit",
      }),
      branding: getBusinessBranding(business),
    }
    try {
      printAuditoria(snapshot)
    } catch (err) {
      showToast(
        "No se pudo abrir el PDF (revisa el bloqueo de popups del navegador): " +
          (err instanceof Error ? err.message : String(err)),
        "error",
      )
    }
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

  const [deletingId, setDeletingId] = useState<string | null>(null)

  const handleDelete = async (row: any) => {
    if (row.sourceTable === "pulse_readings") {
      if (!confirm(
        `¿Eliminar esta lectura?\n\n` +
        `Equipo ${row.equipo} · ${row.sucursal} · ${row.operadora}\n` +
        `Semana ${row.fechaSemana}\n\n` +
        `Esto borra también la fila de Lecturas Semanales (csl_pulse_readings). ` +
        `El resumen de operadora en csl_operator_shots se mantiene.`
      )) return
      setDeletingId(row.lecturaId)
      try {
        const { apiJsonp, normalizeApiUrl } = await import("@/lib/store")
        await apiJsonp(normalizeApiUrl(apiUrl), { action: "deletePulseReading", id: row.lecturaId })
        setDbPulsos({
          ...dbPulsos,
          pulseReadings: (dbPulsos.pulseReadings ?? []).filter(p => p.id !== row.lecturaId),
        })
        showToast("Lectura eliminada", "success")
      } catch (err) {
        showToast("Error al eliminar: " + (err instanceof Error ? err.message : String(err)), "error")
      } finally {
        setDeletingId(null)
      }
    } else {
      // Legacy lecturasSemanales
      if (!confirm(
        `¿Eliminar esta lectura legacy?\n\n` +
        `Equipo ${row.equipo} · ${row.sucursal}\n` +
        `Semana ${row.fechaSemana}`
      )) return
      setDeletingId(row.lecturaId)
      try {
        await syncApi({ action: "deleteLectura", id: row.lecturaId })
        setDbPulsos({
          ...dbPulsos,
          lecturasSemanales: dbPulsos.lecturasSemanales.filter(l => l.LecturaID !== row.lecturaId),
        })
        showToast("Lectura eliminada", "success")
      } catch (err) {
        showToast("Error al eliminar: " + (err instanceof Error ? err.message : String(err)), "error")
      } finally {
        setDeletingId(null)
      }
    }
  }

  const openEdit = (row: any) => {
    setEditRow(row)
    setEditForm({
      operadora: String(row.operadora || ""),
      pulsosInicio: Number(row.pulsosInicio) || 0,
      pulsosFin: Number(row.pulsosFin) || 0,
      dispOperador: Number(row.dispOperador) || 0,
      observaciones: String(row.observaciones || ""),
    })
  }

  /** Llama el endpoint /api/csl con manejo real de errores y retorno tipado.
   *  syncApi() silencia errores — no usarlo para escrituras críticas. */
  const apiCallTyped = async (params: Record<string, string>): Promise<Record<string, unknown>> => {
    const { apiJsonp, normalizeApiUrl } = await import("@/lib/store")
    const res = await apiJsonp(normalizeApiUrl(apiUrl), params) as Record<string, unknown>
    if (!res || res.ok === false) {
      const errMsg = String((res as { error?: string })?.error || "Error desconocido del servidor")
      throw new Error(errMsg)
    }
    return res
  }

  const saveEdit = async () => {
    if (!editRow) return

    // RAMA 1: la fila viene de csl_pulse_readings (caso normal post-refactor).
    // Actualizamos via savePulseReading pasando el id → upsert por
    // (business_id, equipo_id, period_start, period_end).
    if (editRow.sourceTable === "pulse_readings") {
      const reading = (dbPulsos.pulseReadings ?? []).find(r => r.id === editRow.lecturaId)
      if (!reading) {
        showToast("No se encontró la lectura en csl_pulse_readings", "error")
        return
      }
      // Advertencia: lectura final < inicial (cambio de equipo / reset / error).
      // No se guarda en silencio: exige una observación que lo justifique.
      if (editForm.pulsosFin < editForm.pulsosInicio && !editForm.observaciones.trim()) {
        showToast("La lectura final es menor que la inicial. Verifica si hubo cambio de equipo, reset o error de lectura. Agrega una observación para poder guardar.", "error")
        return
      }
      const dispLaser = Math.max(0, editForm.pulsosFin - editForm.pulsosInicio)
      const payload: Record<string, string | number> = {
        id: reading.id,
        equipo_id: reading.equipo_id,
        serial: reading.serial || "",
        sucursal: reading.sucursal,
        cabina: reading.cabina || "",
        operadora: editForm.operadora,
        period_start: reading.period_start,
        period_end: reading.period_end,
        period_label: reading.period_label || "",
        lectura_inicial: editForm.pulsosInicio,
        lectura_final: editForm.pulsosFin,
        estado_cuadre: reading.estado_cuadre || "lectura_guardada",
        estado_mantenimiento: reading.estado_mantenimiento || "",
        fallas: reading.fallas || "",
        source_file: reading.source_file || "",
        source_type: reading.source_type || "manual",
        observaciones: editForm.observaciones || reading.observaciones || "",
      }
      if (editForm.dispOperador > 0) {
        payload.disp_operador = editForm.dispOperador
        if (dispLaser > 0) {
          payload.diferencia_pct = Math.round(((editForm.dispOperador - dispLaser) / dispLaser) * 10000) / 100
        }
      }

      try {
        const res = await apiCallTyped({
          action: "savePulseReading",
          data: JSON.stringify(payload),
        })
        const updated = res.record as typeof reading | undefined
        if (!updated) { showToast("El servidor no confirmó la actualización (0 filas). Revisa permisos/clave.", "error"); return }
        // Actualizar store con el record del servidor (incluye disp_laser
        // que es columna generada) o fallback a los valores locales.
        setDbPulsos({
          ...dbPulsos,
          pulseReadings: (dbPulsos.pulseReadings ?? []).map(r =>
            r.id === reading.id
              ? (updated ?? {
                  ...r,
                  operadora: editForm.operadora,
                  lectura_inicial: editForm.pulsosInicio,
                  lectura_final: editForm.pulsosFin,
                  disp_laser: dispLaser,
                  disp_operador: editForm.dispOperador > 0 ? editForm.dispOperador : r.disp_operador,
                })
              : r,
          ),
        })
        showToast("Guardado correctamente", "success")
        setEditRow(null)
      } catch (err) {
        showToast(`Error al guardar: ${err instanceof Error ? err.message : String(err)}`, "error")
      }
      return
    }

    // RAMA 2 (legacy): la fila viene de lecturasSemanales. Mantenemos el
    // comportamiento anterior — actualiza saveLectura + sesiones manuales.
    const lectura = dbPulsos.lecturasSemanales.find(item => item.LecturaID === editRow.lecturaId)
    if (!lectura) {
      showToast("No se encontró la lectura para editar", "error")
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
      Cliente: "Ajuste auditoría",
      AreaTrabajada: "PULSE",
      DisparosReportados: editForm.dispOperador,
      Duracion: undefined,
      EquipoID: editRow.equipo,
      Observaciones: "Ajuste manual Auditoría PULSE",
    }

    try {
      await apiCallTyped({ action: "saveLectura", data: JSON.stringify(updatedLectura) })
      if (oldManualId !== manualId) {
        try { await apiCallTyped({ action: "deleteSesion", id: oldManualId }) }
        catch { /* la sesión manual previa puede no existir, no es error */ }
      }
      for (const sesion of relatedSessions) {
        await apiCallTyped({ action: "saveSesion", data: JSON.stringify(sesion) })
      }
      await apiCallTyped({ action: "saveSesion", data: JSON.stringify(manualSesion) })

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
      showToast("Auditoría actualizada en todo el sistema", "success")
      setEditRow(null)
    } catch (err) {
      showToast(`Error al guardar: ${err instanceof Error ? err.message : String(err)}`, "error")
    }
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
              ({(dbPulsos.pulseReadings?.length ?? 0) + dbPulsos.lecturasSemanales.length} lecturas semanales · {dbPulsos.sesionesCliente.length} sesiones AgendaPro · {dbPulsos.operadoras.length} operadoras)
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
          <Button
            variant="outline"
            size="sm"
            onClick={exportPdf}
            disabled={!filtered.length}
            className="bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100"
          >
            <FileText className="h-4 w-4 mr-2" />Exportar PDF
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
            <p className="text-lg font-bold font-mono">{fmtN(kpis.totLaser)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-3 pb-2 text-center">
            <p className="text-[10px] text-muted-foreground uppercase">Disp. Operador</p>
            <p className="text-lg font-bold font-mono">{fmtN(kpis.totOp)}</p>
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
                    <td className="px-3 py-2 text-right font-mono text-xs text-muted-foreground">{r.pulsosInicio > 0 ? fmtN(r.pulsosInicio) : "-"}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-muted-foreground">{r.pulsosFin > 0 ? fmtN(r.pulsosFin) : "-"}</td>
                    <td className="px-3 py-2 text-right font-mono text-sm font-bold">{fmtN(r.dispLaser)}</td>
                    <td className="px-3 py-2 text-right font-mono text-sm font-bold">{fmtN(r.dispOperador)}</td>
                    <td className="px-3 py-2 text-right">
                      {(() => {
                        const Icon = signedIcon(r.diferencia)
                        return (
                          <span className={`font-mono text-sm font-bold inline-flex items-center gap-1 ${signedColorClass(r.diferencia)}`}>
                            {Icon ? <Icon className="h-3 w-3" /> : null}
                            {r.diferencia > 0 ? "+" : ""}{fmtN(r.diferencia)}
                          </span>
                        )
                      })()}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <span className={`font-mono text-xs font-bold ${signedColorClass(r.pct)}`}>
                        {r.pct > 0 ? "+" : ""}{r.pct}%
                      </span>
                    </td>
                    <td className="px-2 py-2 text-center">{alertaBadge(r.alerta)}</td>
                    <td className="px-2 py-2 text-center">
                      <div className="flex items-center justify-center gap-0.5">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(r)} title="Editar">
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-red-500 hover:text-red-600 hover:bg-red-50"
                          onClick={() => handleDelete(r)}
                          disabled={deletingId === r.lecturaId}
                          title="Eliminar"
                        >
                          {deletingId === r.lecturaId
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <Trash2 className="h-3.5 w-3.5" />}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {/* Fila TOTAL */}
                <tr className="bg-muted/40 border-t-2 border-primary/30 font-bold">
                  <td className="px-3 py-2 text-xs" colSpan={5}>TOTAL</td>
                  <td className="px-3 py-2 text-right font-mono text-xs">{semana.totPulsosInicio > 0 ? fmtN(semana.totPulsosInicio) : "-"}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs">{semana.totPulsosFin > 0 ? fmtN(semana.totPulsosFin) : "-"}</td>
                  <td className="px-3 py-2 text-right font-mono text-sm text-primary">{fmtN(semana.totDispLaser)}</td>
                  <td className="px-3 py-2 text-right font-mono text-sm text-primary">{fmtN(semana.totDispOp)}</td>
                  <td className="px-3 py-2 text-right">
                    <span className={`font-mono text-sm font-bold ${signedColorClassDark(semana.totDiferencia)}`}>
                      {semana.totDiferencia > 0 ? "+" : ""}{fmtN(semana.totDiferencia)}
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
              <div className="space-y-1.5 col-span-2">
                <Label>Observaciones {editForm.pulsosFin < editForm.pulsosInicio ? <span className="text-amber-500">(obligatoria)</span> : null}</Label>
                <Input value={editForm.observaciones} onChange={e => setEditForm({ ...editForm, observaciones: e.target.value })} placeholder="Cambio de equipo, reset, corrección de lectura…" />
              </div>
            </div>
            {editForm.pulsosFin < editForm.pulsosInicio && (
              <div className="mt-3 rounded-md border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-600 dark:text-amber-300">
                ⚠ La lectura final ({fmtN(editForm.pulsosFin)}) es menor que la inicial ({fmtN(editForm.pulsosInicio)}). Verifica si hubo cambio de equipo, reset o error de lectura. Agrega una observación para poder guardar.
              </div>
            )}
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
            <div className="flex items-center gap-1.5"><TrendingUp className="h-3 w-3 text-blue-500" /><span className="text-blue-500">Positivo</span> = operador reporta más</div>
            <div className="flex items-center gap-1.5"><TrendingDown className="h-3 w-3 text-red-500" /><span className="text-red-500">Negativo</span> = uso sin registro</div>
            <div className="flex items-center gap-1.5"><span className="text-emerald-500 font-semibold">Cero</span> = cuadre exacto</div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
