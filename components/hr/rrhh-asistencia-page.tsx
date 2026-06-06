"use client"

import { useEffect, useMemo, useState } from "react"
import { apiCall, normalizeApiUrl, useAppStore } from "@/lib/store"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { EmployeeSelect } from "@/components/hr/employee-select"
import { CalendarClock, Loader2, RefreshCw, FileSpreadsheet, AlertCircle } from "lucide-react"
import { useCurrentBusiness } from "@/hooks/use-current-business"
import { exportHrReportExcel } from "@/lib/hr-report-excel"

interface HoursRow {
  employee_id: string; employee_nombre: string; cedula: string; sucursal: string; fecha: string
  scheduled_start: string | null; scheduled_end: string | null; actual_start: string | null; actual_end: string | null
  expected_minutes: number; worked_minutes: number; late_minutes: number; early_leave_minutes: number; overtime_minutes: number
  estado: string
}
const ESTADO_CLASS: Record<string, string> = {
  Presente: "bg-emerald-100 text-emerald-700 border-emerald-200",
  Tarde: "bg-amber-100 text-amber-700 border-amber-200",
  Ausente: "bg-red-100 text-red-700 border-red-200",
  Incompleto: "bg-orange-100 text-orange-700 border-orange-200",
  Libre: "bg-slate-100 text-slate-500 border-slate-200",
}
const fmtMin = (m: number) => { const x = Math.max(0, Math.round(Number(m) || 0)); return `${Math.floor(x / 60)}h ${String(x % 60).padStart(2, "0")}m` }
const fmtTime = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString("es-DO", { timeZone: "America/Santo_Domingo", hour: "2-digit", minute: "2-digit" }) : "—"
const todayStr = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Santo_Domingo" })
const monthAgoStr = () => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toLocaleDateString("en-CA", { timeZone: "America/Santo_Domingo" }) }

