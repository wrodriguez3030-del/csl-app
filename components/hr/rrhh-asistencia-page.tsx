"use client"

import { useEffect, useMemo, useState } from "react"
import { apiCall, normalizeApiUrl, useAppStore } from "@/lib/store"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { EmployeeSelect } from "@/components/hr/employee-select"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ClipboardCheck, Loader2, RefreshCw, AlertCircle } from "lucide-react"
import { useCurrentBusiness } from "@/hooks/use-current-business"

interface AttRow {
  employee_id: string
  fecha: string
  sucursal: string | null
  entrada: string | null
  salida: string | null
  minutos_trabajados: number
  tarde_min: number
  estado: string
  marcas: number
}

const ESTADO_CLASS: Record<string, string> = {
  presente: "bg-emerald-100 text-emerald-700 border-emerald-200",
  tarde: "bg-amber-100 text-amber-700 border-amber-200",
  incompleto: "bg-red-100 text-red-700 border-red-200",
}

function isoDaysAgo(n: number): string {
  const d = new Date(); d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}
function fmtHora(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleTimeString("es-DO", { timeZone: "America/Santo_Domingo", hour: "2-digit", minute: "2-digit" })
}
function fmtDur(min: number): string {
  if (!min) return "—"
  const h = Math.floor(min / 60); const m = min % 60
  return h ? `${h}h ${m}m` : `${m}m`
}

export function RrhhAsistenciaPage() {
  const { apiUrl, showToast } = useAppStore()
  const business = useCurrentBusiness()
  const [rows, setRows] = useState<AttRow[]>([])
  const [tableMissing, setTableMissing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [desde, setDesde] = useState(isoDaysAgo(7))
  const [hasta, setHasta] = useState(isoDaysAgo(0))
  const [empFilter, setEmpFilter] = useState("")

  const call = (params: Record<string, string | number | boolean>) => apiCall(normalizeApiUrl(apiUrl), params)

  const reload = async () => {
    setLoading(true)
    try {
      const params: Record<string, string> = { action: "getHrAttendance", desde, hasta }
      if (empFilter.trim()) params.employee_id = empFilter.trim()
      const res = await call(params) as { ok?: boolean; records?: AttRow[]; tableMissing?: boolean }
      setTableMissing(Boolean(res?.tableMissing))
      setRows(res?.records ?? [])
    } catch (err) {
      showToast(`Error al cargar asistencia: ${err instanceof Error ? err.message : String(err)}`, "error")
    } finally { setLoading(false) }
  }
  useEffect(() => { reload() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => ({
    total: rows.length,
    presente: rows.filter(r => r.estado === "presente").length,
    tarde: rows.filter(r => r.estado === "tarde").length,
    incompleto: rows.filter(r => r.estado === "incompleto").length,
  }), [rows])

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-primary/10 p-2.5 text-primary"><ClipboardCheck className="h-6 w-6" /></div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">RR.HH. · Asistencia · {business.shortName}</p>
            <h2 className="mt-0.5 text-xl font-black tracking-tight">Asistencia</h2>
            <p className="mt-1 text-sm text-muted-foreground">Consolidación de ponches contra el horario asignado: minutos trabajados, tardanza y estado del día.</p>
          </div>
        </div>
      </div>

      {tableMissing && !loading && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex items-start gap-2">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-amber-600" />
          <div>La tabla <code className="text-xs bg-amber-100 px-1 rounded">hr_punches</code> aún no existe en este tenant. Aplica la migración de Fase 2.</div>
        </div>
      )}

      {/* KPIs */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Card><CardContent className="pt-4 pb-3 text-center"><div className="text-2xl font-bold text-primary">{counts.total}</div><div className="text-xs text-muted-foreground uppercase mt-1">Días</div></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><div className="text-2xl font-bold text-emerald-600">{counts.presente}</div><div className="text-xs text-muted-foreground uppercase mt-1">Presente</div></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><div className="text-2xl font-bold text-amber-600">{counts.tarde}</div><div className="text-xs text-muted-foreground uppercase mt-1">Tarde</div></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><div className="text-2xl font-bold text-red-600">{counts.incompleto}</div><div className="text-xs text-muted-foreground uppercase mt-1">Incompletos</div></CardContent></Card>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3 items-end">
        <div><Label className="text-xs">Desde</Label><Input type="date" value={desde} onChange={e => setDesde(e.target.value)} className="h-8" /></div>
        <div><Label className="text-xs">Hasta</Label><Input type="date" value={hasta} onChange={e => setHasta(e.target.value)} className="h-8" /></div>
        <div className="w-56"><Label className="text-xs">Empleado</Label><div className="flex items-center gap-1"><EmployeeSelect value={empFilter} onSelect={emp => setEmpFilter(emp?.empleado_id || "")} placeholder="Todos" />{empFilter && <button type="button" className="text-xs text-muted-foreground underline shrink-0" onClick={() => setEmpFilter("")}>limpiar</button>}</div></div>
        <Button onClick={reload} disabled={loading} className="h-8"><RefreshCw className={`w-4 h-4 mr-1 ${loading ? "animate-spin" : ""}`} />Aplicar</Button>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          {loading ? (
            <div className="py-10 text-center text-sm text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Calculando asistencia...</div>
          ) : rows.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Sin marcas en el rango seleccionado.</div>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead className="text-xs">Empleado</TableHead>
                <TableHead className="text-xs">Fecha</TableHead>
                <TableHead className="text-xs">Entrada</TableHead>
                <TableHead className="text-xs">Salida</TableHead>
                <TableHead className="text-xs text-right">Trabajado</TableHead>
                <TableHead className="text-xs text-right">Tardanza</TableHead>
                <TableHead className="text-xs">Estado</TableHead>
                <TableHead className="text-xs text-center">Marcas</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {rows.map((r, i) => (
                  <TableRow key={`${r.employee_id}-${r.fecha}-${i}`}>
                    <TableCell className="text-sm font-medium">{r.employee_id}</TableCell>
                    <TableCell className="text-xs">{r.fecha}</TableCell>
                    <TableCell className="text-xs">{fmtHora(r.entrada)}</TableCell>
                    <TableCell className="text-xs">{fmtHora(r.salida)}</TableCell>
                    <TableCell className="text-xs text-right font-mono">{fmtDur(r.minutos_trabajados)}</TableCell>
                    <TableCell className="text-xs text-right font-mono">{r.tarde_min ? `${r.tarde_min} min` : "—"}</TableCell>
                    <TableCell><Badge variant="outline" className={ESTADO_CLASS[r.estado] || ""}>{r.estado}</Badge></TableCell>
                    <TableCell className="text-center text-xs">{r.marcas}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">Nota: esta vista consolida días con marcas registradas. La detección de ausencias (días laborables sin ponche) llega en una iteración siguiente.</p>
    </div>
  )
}
