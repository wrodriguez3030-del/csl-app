"use client"

import { useEffect, useMemo, useState } from "react"
import { apiCall, normalizeApiUrl, useAppStore } from "@/lib/store"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { EmployeeSelect } from "@/components/hr/employee-select"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Plane, Plus, Pencil, Trash2, Save, X, Loader2, Check, Ban, AlertCircle, Calculator, FileSpreadsheet, DollarSign } from "lucide-react"
import { useCurrentBusiness } from "@/hooks/use-current-business"
import { exportVacacionesExcel, type VacacionExcelRow } from "@/lib/hr-vacaciones-excel"
import { useTableSort, sortRows, SortLabel, estadoRank } from "@/lib/table-sort"

const DAILY_BASE = 23.83

interface Vacation {
  id: string; employee_id: string; employee_nombre: string | null; periodo: string | null
  dias: number; fecha_inicio: string | null; fecha_fin: string | null
  sueldo_diario: number; monto: number; status: string; observations: string | null
  // Columnas legales (202606050002) — opcionales si el DDL aún no se aplicó.
  sueldo_mensual?: number; fecha_ingreso?: string | null; antiguedad_anios?: number
  dias_legales?: number; cedula?: string | null; puesto?: string | null; sucursal?: string | null
}

interface Emp { id: string; nombre: string; cedula: string; puesto: string; sucursal: string; sueldo: number; fecha_ingreso: string }

const ESTADOS = ["borrador", "solicitada", "en_revision", "aprobada", "pagada", "anulada"]
const ESTADO_LABEL: Record<string, string> = {
  borrador: "Borrador", solicitada: "Solicitada", en_revision: "En revisión", aprobada: "Aprobada", pagada: "Pagada", anulada: "Anulada",
  pendiente: "Pendiente de calcular", incompleto: "Incompleto",
}
const ESTADO_CLASS: Record<string, string> = {
  borrador: "bg-slate-100 text-slate-700 border-slate-200",
  solicitada: "bg-amber-100 text-amber-700 border-amber-200",
  en_revision: "bg-blue-100 text-blue-700 border-blue-200",
  aprobada: "bg-emerald-100 text-emerald-700 border-emerald-200",
  pagada: "bg-indigo-100 text-indigo-700 border-indigo-200",
  anulada: "bg-gray-100 text-gray-500 border-gray-200",
  pendiente: "bg-slate-100 text-slate-600 border-slate-200",
  incompleto: "bg-amber-100 text-amber-700 border-amber-200",
}
// Estados legados (masculino) → canónicos nuevos.
const LEGACY: Record<string, string> = { solicitado: "solicitada", aprobado: "aprobada", pagado: "pagada", anulado: "anulada" }
const normEstado = (s: string) => LEGACY[s] || s