export function RrhhAsistenciaPage() {
  const { apiUrl, showToast } = useAppStore()
  const business = useCurrentBusiness()
  const call = (p: Record<string, string | number | boolean>) => apiCall(normalizeApiUrl(apiUrl), p)
  const [rows, setRows] = useState<HoursRow[]>([])
  const [loading, setLoading] = useState(true)
  const [tableMissing, setTableMissing] = useState(false)
  const [desde, setDesde] = useState(monthAgoStr())
  const [hasta, setHasta] = useState(todayStr())
  const [empFilter, setEmpFilter] = useState("")
  const [sucFilter, setSucFilter] = useState("all")

  const reload = async () => {
    setLoading(true)
    try {
      const p: Record<string, string | number | boolean> = { action: "getHrAttendanceHours", desde, hasta }
      if (empFilter) p.employee_id = empFilter
      const res = await call(p) as { ok?: boolean; records?: HoursRow[]; tableMissing?: boolean }
      setTableMissing(Boolean(res?.tableMissing)); setRows(res?.records ?? [])
    } catch (err) { showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error") } finally { setLoading(false) }
  }
  useEffect(() => { reload() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const sucursales = useMemo(() => Array.from(new Set(rows.map(r => r.sucursal).filter(Boolean))).sort(), [rows])
  const filtered = useMemo(() => sucFilter === "all" ? rows : rows.filter(r => r.sucursal === sucFilter), [rows, sucFilter])
  const totals = useMemo(() => ({
    dias: filtered.length,
    worked: filtered.reduce((s, r) => s + (Number(r.worked_minutes) || 0), 0),
    late: filtered.filter(r => (Number(r.late_minutes) || 0) > 0).length,
    overtime: filtered.reduce((s, r) => s + (Number(r.overtime_minutes) || 0), 0),
  }), [filtered])

  const exportExcel = () => {
    const headers = ["Empleado", "Cédula", "Sucursal", "Fecha", "Entrada prog.", "Entrada real", "Salida prog.", "Salida real", "Horas esperadas", "Horas trabajadas", "Tardanza", "Salida temprana", "Horas extra", "Estado"]
    const data = filtered.map(r => [
      r.employee_nombre, r.cedula, r.sucursal, r.fecha,
      r.scheduled_start || "—", fmtTime(r.actual_start), r.scheduled_end || "—", fmtTime(r.actual_end),
      fmtMin(r.expected_minutes), fmtMin(r.worked_minutes), fmtMin(r.late_minutes), fmtMin(r.early_leave_minutes), fmtMin(r.overtime_minutes), r.estado,
    ])
    exportHrReportExcel(business, { title: "Reporte de Asistencia / Horas trabajadas", headers, rows: data, filtros: `${desde} a ${hasta}${sucFilter !== "all" ? ` · ${sucFilter}` : ""}`, filename: `Asistencia_${desde}_${hasta}.xls` })
    showToast(`Excel generado (${data.length} fila(s))`, "success")
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-primary/10 p-2.5 text-primary"><CalendarClock className="h-6 w-6" /></div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">RR.HH. · Asistencia · {business.shortName}</p>
            <h2 className="mt-0.5 text-xl font-black tracking-tight">Asistencia y horas trabajadas</h2>
            <p className="mt-1 text-sm text-muted-foreground">Horas esperadas vs trabajadas, tardanza, salida temprana y horas extra según el horario del empleado.</p>
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button variant="outline" onClick={exportExcel}><FileSpreadsheet className="w-4 h-4 mr-1" />Exportar Excel</Button>
          <Button variant="outline" onClick={reload} disabled={loading}><RefreshCw className={`w-4 h-4 mr-1 ${loading ? "animate-spin" : ""}`} />Actualizar</Button>
        </div>
      </div>

      {tableMissing && !loading && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex items-start gap-2">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-amber-600" /><div>Falta la tabla de ponches. Aplica las migraciones del ponche QR en db-cls.</div>
        </div>
      )}

      <Card><CardContent className="py-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1"><Label className="text-xs">Desde</Label><Input type="date" value={desde} onChange={e => setDesde(e.target.value)} className="h-8 w-36" /></div>
          <div className="space-y-1"><Label className="text-xs">Hasta</Label><Input type="date" value={hasta} onChange={e => setHasta(e.target.value)} className="h-8 w-36" /></div>
          <div className="space-y-1"><Label className="text-xs">Sucursal</Label>
            <Select value={sucFilter} onValueChange={setSucFilter}><SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">Todas</SelectItem>{sucursales.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1 w-56"><Label className="text-xs">Empleado</Label>
            <div className="flex items-center gap-1"><EmployeeSelect value={empFilter} onSelect={e => setEmpFilter(e?.empleado_id || "")} placeholder="Todos" />
              {empFilter && <button type="button" className="text-xs text-muted-foreground underline shrink-0" onClick={() => setEmpFilter("")}>limpiar</button>}</div></div>
          <Button size="sm" className="h-8" onClick={reload} disabled={loading}>Aplicar</Button>
        </div>
      </CardContent></Card>

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Card><CardContent className="pt-4 pb-3 text-center"><div className="text-2xl font-bold text-primary">{totals.dias}</div><div className="text-xs text-muted-foreground uppercase mt-1">Días</div></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><div className="text-2xl font-bold text-emerald-600">{fmtMin(totals.worked)}</div><div className="text-xs text-muted-foreground uppercase mt-1">Horas trabajadas</div></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><div className="text-2xl font-bold text-amber-600">{totals.late}</div><div className="text-xs text-muted-foreground uppercase mt-1">Días con tardanza</div></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><div className="text-2xl font-bold text-blue-600">{fmtMin(totals.overtime)}</div><div className="text-xs text-muted-foreground uppercase mt-1">Horas extra</div></CardContent></Card>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          {loading ? <div className="py-10 text-center text-sm text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Cargando...</div>
          : filtered.length === 0 ? <div className="py-10 text-center text-sm text-muted-foreground">Sin registros de asistencia en el rango. Marca ponches en el kiosco.</div> : (
            <Table>
              <TableHeader><TableRow>
                <TableHead className="text-xs">Empleado</TableHead><TableHead className="text-xs">Sucursal</TableHead><TableHead className="text-xs">Fecha</TableHead>
                <TableHead className="text-xs">Ent. prog/real</TableHead><TableHead className="text-xs">Sal. prog/real</TableHead>
                <TableHead className="text-xs text-right">Esperadas</TableHead><TableHead className="text-xs text-right">Trabajadas</TableHead>
                <TableHead className="text-xs text-right">Tardanza</TableHead><TableHead className="text-xs text-right">Extra</TableHead><TableHead className="text-xs">Estado</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {filtered.map((r, i) => (
                  <TableRow key={`${r.employee_id}-${r.fecha}-${i}`}>
                    <TableCell className="text-sm font-medium">{r.employee_nombre}<div className="text-[11px] text-muted-foreground">{r.cedula || "—"}</div></TableCell>
                    <TableCell className="text-xs">{r.sucursal || "—"}</TableCell>
                    <TableCell className="text-xs">{r.fecha}</TableCell>
                    <TableCell className="text-xs">{r.scheduled_start || "—"} / <b>{fmtTime(r.actual_start)}</b></TableCell>
                    <TableCell className="text-xs">{r.scheduled_end || "—"} / <b>{fmtTime(r.actual_end)}</b></TableCell>
                    <TableCell className="text-xs text-right">{fmtMin(r.expected_minutes)}</TableCell>
                    <TableCell className="text-xs text-right font-mono font-bold">{fmtMin(r.worked_minutes)}</TableCell>
                    <TableCell className="text-xs text-right">{(Number(r.late_minutes) || 0) > 0 ? <span className="text-amber-600">{fmtMin(r.late_minutes)}</span> : "—"}</TableCell>
                    <TableCell className="text-xs text-right">{(Number(r.overtime_minutes) || 0) > 0 ? <span className="text-blue-600">{fmtMin(r.overtime_minutes)}</span> : "—"}</TableCell>
                    <TableCell><Badge variant="outline" className={ESTADO_CLASS[r.estado] || ""}>{r.estado}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