const rd = (n: number) => `RD$ ${(Number(n) || 0).toLocaleString("es-DO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100

/** Antigüedad en años (decimal) entre fecha de ingreso y una fecha de referencia. */
function antiguedadAnios(fechaIngreso?: string, refStr?: string): number {
  if (!fechaIngreso) return 0
  const ing = Date.parse(`${fechaIngreso}T00:00:00Z`)
  const ref = refStr ? Date.parse(`${refStr}T00:00:00Z`) : Date.now()
  if (!Number.isFinite(ing) || !Number.isFinite(ref)) return 0
  const years = (ref - ing) / (365.25 * 24 * 3600 * 1000)
  return years > 0 ? years : 0
}
/** Días de vacaciones legales RD: <1 año = 0, 1–<5 = 14, ≥5 = 18. */
const diasLegalesRD = (anios: number) => (anios >= 5 ? 18 : anios >= 1 ? 14 : 0)
const fmtAntig = (anios: number) => `${(Number(anios) || 0).toFixed(1)} años`

const pick = (...vals: unknown[]) => { for (const v of vals) { const s = v == null ? "" : String(v).trim(); if (s) return s } return "" }
function toEmp(r: Record<string, unknown>): Emp {
  return {
    id: pick(r.SolicitudID, r.empleado_id, r.EmpleadoID, r.id),
    nombre: `${pick(r.Nombre, r.nombre)} ${pick(r.Apellido, r.apellido)}`.replace(/\s+/g, " ").trim() || pick(r.SolicitudID, r.empleado_id),
    cedula: pick(r.Cedula, r.cedula),
    puesto: pick(r.PuestoSolicitado, r.puesto_solicitado, r.Puesto, r.puesto),
    sucursal: pick(r.Sucursal, r.sucursal),
    fecha_ingreso: pick(r.fechaIngresoLaboral, r.FechaIngresoLaboral, r.fecha_ingreso, r.FechaSolicitud, r.fecha_solicitud),
    sueldo: Number(r.Salario ?? r.salario ?? 0) || 0,
  }
}

export function RrhhVacacionesPage() {
  const { apiUrl, showToast } = useAppStore()
  const business = useCurrentBusiness()
  const [records, setRecords] = useState<Vacation[]>([])
  const [empMap, setEmpMap] = useState<Record<string, Emp>>({})
  const [tableMissing, setTableMissing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Partial<Vacation> | null>(null)
  const [busy, setBusy] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [calcing, setCalcing] = useState(false)
  // Filtros
  const [fEstado, setFEstado] = useState("all")
  const [fSucursal, setFSucursal] = useState("all")
  const [fDesde, setFDesde] = useState("")
  const [fHasta, setFHasta] = useState("")
  const [fEmpleado, setFEmpleado] = useState("")
  const [year, setYear] = useState(String(new Date().getFullYear()))
  const [calcAll, setCalcAll] = useState(false)

  const call = (params: Record<string, string | number | boolean>) => apiCall(normalizeApiUrl(apiUrl), params)

  const reload = async () => {
    setLoading(true)
    try {
      const [vac, emp] = await Promise.all([
        call({ action: "getHrVacations" }) as Promise<{ ok?: boolean; records?: Vacation[]; tableMissing?: boolean }>,
        call({ action: "getEmpleados" }) as Promise<{ ok?: boolean; records?: Record<string, unknown>[] }>,
      ])
      setTableMissing(Boolean(vac?.tableMissing)); setRecords(vac?.records ?? [])
      const map: Record<string, Emp> = {}
      for (const r of (emp?.records ?? [])) { const e = toEmp(r); if (e.id) map[e.id] = e }
      setEmpMap(map)
    } catch (err) { showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error") } finally { setLoading(false) }
  }
  useEffect(() => { reload() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Enriquecer: UNA fila por empleado activo del tenant para el año, fusionando
  // su registro de vacaciones si existe; si no, "Pendiente de calcular".
  // Así SIEMPRE salen todos los empleados, tengan o no cálculo.
  const enriched = useMemo(() => {
    const refStr = `${year}-12-31`
    const recByEmp = new Map<string, Vacation>()
    for (const r of records) {
      if (year && String(r.periodo || "") !== year) continue
      if (!recByEmp.has(r.employee_id)) recByEmp.set(r.employee_id, r)
    }
    const build = (e: Emp | null, r: Vacation | undefined) => {
      const fechaIngreso = pick(r?.fecha_ingreso, e?.fecha_ingreso)
      const anios = r?.antiguedad_anios != null ? Number(r.antiguedad_anios) : antiguedadAnios(fechaIngreso, refStr)
      const diasLegales = r?.dias_legales != null ? Number(r.dias_legales) : diasLegalesRD(anios)
      const sueldoMensual = (r?.sueldo_mensual != null && Number(r.sueldo_mensual) > 0) ? Number(r.sueldo_mensual) : (e?.sueldo || 0)
      const sueldoDiario = (r?.sueldo_diario != null && Number(r.sueldo_diario) > 0) ? Number(r.sueldo_diario) : round2(sueldoMensual / DAILY_BASE)
      const incompleto = !fechaIngreso || !(sueldoMensual > 0)
      const dias = r ? Number(r.dias) || 0 : diasLegales
      return {
        ...(r || ({} as Vacation)),
        id: r?.id || "",
        employee_id: e?.id || r?.employee_id || "",
        _hasRecord: !!r,
        _nombre: r?.employee_nombre || e?.nombre || r?.employee_id || "",
        _cedula: pick(r?.cedula, e?.cedula),
        _puesto: pick(r?.puesto, e?.puesto),
        _sucursal: pick(r?.sucursal, e?.sucursal),
        _fecha_ingreso: fechaIngreso,
        _antiguedad: anios,
        _dias_legales: diasLegales,
        _sueldo_mensual: sueldoMensual,
        dias,
        monto: r ? Number(r.monto) || 0 : round2(sueldoDiario * diasLegales),
        sueldo_diario: sueldoDiario,
        _estado: r ? normEstado(r.status) : (incompleto ? "incompleto" : "pendiente"),
      }
    }
    const rows = Object.values(empMap).map(e => build(e, recByEmp.get(e.id)))
    // Registros de empleados que ya no están en la lista activa (legacy) — incluir.
    for (const [eid, r] of recByEmp) { if (!empMap[eid]) rows.push(build(null, r)) }
    return rows
  }, [records, empMap, year])

  const sucursales = useMemo(() => Array.from(new Set(enriched.map(r => r._sucursal).filter(Boolean))).sort(), [enriched])

  const filtered = useMemo(() => enriched.filter(r => {
    if (fEstado !== "all" && r._estado !== fEstado) return false
    if (fSucursal !== "all" && r._sucursal !== fSucursal) return false
    if (fEmpleado && r.employee_id !== fEmpleado) return false
    const ref = r.fecha_inicio || ""
    if (fDesde && (!ref || ref < fDesde)) return false
    if (fHasta && (!ref || ref > fHasta)) return false
    return true
  }), [enriched, fEstado, fSucursal, fEmpleado, fDesde, fHasta])

  const { sort, toggle } = useTableSort("sucursal")
  const sorted = useMemo(() => sortRows(filtered, sort, {
    no: (r) => `${r._sucursal}|${r._nombre}`.toLowerCase(),
    empleado: (r) => (r._nombre || "").toLowerCase(),
    sucursal: (r) => `${r._sucursal}|${r._nombre}`.toLowerCase(),
    antiguedad: (r) => Number(r._antiguedad) || 0,
    legales: (r) => Number(r._dias_legales) || 0,
    solic: (r) => Number(r.dias) || 0,
    monto: (r) => Number(r.monto) || 0,
    estado: (r) => estadoRank(r._estado),
  }), [filtered, sort])

  const counts = useMemo(() => ({
    total: filtered.length,
    dias: filtered.reduce((s, r) => s + (Number(r.dias) || 0), 0),
    monto: filtered.reduce((s, r) => s + (Number(r.monto) || 0), 0),
    aprobadas: filtered.filter(r => r._estado === "aprobada" || r._estado === "pagada").length,
  }), [filtered])

  // Desglose en vivo del modal.
  const sueldoDiario = editing ? round2(Number(editing.sueldo_mensual || 0) / DAILY_BASE) : 0
  const montoCalc = editing ? round2(sueldoDiario * Number(editing.dias || 0)) : 0

  const calcularLegal = async (employeeId: string, fechaFin?: string) => {
    setCalcing(true)
    try {
      const res = await call({ action: "getHrVacacionSugerida", employee_id: employeeId, fecha_fin: fechaFin || "" }) as
        { ok?: boolean; employee_nombre?: string; cedula?: string; puesto?: string; sucursal?: string; fecha_ingreso?: string; sueldo_mensual?: number; sueldo_diario?: number; antiguedad_anios?: number; dias_legales?: number; error?: string }
      if (!res?.ok) { showToast(`Error: ${res?.error || "no se pudo calcular"}`, "error"); return }
      setEditing(prev => prev ? {
        ...prev,
        employee_id: employeeId,
        employee_nombre: res.employee_nombre ?? prev.employee_nombre,
        cedula: res.cedula ?? prev.cedula, puesto: res.puesto ?? prev.puesto, sucursal: res.sucursal ?? prev.sucursal,
        fecha_ingreso: res.fecha_ingreso ?? prev.fecha_ingreso,
        sueldo_mensual: res.sueldo_mensual ?? prev.sueldo_mensual,
        antiguedad_anios: res.antiguedad_anios ?? 0,
        dias_legales: res.dias_legales ?? 0,
        // Días solicitados por defecto = días legales (editable).
        dias: prev.id ? prev.dias : (res.dias_legales ?? prev.dias ?? 0),
      } : prev)
      showToast(`Antigüedad ${fmtAntig(res.antiguedad_anios ?? 0)} → ${res.dias_legales ?? 0} días legales · sueldo ${rd(res.sueldo_mensual ?? 0)}`, "success")
    } catch (err) { showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error") } finally { setCalcing(false) }
  }

  const buildPayload = (r: Partial<Vacation>): Record<string, string | number> => {
    const p: Record<string, string | number> = {
      employee_id: r.employee_id || "", employee_nombre: r.employee_nombre || "",
      dias: Number(r.dias || 0), status: r.status || "borrador",
      sueldo_mensual: Number(r.sueldo_mensual || 0),
      antiguedad_anios: Number(r.antiguedad_anios || 0), dias_legales: Number(r.dias_legales || 0),
    }
    if (r.id) p.id = r.id
    if (r.periodo) p.periodo = r.periodo
    if (r.fecha_inicio) p.fecha_inicio = r.fecha_inicio
    if (r.fecha_fin) p.fecha_fin = r.fecha_fin
    if (r.fecha_ingreso) p.fecha_ingreso = r.fecha_ingreso
    if (r.observations) p.observations = r.observations
    return p
  }

  const handleSave = async () => {
    if (!editing) return
    if (!editing.employee_id?.trim()) { showToast("Empleado obligatorio (selecciónalo de la lista)", "error"); return }
    if (!(Number(editing.dias) > 0)) { showToast("Los días deben ser mayores a 0", "error"); return }
    setBusy(true)
    try {
      const res = await call({ action: "saveHrVacation", data: JSON.stringify(buildPayload(editing)) }) as { ok?: boolean; error?: string; tableMissing?: boolean }
      if (res?.tableMissing) { showToast("Tabla hr_vacations aún no existe", "info"); setEditing(null); return }
      if (!res?.ok) { showToast(`Error: ${res?.error || "no se pudo guardar"}`, "error"); return }
      showToast("Vacación guardada", "success"); setEditing(null); reload()
    } catch (err) { showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error") } finally { setBusy(false) }
  }
  const setStatus = async (r: Vacation, status: string) => {
    setBusyId(r.id)
    try {
      const res = await call({ action: "saveHrVacation", data: JSON.stringify({ ...buildPayload(r), status }) }) as { ok?: boolean; error?: string }
      if (!res?.ok) { showToast(`Error: ${res?.error}`, "error"); return }
      showToast(`Estado: ${ESTADO_LABEL[status] || status}`, "success"); reload()
    } catch (err) { showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error") } finally { setBusyId(null) }
  }
  const del = async (id: string) => {
    if (!confirm("¿Eliminar esta vacación?") || !confirm("Confirma de nuevo: se eliminará permanentemente.")) return
    setBusyId(id)
    try { await call({ action: "deleteHrVacation", id }); setRecords(prev => prev.filter(r => r.id !== id)); showToast("Eliminado", "success") }
    catch (err) { showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error") } finally { setBusyId(null) }
  }

  const exportExcel = () => {
    const rows: VacacionExcelRow[] = filtered.map((r, i) => ({
      no: i + 1, empleado: r._nombre, cedula: r._cedula, puesto: r._puesto, sucursal: r._sucursal,
      fecha_ingreso: r._fecha_ingreso, antiguedad: fmtAntig(r._antiguedad),
      sueldo_mensual: r._sueldo_mensual, sueldo_diario: Number(r.sueldo_diario) || round2(r._sueldo_mensual / DAILY_BASE),
      dias_legales: r._dias_legales, dias_solicitados: Number(r.dias) || 0, monto: Number(r.monto) || 0,
      estado: ESTADO_LABEL[r._estado] || r._estado, observaciones: r.observations || "",
    }))
    const partes = [
      fEstado !== "all" ? `Estado: ${ESTADO_LABEL[fEstado]}` : "",
      fSucursal !== "all" ? `Sucursal: ${fSucursal}` : "",
      fEmpleado ? `Empleado: ${empMap[fEmpleado]?.nombre || fEmpleado}` : "",
      fDesde ? `Desde ${fDesde}` : "", fHasta ? `Hasta ${fHasta}` : "",
    ].filter(Boolean).join(" · ")
    exportVacacionesExcel(business, rows, partes)
    showToast(`Excel generado (${rows.length} fila(s))`, "success")
  }

  // Calcular vacaciones de TODOS los empleados activos del tenant para el año.
  // Upsert por (employee, año) sin duplicar; respeta pagadas; marca incompletos.
  const calcularTodos = async () => {
    setCalcAll(true)
    const refStr = `${year}-12-31`
    let creados = 0, actualizados = 0, omitidos = 0, incompletos = 0
    try {
      for (const e of Object.values(empMap)) {
        if (!e.fecha_ingreso || !(e.sueldo > 0)) { incompletos++; continue }
        const anios = antiguedadAnios(e.fecha_ingreso, refStr)
        const diasLegales = diasLegalesRD(anios)
        if (diasLegales <= 0) { incompletos++; continue } // menos de 1 año
        const existing = records.find(r => r.employee_id === e.id && String(r.periodo || "") === year)
        if (existing && normEstado(existing.status) === "pagada") { omitidos++; continue }
        await call({ action: "saveHrVacation", data: JSON.stringify({
          id: existing?.id,
          employee_id: e.id, employee_nombre: e.nombre, periodo: year,
          dias: diasLegales, sueldo_mensual: e.sueldo, fecha_ingreso: e.fecha_ingreso,
          antiguedad_anios: anios, dias_legales: diasLegales, fecha_fin: refStr,
          status: existing && normEstado(existing.status) !== "anulada" ? existing.status : "borrador",
        }) })
        if (existing) actualizados++; else creados++
      }
      showToast(`Año ${year}: ${creados} creados · ${actualizados} actualizados · ${omitidos} pagados omitidos · ${incompletos} incompletos`, "success")
      await reload()
    } catch (err) { showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error") }
    finally { setCalcAll(false) }
  }

  const generarTxt = async () => {
    setCalcAll(true)
    try {
      const res = await call({ action: "getHrVacacionesTxt", year }) as { ok?: boolean; content?: string; lineas?: number; total?: number; omitidos?: string[]; error?: string }
      if (!res?.ok) { showToast(res?.error || "No se pudo generar el TXT", "error"); return }
      if (!res.lineas) { showToast("No hay vacaciones aprobadas con cuenta bancaria para el TXT", "info"); return }
      const blob = new Blob([res.content || ""], { type: "text/plain;charset=utf-8" })
      const url = URL.createObjectURL(blob); const a = document.createElement("a")
      const emp = (business.shortName || business.name || "EMPRESA").toUpperCase().replace(/[^A-Z0-9]+/g, "_")
      a.href = url; a.download = `VACACIONES_${emp}_${year}.txt`
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url)
      showToast(`TXT generado: ${res.lineas} línea(s) · ${rd(res.total || 0)}${res.omitidos?.length ? ` · ${res.omitidos.length} sin cuenta omitidos` : ""}`, "success")
    } catch (err) { showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error") }
    finally { setCalcAll(false) }
  }

  const nuevo = () => setEditing({ periodo: String(new Date().getFullYear()), status: "borrador", dias: 0, sueldo_mensual: 0 })

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-primary/10 p-2.5 text-primary"><Plane className="h-6 w-6" /></div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">RR.HH. · Pagos · {business.shortName}</p>
            <h2 className="mt-0.5 text-xl font-black tracking-tight">Vacaciones</h2>
            <p className="mt-1 text-sm text-muted-foreground">Cálculo según Código de Trabajo RD: 14 días (1–5 años) · 18 días (≥5 años). Monto = sueldo diario (mensual ÷ {DAILY_BASE}) × días.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0 items-center">
          <div className="flex items-center gap-1">
            <Label className="text-xs">Año</Label>
            <select className="h-9 rounded-md border bg-background px-2 text-sm" value={year} onChange={e => setYear(e.target.value)}>
              {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i).map(y => <option key={y} value={String(y)}>{y}</option>)}
            </select>
          </div>
          <Button variant="outline" onClick={calcularTodos} disabled={calcAll}>{calcAll ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Calculator className="w-4 h-4 mr-1" />}Calcular todos</Button>
          <Button variant="outline" onClick={exportExcel}><FileSpreadsheet className="w-4 h-4 mr-1" />Exportar Excel</Button>
          <Button variant="outline" onClick={generarTxt} disabled={calcAll}><DollarSign className="w-4 h-4 mr-1" />Generar TXT bancario</Button>
          <Button onClick={nuevo}><Plus className="w-4 h-4 mr-1" />Nueva vacación</Button>
        </div>
      </div>

      {tableMissing && !loading && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex items-start gap-2">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-amber-600" /><div>La tabla <code className="text-xs bg-amber-100 px-1 rounded">hr_vacations</code> aún no existe. Aplica la migración <code className="text-xs bg-amber-100 px-1 rounded">202606020009_hr_vacations_christmas.sql</code>.</div>
        </div>
      )}

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Card><CardContent className="pt-4 pb-3 text-center"><div className="text-2xl font-bold text-primary">{counts.total}</div><div className="text-xs text-muted-foreground uppercase mt-1">Empleados</div></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><div className="text-2xl font-bold text-blue-600">{counts.dias}</div><div className="text-xs text-muted-foreground uppercase mt-1">Total días</div></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><div className="text-2xl font-bold text-emerald-600">{counts.aprobadas}</div><div className="text-xs text-muted-foreground uppercase mt-1">Aprob./Pag.</div></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><div className="text-lg font-bold text-emerald-700">{rd(counts.monto)}</div><div className="text-xs text-muted-foreground uppercase mt-1">Monto total</div></CardContent></Card>
      </div>

      {/* Filtros */}
      <Card><CardContent className="py-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1"><Label className="text-xs">Estado</Label>
            <Select value={fEstado} onValueChange={setFEstado}><SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">Todos</SelectItem>{ESTADOS.map(s => <SelectItem key={s} value={s}>{ESTADO_LABEL[s]}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1"><Label className="text-xs">Sucursal</Label>
            <Select value={fSucursal} onValueChange={setFSucursal}><SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">Todas</SelectItem>{sucursales.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1"><Label className="text-xs">Desde</Label><Input type="date" value={fDesde} onChange={e => setFDesde(e.target.value)} className="h-8 w-36" /></div>
          <div className="space-y-1"><Label className="text-xs">Hasta</Label><Input type="date" value={fHasta} onChange={e => setFHasta(e.target.value)} className="h-8 w-36" /></div>
          <div className="space-y-1 w-56"><Label className="text-xs">Empleado</Label>
            <div className="flex items-center gap-1"><EmployeeSelect value={fEmpleado} onSelect={emp => setFEmpleado(emp?.empleado_id || "")} placeholder="Todos" />
              {fEmpleado && <button type="button" className="text-xs text-muted-foreground underline shrink-0" onClick={() => setFEmpleado("")}>limpiar</button>}</div></div>
        </div>
      </CardContent></Card>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          {loading ? (
            <div className="py-10 text-center text-sm text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Cargando...</div>
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              {Object.keys(empMap).length === 0 ? "No hay empleados activos en este negocio." : "No hay empleados con estos filtros."}
              {(fEstado !== "all" || fSucursal !== "all" || fEmpleado || fDesde || fHasta) && (
                <div className="mt-2"><Button variant="outline" size="sm" onClick={() => { setFEstado("all"); setFSucursal("all"); setFEmpleado(""); setFDesde(""); setFHasta("") }}>Limpiar filtros</Button></div>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead className="text-xs w-10 text-center" onClick={() => toggle("no")}><SortLabel label="No." sortKey="no" sort={sort} /></TableHead>
                <TableHead className="text-xs" onClick={() => toggle("empleado")}><SortLabel label="Empleado" sortKey="empleado" sort={sort} /></TableHead>
                <TableHead className="text-xs" onClick={() => toggle("sucursal")}><SortLabel label="Sucursal" sortKey="sucursal" sort={sort} /></TableHead>
                <TableHead className="text-xs" onClick={() => toggle("antiguedad")}><SortLabel label="Antigüedad" sortKey="antiguedad" sort={sort} /></TableHead>
                <TableHead className="text-xs text-right" onClick={() => toggle("legales")}><SortLabel label="Legales" sortKey="legales" sort={sort} /></TableHead>
                <TableHead className="text-xs text-right" onClick={() => toggle("solic")}><SortLabel label="Solic." sortKey="solic" sort={sort} /></TableHead>
                <TableHead className="text-xs text-right" onClick={() => toggle("monto")}><SortLabel label="Monto" sortKey="monto" sort={sort} /></TableHead>
                <TableHead className="text-xs" onClick={() => toggle("estado")}><SortLabel label="Estado" sortKey="estado" sort={sort} /></TableHead>
                <TableHead className="text-xs text-center w-32">Acciones</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {sorted.map((r, i) => (
                  <TableRow key={r.id || `emp_${r.employee_id}`}>
                    <TableCell className="text-center text-xs text-muted-foreground tabular-nums">{i + 1}</TableCell>
                    <TableCell className="text-sm font-medium">{r._nombre}<div className="text-[11px] text-muted-foreground">{r._cedula || "—"}{r._puesto ? ` · ${r._puesto}` : ""}</div></TableCell>
                    <TableCell className="text-xs">{r._sucursal || "—"}</TableCell>
                    <TableCell className="text-xs">{fmtAntig(r._antiguedad)}</TableCell>
                    <TableCell className="text-xs text-right">{r._dias_legales}</TableCell>
                    <TableCell className="text-xs text-right">{r.dias}</TableCell>
                    <TableCell className="text-xs text-right font-mono font-bold">{rd(r.monto)}</TableCell>
                    <TableCell><Badge variant="outline" className={ESTADO_CLASS[r._estado] || ""}>{ESTADO_LABEL[r._estado] || r._estado}</Badge></TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-0.5">
                        {!r._hasRecord ? (
                          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setEditing({ employee_id: r.employee_id, employee_nombre: r._nombre, periodo: year, dias: r._dias_legales, sueldo_mensual: r._sueldo_mensual, fecha_ingreso: r._fecha_ingreso, antiguedad_anios: r._antiguedad, dias_legales: r._dias_legales, fecha_fin: `${year}-12-31`, status: "borrador" })}><Calculator className="h-3.5 w-3.5 mr-1" />Calcular</Button>
                        ) : (<>
                        {(r._estado === "borrador" || r._estado === "solicitada") && <Button variant="ghost" size="icon" className="h-7 w-7 text-blue-600 hover:bg-blue-50" onClick={() => setStatus(r, "en_revision")} disabled={busyId === r.id} title="Enviar a revisión">↗</Button>}
                        {r._estado === "en_revision" && <Button variant="ghost" size="icon" className="h-7 w-7 text-emerald-600 hover:bg-emerald-50" onClick={() => setStatus(r, "aprobada")} disabled={busyId === r.id} title="Aprobar">{busyId === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}</Button>}
                        {r._estado === "aprobada" && <Button variant="ghost" size="icon" className="h-7 w-7 text-indigo-600 hover:bg-indigo-50" onClick={() => setStatus(r, "pagada")} disabled={busyId === r.id} title="Marcar pagada"><DollarSign className="h-3.5 w-3.5" /></Button>}
                        {r._estado !== "anulada" && r._estado !== "pagada" && <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-500 hover:bg-gray-100" onClick={() => setStatus(r, "anulada")} disabled={busyId === r.id} title="Anular"><Ban className="h-3.5 w-3.5" /></Button>}
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditing(r)} title="Editar" disabled={r._estado === "pagada"}><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:bg-red-50" onClick={() => del(r.id)} disabled={busyId === r.id} title="Eliminar"><Trash2 className="h-3.5 w-3.5" /></Button>
                        </>)}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!editing} onOpenChange={open => !open && setEditing(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editing?.id ? "Editar vacación" : "Nuevo cálculo de vacaciones"}</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3 py-2">
              <div className="space-y-1"><Label className="text-xs">Empleado *</Label>
                <EmployeeSelect value={editing.employee_id} onSelect={emp => { if (emp) calcularLegal(emp.empleado_id, editing.fecha_fin || undefined); else setEditing({ ...editing, employee_id: "" }) }} /></div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label className="text-xs">Período</Label><Input value={editing.periodo || ""} onChange={e => setEditing({ ...editing, periodo: e.target.value })} placeholder="2026" /></div>
                <div className="space-y-1"><Label className="text-xs">Sueldo mensual (RD$)</Label><Input type="number" step="0.01" value={editing.sueldo_mensual ?? 0} onChange={e => setEditing({ ...editing, sueldo_mensual: Number(e.target.value) })} /></div>
                <div className="space-y-1"><Label className="text-xs">Desde</Label><Input type="date" value={editing.fecha_inicio || ""} onChange={e => setEditing({ ...editing, fecha_inicio: e.target.value })} /></div>
                <div className="space-y-1"><Label className="text-xs">Hasta</Label><Input type="date" value={editing.fecha_fin || ""} onChange={e => { const v = e.target.value; setEditing(p => p ? { ...p, fecha_fin: v } : p); if (editing.employee_id) calcularLegal(editing.employee_id, v) }} /></div>
              </div>

              {/* Cálculo legal */}
              <div className="rounded-lg border bg-muted/30 p-3 text-sm space-y-1">
                <div className="flex justify-between"><span className="text-muted-foreground">Antigüedad</span><span className="font-mono">{fmtAntig(Number(editing.antiguedad_anios || 0))}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Días legales (Código de Trabajo)</span><span className="font-mono font-bold">{editing.dias_legales ?? 0}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Sueldo diario (mensual ÷ {DAILY_BASE})</span><span className="font-mono">{rd(sueldoDiario)}</span></div>
                <div className="flex justify-between border-t pt-1 font-bold"><span>Monto (diario × {editing.dias || 0} días)</span><span className="font-mono">{rd(montoCalc)}</span></div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label className="text-xs">Días solicitados *</Label><Input type="number" step="0.5" value={editing.dias ?? 0} onChange={e => setEditing({ ...editing, dias: Number(e.target.value) })} /></div>
                <div className="space-y-1"><Label className="text-xs">Estado</Label>
                  <Select value={editing.status && ["borrador", "solicitada", "en_revision"].includes(normEstado(editing.status)) ? normEstado(editing.status) : "borrador"} onValueChange={v => setEditing({ ...editing, status: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{["borrador", "solicitada", "en_revision"].map(s => <SelectItem key={s} value={s}>{ESTADO_LABEL[s]}</SelectItem>)}</SelectContent>
                  </Select></div>
              </div>
              <div className="space-y-1"><Label className="text-xs">Observaciones</Label><Input value={editing.observations || ""} onChange={e => setEditing({ ...editing, observations: e.target.value })} /></div>
              <p className="text-[11px] text-muted-foreground">{calcing ? <span className="inline-flex items-center"><Calculator className="w-3 h-3 mr-1 animate-pulse" />Calculando antigüedad…</span> : "La aprobación y el pago se hacen desde la tabla (no se marca pagada automáticamente)."}</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={busy}><X className="w-4 h-4 mr-1" />Cancelar</Button>
            <Button onClick={handleSave} disabled={busy || calcing}>{busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
