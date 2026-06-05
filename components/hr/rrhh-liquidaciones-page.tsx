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
import { Scale, Plus, Pencil, Trash2, Save, X, Loader2, Calculator, Printer, AlertTriangle, FileSpreadsheet } from "lucide-react"
import { useCurrentBusiness } from "@/hooks/use-current-business"
import { getBusinessBranding } from "@/lib/business"
import { exportHrReportExcel } from "@/lib/hr-report-excel"

const DAILY_BASE = 23.83

interface Severance {
  id: string; employee_id: string; employee_nombre: string | null; motivo: string
  fecha_ingreso: string | null; fecha_salida: string | null; anios_servicio: number
  sueldo_mensual: number; salario_diario: number
  preaviso_dias: number; preaviso_monto: number; cesantia_dias: number; cesantia_monto: number
  vacaciones_monto: number; navidad_monto: number; salario_pendiente: number
  otros_ingresos: number; descuentos: number; total: number; status: string; observations: string | null
  // Derivados (no persistidos): días/meses para pantalla y PDF.
  vacaciones_dias?: number; navidad_meses?: number; navidad_dias?: number
  tiempo_anios?: number; tiempo_dias?: number; cedula?: string
}
interface Emp { id: string; nombre: string; cedula: string; puesto: string; sucursal: string; sueldo: number; fecha_ingreso: string }

const MOTIVOS: Record<string, string> = {
  desahucio: "Desahucio", renuncia: "Renuncia", despido_justificado: "Despido justificado",
  despido_injustificado: "Despido injustificado", mutuo_acuerdo: "Mutuo acuerdo",
  fin_contrato: "Fin de contrato", abandono: "Abandono", fallecimiento: "Fallecimiento",
}
const ESTADOS = ["borrador", "calculado", "revisado", "aprobado", "pagado", "archivado", "anulado"]
const STATUS_CLASS: Record<string, string> = {
  borrador: "bg-slate-100 text-slate-700 border-slate-200",
  calculado: "bg-blue-100 text-blue-700 border-blue-200",
  revisado: "bg-amber-100 text-amber-700 border-amber-200",
  aprobado: "bg-emerald-100 text-emerald-700 border-emerald-200",
  pagado: "bg-purple-100 text-purple-700 border-purple-200",
  archivado: "bg-gray-100 text-gray-500 border-gray-200",
  anulado: "bg-gray-100 text-gray-400 border-gray-200",
}
const rd = (n: number) => `RD$ ${(Number(n) || 0).toLocaleString("es-DO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100
const pick = (...vals: unknown[]) => { for (const v of vals) { const s = v == null ? "" : String(v).trim(); if (s) return s } return "" }
const diasVacacionesRD = (a: number) => (a >= 5 ? 18 : a >= 1 ? 14 : 0)

function toEmp(r: Record<string, unknown>): Emp {
  return {
    id: pick(r.SolicitudID, r.empleado_id, r.EmpleadoID, r.id),
    nombre: `${pick(r.Nombre, r.nombre)} ${pick(r.Apellido, r.apellido)}`.replace(/\s+/g, " ").trim() || pick(r.SolicitudID, r.empleado_id),
    cedula: pick(r.Cedula, r.cedula), puesto: pick(r.PuestoSolicitado, r.puesto_solicitado, r.Puesto, r.puesto),
    sucursal: pick(r.Sucursal, r.sucursal),
    fecha_ingreso: pick(r.fechaIngresoLaboral, r.FechaIngresoLaboral, r.fecha_ingreso, r.start_date, r.fechaIngreso, r.FechaSolicitud, r.fecha_solicitud),
    sueldo: Number(r.Salario ?? r.salario ?? 0) || 0,
  }
}

/** Tiempo laborado (años y días) entre ingreso y salida. */
function clientTiempo(ing?: string | null, sal?: string | null): { anios: number; dias: number; t: number } {
  if (!ing) return { anios: 0, dias: 0, t: 0 }
  const a = Date.parse(`${ing}T00:00:00Z`)
  const b = sal ? Date.parse(`${sal}T00:00:00Z`) : Date.now()
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return { anios: 0, dias: 0, t: 0 }
  const t = (b - a) / (365.25 * 24 * 3600 * 1000)
  const anios = Math.floor(t + 1e-9)
  const ingD = new Date(`${ing}T00:00:00Z`)
  const anchor = Date.UTC(ingD.getUTCFullYear() + anios, ingD.getUTCMonth(), ingD.getUTCDate())
  const dias = Math.max(0, Math.round((b - anchor) / 86400000) + 1)
  return { anios, dias, t }
}
/** Navidad proporcional (mismo criterio que el backend). */
function clientNavidad(ing: string | null | undefined, sal: string | null | undefined, mensual: number): { meses: number; dias: number; monto: number } {
  if (!sal) return { meses: 0, dias: 0, monto: 0 }
  const s = new Date(`${sal}T00:00:00Z`); if (Number.isNaN(s.getTime())) return { meses: 0, dias: 0, monto: 0 }
  const i = ing ? new Date(`${ing}T00:00:00Z`) : null
  const y = s.getUTCFullYear()
  const sameYear = i && !Number.isNaN(i.getTime()) && i.getUTCFullYear() === y
  const startMonth = sameYear ? (i as Date).getUTCMonth() + 1 : 1
  const startDay = sameYear ? (i as Date).getUTCDate() : 1
  let months = (s.getUTCMonth() + 1) - startMonth
  let days = s.getUTCDate() - startDay + 1
  while (days >= 30) { months += 1; days -= 30 }
  while (days < 0) { months -= 1; days += 30 }
  if (months < 0) { months = 0; days = 0 }
  return { meses: months, dias: days, monto: round2(mensual * (months + days / 30) / 12) }
}
const fmtTiempo = (anios: number, dias: number) => `${anios} año(s) y ${dias} día(s)`
const fmtNav = (m: number, d: number) => `${m} mes(es) y ${d} día(s)`

export function RrhhLiquidacionesPage() {
  const { apiUrl, showToast } = useAppStore()
  const business = useCurrentBusiness()
  const empresa = getBusinessBranding(business).name
  const [records, setRecords] = useState<Severance[]>([])
  const [empMap, setEmpMap] = useState<Record<string, Emp>>({})
  const [tableMissing, setTableMissing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Partial<Severance> | null>(null)
  const [calcing, setCalcing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const call = (params: Record<string, string | number | boolean>) => apiCall(normalizeApiUrl(apiUrl), params)

  const reload = async () => {
    setLoading(true)
    try {
      const [sev, emp] = await Promise.all([
        call({ action: "getHrSeverance" }) as Promise<{ ok?: boolean; records?: Severance[]; tableMissing?: boolean }>,
        call({ action: "getEmpleados" }) as Promise<{ ok?: boolean; records?: Record<string, unknown>[] }>,
      ])
      setTableMissing(Boolean(sev?.tableMissing)); setRecords(sev?.records ?? [])
      const map: Record<string, Emp> = {}
      for (const r of (emp?.records ?? [])) { const e = toEmp(r); if (e.id) map[e.id] = e }
      setEmpMap(map)
    } catch (err) { showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error") } finally { setLoading(false) }
  }
  useEffect(() => { reload() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => ({
    total: records.length,
    proceso: records.filter(r => ["borrador", "calculado", "revisado"].includes(r.status)).length,
    aprobado: records.filter(r => r.status === "aprobado" || r.status === "pagado").length,
    monto: records.filter(r => r.status === "aprobado" || r.status === "pagado").reduce((s, r) => s + Number(r.total || 0), 0),
  }), [records])

  // Cálculo en vivo del modal.
  const tiempo = editing ? clientTiempo(editing.fecha_ingreso, editing.fecha_salida) : { anios: 0, dias: 0, t: 0 }
  const diarioLive = editing ? round2(Number(editing.sueldo_mensual || 0) / DAILY_BASE) : 0
  const subtotal = editing ? round2(Number(editing.preaviso_monto || 0) + Number(editing.cesantia_monto || 0) + Number(editing.vacaciones_monto || 0)) : 0
  const totalCalc = editing ? round2(subtotal + Number(editing.navidad_monto || 0) + Number(editing.salario_pendiente || 0) + Number(editing.otros_ingresos || 0) - Number(editing.descuentos || 0)) : 0

  const calcular = async (overrideEmpId?: string) => {
    const empId = (overrideEmpId || editing?.employee_id || "").trim()
    if (!empId) { showToast("Selecciona el empleado", "error"); return }
    setCalcing(true)
    try {
      const res = await call({ action: "getHrSeveranceSuggestion", employee_id: empId, motivo: editing?.motivo || "desahucio", fecha_ingreso: editing?.fecha_ingreso || "", fecha_salida: editing?.fecha_salida || "" }) as
        { ok?: boolean; employee_nombre?: string; cedula?: string; fecha_ingreso?: string; sueldo_mensual?: number; salario_diario?: number; anios_servicio?: number; tiempo_anios?: number; tiempo_dias?: number; preaviso_dias?: number; preaviso_monto?: number; cesantia_dias?: number; cesantia_monto?: number; vacaciones_dias?: number; vacaciones_monto?: number; navidad_meses?: number; navidad_dias?: number; navidad_monto?: number; error?: string }
      if (!res?.ok) { showToast(`Error: ${res?.error || "no se pudo calcular"}`, "error"); return }
      setEditing(prev => prev ? {
        ...prev,
        employee_nombre: res.employee_nombre ?? prev.employee_nombre, cedula: res.cedula ?? prev.cedula,
        fecha_ingreso: res.fecha_ingreso || prev.fecha_ingreso,
        sueldo_mensual: res.sueldo_mensual, salario_diario: res.salario_diario, anios_servicio: res.anios_servicio,
        tiempo_anios: res.tiempo_anios, tiempo_dias: res.tiempo_dias,
        preaviso_dias: res.preaviso_dias, preaviso_monto: res.preaviso_monto,
        cesantia_dias: res.cesantia_dias, cesantia_monto: res.cesantia_monto,
        vacaciones_dias: res.vacaciones_dias, vacaciones_monto: res.vacaciones_monto,
        navidad_meses: res.navidad_meses, navidad_dias: res.navidad_dias, navidad_monto: res.navidad_monto,
      } : prev)
      if (!res.fecha_ingreso) showToast("Este empleado no tiene fecha de ingreso laboral registrada.", "error")
      else showToast(`Cálculo legal aplicado (${res.tiempo_anios}a ${res.tiempo_dias}d). Editable; valida antes de aprobar.`, "success")
    } catch (err) { showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error") } finally { setCalcing(false) }
  }

  const exportExcel = () => {
    const headers = ["No.", "Empleado", "Cédula", "Empresa", "Fecha ingreso", "Fecha salida", "Tiempo laborado", "Sueldo mensual", "Sueldo diario", "Preaviso", "Cesantía", "Vacaciones", "Navidad", "Total", "Estado"]
    const rows = records.map((r, i) => {
      const e = empMap[r.employee_id]; const ti = clientTiempo(r.fecha_ingreso, r.fecha_salida)
      return [
        i + 1, r.employee_nombre || e?.nombre || r.employee_id, pick(r.cedula, e?.cedula), empresa,
        r.fecha_ingreso || "", r.fecha_salida || "", fmtTiempo(ti.anios, ti.dias), rd(r.sueldo_mensual), rd(r.salario_diario),
        rd(r.preaviso_monto), rd(r.cesantia_monto), rd(r.vacaciones_monto), rd(r.navidad_monto), rd(r.total), r.status,
      ]
    })
    const tot = records.reduce((s, r) => s + (Number(r.total) || 0), 0)
    exportHrReportExcel(business, {
      title: "Reporte de Prestaciones / Liquidaciones RD", headers, rows,
      footer: ["", "Empleados: " + records.length, "", "", "", "", "", "", "", "", "", "", "TOTAL", rd(tot), ""],
      filename: `Prestaciones_${new Date().toISOString().slice(0, 10)}.xls`,
    })
    showToast(`Excel generado (${rows.length} fila(s))`, "success")
  }

  const buildPayload = (r: Partial<Severance>): Record<string, string | number> => {
    const p: Record<string, string | number> = {
      employee_id: r.employee_id || "", motivo: r.motivo || "desahucio", status: r.status || "borrador",
      anios_servicio: Number(r.anios_servicio || 0), sueldo_mensual: Number(r.sueldo_mensual || 0), salario_diario: Number(r.salario_diario || 0),
      preaviso_dias: Number(r.preaviso_dias || 0), preaviso_monto: Number(r.preaviso_monto || 0),
      cesantia_dias: Number(r.cesantia_dias || 0), cesantia_monto: Number(r.cesantia_monto || 0),
      vacaciones_monto: Number(r.vacaciones_monto || 0), navidad_monto: Number(r.navidad_monto || 0),
      salario_pendiente: Number(r.salario_pendiente || 0), otros_ingresos: Number(r.otros_ingresos || 0), descuentos: Number(r.descuentos || 0),
    }
    if (r.id) p.id = r.id
    if (r.employee_nombre) p.employee_nombre = r.employee_nombre
    if (r.fecha_ingreso) p.fecha_ingreso = r.fecha_ingreso
    if (r.fecha_salida) p.fecha_salida = r.fecha_salida
    if (r.observations) p.observations = r.observations
    return p
  }

  const handleSave = async () => {
    if (!editing) return
    if (!editing.employee_id?.trim()) { showToast("Empleado obligatorio", "error"); return }
    setBusy(true)
    try {
      const res = await call({ action: "saveHrSeverance", data: JSON.stringify(buildPayload(editing)) }) as { ok?: boolean; error?: string; tableMissing?: boolean }
      if (res?.tableMissing) { showToast("Tabla hr_severance aún no existe", "info"); setEditing(null); return }
      if (!res?.ok) { showToast(`Error: ${res?.error || "no se pudo guardar"}`, "error"); return }
      showToast("Liquidación guardada", "success"); setEditing(null); reload()
    } catch (err) { showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error") } finally { setBusy(false) }
  }
  const setStatus = async (r: Severance, status: string) => {
    setBusyId(r.id)
    try {
      const res = await call({ action: "saveHrSeverance", data: JSON.stringify({ ...buildPayload(r), status }) }) as { ok?: boolean; error?: string }
      if (!res?.ok) { showToast(`Error: ${res?.error}`, "error"); return }
      showToast(`Estado: ${status}`, "success"); reload()
    } catch (err) { showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error") } finally { setBusyId(null) }
  }
  const del = async (id: string) => {
    if (!confirm("¿Eliminar esta liquidación?") || !confirm("Confirma de nuevo: se eliminará permanentemente.")) return
    setBusyId(id)
    try { await call({ action: "deleteHrSeverance", id }); setRecords(prev => prev.filter(r => r.id !== id)); showToast("Eliminado", "success") }
    catch (err) { showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error") } finally { setBusyId(null) }
  }

  // PDF en formato Ministerio de Trabajo RD.
  const imprimir = (r: Severance) => {
    const b = getBusinessBranding(business)
    const e = empMap[r.employee_id]
    const cedula = pick(r.cedula, e?.cedula)
    const ti = clientTiempo(r.fecha_ingreso, r.fecha_salida)
    const vacDias = r.vacaciones_dias ?? diasVacacionesRD(Number(r.anios_servicio || 0))
    const nav = clientNavidad(r.fecha_ingreso, r.fecha_salida, Number(r.sueldo_mensual || 0))
    const subtot = round2(Number(r.preaviso_monto || 0) + Number(r.cesantia_monto || 0) + Number(r.vacaciones_monto || 0))
    const logo = /^https?:/.test(b.logoUrl) ? b.logoUrl : (typeof window !== "undefined" ? window.location.origin + b.logoUrl : b.logoUrl)
    const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    const dato = (k: string, v: string) => `<tr><td class="k">${esc(k)}</td><td class="v">${esc(v)}</td></tr>`
    const linea = (c: string, sub: string, v: number) => `<tr><td>${esc(c)}<div class="sub">${esc(sub)}</div></td><td class="num">${rd(v)}</td></tr>`
    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"/><title>Prestaciones - ${esc(r.employee_nombre)}</title>
<style>@page{size:letter;margin:15mm}body{font-family:Arial,Helvetica,sans-serif;color:#111827;font-size:12px}
.gov{text-align:center;margin-bottom:6px}.gov .c{font-size:14px;font-weight:900;letter-spacing:.03em}.gov .m{font-size:13px;font-weight:800;color:#1e3a8a}
.h{display:flex;align-items:center;gap:10px;border-top:3px solid ${b.primaryColor};border-bottom:3px solid ${b.primaryColor};padding:6px 0;margin:8px 0}
.h img{width:42px;height:42px;border-radius:50%;object-fit:cover}.bn{font-size:13px;font-weight:900;color:${b.primaryColor}}.st{font-size:9px;color:#64748b;text-transform:uppercase;letter-spacing:.08em}
h1{font-size:13px;margin:8px 0 4px;text-align:center;text-transform:uppercase}
table{width:100%;border-collapse:collapse;margin-top:6px}td,th{border:1px solid #cbd5e1;padding:5px 8px;font-size:11px;vertical-align:top}
.dt td.k{background:#f1f5f9;font-weight:700;width:42%}.sec{background:${b.primaryColor};color:#fff;font-weight:800;text-transform:uppercase;font-size:11px}
.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.sub{font-size:9px;color:#64748b}
.subtot td{background:#eff6ff;font-weight:700}.tot td{background:#dcfce7;font-weight:900;font-size:12px}
.legal{margin-top:10px;font-size:9px;color:#7c2d12;background:#fff7ed;border:1px solid #fed7aa;border-radius:6px;padding:8px}
.sign{display:flex;justify-content:space-between;margin-top:30px;gap:20px}.sign div{flex:1;border-top:1px solid #475569;text-align:center;font-size:10px;padding-top:4px}
.foot{margin-top:12px;color:#64748b;font-size:9px;border-top:1px solid #e5e7eb;padding-top:6px;text-align:center}</style></head><body>
<div class="gov"><div class="c">REPÚBLICA DOMINICANA</div><div class="m">MINISTERIO DE TRABAJO</div></div>
<div class="h"><img src="${esc(logo)}" alt=""/><div><div class="bn">${esc(b.name).toUpperCase()}</div><div class="st">${esc(b.subtitle)}</div></div></div>
<h1>Cálculo de Prestaciones Laborales y Derechos Adquiridos</h1>
<table class="dt">
${dato("Cédula", cedula || "—")}
${dato("Nombre del solicitante", String(r.employee_nombre || r.employee_id))}
${dato("Lugar de trabajo / empleador", b.name)}
${dato("Fecha de ingreso", r.fecha_ingreso || "—")}
${dato("Fecha de salida", r.fecha_salida || "—")}
${dato("Tiempo laborado", fmtTiempo(ti.anios, ti.dias))}
${dato("Motivo de terminación", MOTIVOS[r.motivo] || r.motivo)}
${dato("Salario promedio mensual", rd(r.sueldo_mensual))}
${dato("Salario promedio diario", rd(r.salario_diario))}
${dato("Salario actual", rd(r.sueldo_mensual))}
</table>
<table>
<tr><td class="sec" colspan="2">Prestaciones Laborales y Derechos Adquiridos</td></tr>
${linea("Salario Preaviso (art. 76 C.T.)", `${r.preaviso_dias} día(s) × salario diario`, r.preaviso_monto)}
${linea("Cesantía (art. 80 C.T.)", `${r.cesantia_dias} día(s) × salario diario`, r.cesantia_monto)}
${linea("Salario Vacaciones (art. 177 C.T.)", `${vacDias} día(s) × salario diario`, r.vacaciones_monto)}
<tr class="subtot"><td>Subtotal a recibir</td><td class="num">${rd(subtot)}</td></tr>
${linea("Salario Navidad (art. 219 C.T.)", fmtNav(nav.meses, nav.dias), r.navidad_monto)}
${Number(r.salario_pendiente || 0) ? linea("Salario pendiente", "", r.salario_pendiente) : ""}
${Number(r.otros_ingresos || 0) ? linea("Otros ingresos", "", r.otros_ingresos) : ""}
${Number(r.descuentos || 0) ? `<tr><td>Descuentos</td><td class="num">− ${rd(r.descuentos)}</td></tr>` : ""}
<tr class="tot"><td>Total a recibir</td><td class="num">${rd(r.total)}</td></tr>
</table>
<div class="legal">Cálculo referencial generado por el sistema. Validar con asesoría legal/contable antes de aprobar o pagar.</div>
<div class="sign"><div>RR.HH.</div><div>Representante empresa</div><div>Empleado</div></div>
<div class="foot">${esc(b.footerText)} · Generado ${esc(new Date().toLocaleString("es-DO"))}</div>
<script>setTimeout(()=>window.print(),400)</script></body></html>`
    const w = window.open("", "_blank", "width=900,height=800"); if (!w) return
    w.document.write(html); w.document.close()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-primary/10 p-2.5 text-primary"><Scale className="h-6 w-6" /></div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">RR.HH. · Prestaciones · {business.shortName}</p>
            <h2 className="mt-0.5 text-xl font-black tracking-tight">Liquidaciones y prestaciones RD</h2>
            <p className="mt-1 text-sm text-muted-foreground">Formato Ministerio de Trabajo: preaviso (76), cesantía (80), vacaciones (177) y Navidad (219). Diario = mensual ÷ {DAILY_BASE}.</p>
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button variant="outline" onClick={exportExcel}><FileSpreadsheet className="w-4 h-4 mr-1" />Exportar Excel</Button>
          <Button onClick={() => setEditing({ motivo: "desahucio", fecha_salida: new Date().toISOString().slice(0, 10), status: "borrador", preaviso_dias: 0, preaviso_monto: 0, cesantia_dias: 0, cesantia_monto: 0, vacaciones_monto: 0, navidad_monto: 0, salario_pendiente: 0, otros_ingresos: 0, descuentos: 0 })}><Plus className="w-4 h-4 mr-1" />Nueva liquidación</Button>
        </div>
      </div>

      <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex items-start gap-2">
        <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-amber-600" />
        <div><b>Cálculo referencial.</b> Los montos se estiman según el Código de Trabajo RD y son <b>editables</b>. Validar con RR.HH., contabilidad y/o asesor legal antes de pagar.</div>
      </div>

      {tableMissing && !loading && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex items-start gap-2">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-amber-600" /><div>La tabla <code className="text-xs bg-amber-100 px-1 rounded">hr_severance</code> aún no existe. Aplica la migración <code className="text-xs bg-amber-100 px-1 rounded">202606020010_hr_severance.sql</code>.</div>
        </div>
      )}

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Card><CardContent className="pt-4 pb-3 text-center"><div className="text-2xl font-bold text-primary">{counts.total}</div><div className="text-xs text-muted-foreground uppercase mt-1">Total</div></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><div className="text-2xl font-bold text-amber-600">{counts.proceso}</div><div className="text-xs text-muted-foreground uppercase mt-1">En proceso</div></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><div className="text-2xl font-bold text-emerald-600">{counts.aprobado}</div><div className="text-xs text-muted-foreground uppercase mt-1">Aprobadas</div></CardContent></Card>
        <Card><CardContent className="pt-4 pb-3 text-center"><div className="text-lg font-bold text-emerald-700">{rd(counts.monto)}</div><div className="text-xs text-muted-foreground uppercase mt-1">Monto aprobado</div></CardContent></Card>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          {loading ? (
            <div className="py-10 text-center text-sm text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Cargando...</div>
          ) : records.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Sin liquidaciones registradas.</div>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead className="text-xs">Empleado</TableHead><TableHead className="text-xs">Motivo</TableHead>
                <TableHead className="text-xs text-right">Tiempo</TableHead><TableHead className="text-xs text-right">Total</TableHead>
                <TableHead className="text-xs">Estado</TableHead><TableHead className="text-xs text-center w-40">Acciones</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {records.map(r => { const ti = clientTiempo(r.fecha_ingreso, r.fecha_salida); return (
                  <TableRow key={r.id}>
                    <TableCell className="text-sm font-medium">{r.employee_nombre || r.employee_id}<div className="text-[11px] text-muted-foreground">{pick(r.cedula, empMap[r.employee_id]?.cedula) || "—"}</div></TableCell>
                    <TableCell className="text-xs">{MOTIVOS[r.motivo] || r.motivo}</TableCell>
                    <TableCell className="text-xs text-right">{fmtTiempo(ti.anios, ti.dias)}</TableCell>
                    <TableCell className="text-xs text-right font-mono font-bold">{rd(r.total)}</TableCell>
                    <TableCell><Badge variant="outline" className={STATUS_CLASS[r.status] || ""}>{r.status}</Badge></TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-0.5">
                        {(r.status === "calculado" || r.status === "borrador") && <Button variant="ghost" size="icon" className="h-7 w-7 text-amber-600 hover:bg-amber-50" onClick={() => setStatus(r, "revisado")} disabled={busyId === r.id} title="Marcar revisado">↗</Button>}
                        {r.status === "revisado" && <Button variant="ghost" size="icon" className="h-7 w-7 text-emerald-600 hover:bg-emerald-50" onClick={() => setStatus(r, "aprobado")} disabled={busyId === r.id} title="Aprobar">{busyId === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "✓"}</Button>}
                        {r.status === "aprobado" && <Button variant="ghost" size="icon" className="h-7 w-7 text-purple-600 hover:bg-purple-50" onClick={() => setStatus(r, "pagado")} disabled={busyId === r.id} title="Marcar pagada">$</Button>}
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => imprimir(r)} title="PDF Ministerio"><Printer className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditing(r)} title="Editar" disabled={r.status === "pagado" || r.status === "archivado"}><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:bg-red-50" onClick={() => del(r.id)} disabled={busyId === r.id} title="Eliminar"><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )})}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!editing} onOpenChange={open => !open && setEditing(null)}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing?.id ? "Editar liquidación" : "Nueva liquidación (formato Ministerio)"}</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1 col-span-2"><Label className="text-xs">Empleado *</Label>
                  <EmployeeSelect value={editing.employee_id} onSelect={emp => {
                    if (!emp) { setEditing({ ...editing, employee_id: "" }); return }
                    setEditing(prev => prev ? { ...prev, employee_id: emp.empleado_id, employee_nombre: emp.nombre, cedula: emp.cedula, sueldo_mensual: emp.sueldo || prev.sueldo_mensual, fecha_ingreso: emp.fecha_ingreso || prev.fecha_ingreso } : prev)
                    if (!emp.fecha_ingreso) showToast("Este empleado no tiene fecha de ingreso laboral registrada.", "error")
                    calcular(emp.empleado_id)
                  }} /></div>
                <div className="space-y-1"><Label className="text-xs">Cédula</Label><Input value={pick(editing.cedula, empMap[editing.employee_id || ""]?.cedula)} readOnly className="bg-muted/40" /></div>
                <div className="space-y-1"><Label className="text-xs">Empresa</Label><Input value={empresa} readOnly className="bg-muted/40" /></div>
                <div className="space-y-1">
                  <Label className="text-xs">Motivo</Label>
                  <Select value={editing.motivo || "desahucio"} onValueChange={v => setEditing({ ...editing, motivo: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(MOTIVOS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1"><Label className="text-xs">Salario promedio mensual (RD$)</Label><Input type="number" step="0.01" value={editing.sueldo_mensual ?? 0} onChange={e => setEditing({ ...editing, sueldo_mensual: Number(e.target.value) })} /></div>
                <div className="space-y-1"><Label className="text-xs">Fecha ingreso</Label><Input type="date" value={editing.fecha_ingreso || ""} onChange={e => setEditing({ ...editing, fecha_ingreso: e.target.value })} /></div>
                <div className="space-y-1"><Label className="text-xs">Fecha salida</Label><Input type="date" value={editing.fecha_salida || ""} onChange={e => setEditing({ ...editing, fecha_salida: e.target.value })} /></div>
              </div>

              <div className="rounded-lg border bg-muted/30 p-3 text-sm grid grid-cols-2 gap-x-4 gap-y-1">
                <div className="flex justify-between"><span className="text-muted-foreground">Tiempo laborado</span><span className="font-mono">{fmtTiempo(editing.tiempo_anios ?? tiempo.anios, editing.tiempo_dias ?? tiempo.dias)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Salario diario</span><span className="font-mono">{rd(editing.salario_diario || diarioLive)}</span></div>
              </div>

              <Button type="button" variant="outline" size="sm" onClick={() => calcular()} disabled={calcing}>
                {calcing ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Calculator className="w-4 h-4 mr-1" />}Recalcular legal (Ministerio)
              </Button>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1"><Label className="text-xs">Preaviso días</Label><Input type="number" step="1" value={editing.preaviso_dias ?? 0} onChange={e => setEditing({ ...editing, preaviso_dias: Number(e.target.value) })} /></div>
                <div className="space-y-1"><Label className="text-xs">Preaviso monto</Label><Input type="number" step="0.01" value={editing.preaviso_monto ?? 0} onChange={e => setEditing({ ...editing, preaviso_monto: Number(e.target.value) })} /></div>
                <div className="space-y-1"><Label className="text-xs">Cesantía días</Label><Input type="number" step="1" value={editing.cesantia_dias ?? 0} onChange={e => setEditing({ ...editing, cesantia_dias: Number(e.target.value) })} /></div>
                <div className="space-y-1"><Label className="text-xs">Cesantía monto</Label><Input type="number" step="0.01" value={editing.cesantia_monto ?? 0} onChange={e => setEditing({ ...editing, cesantia_monto: Number(e.target.value) })} /></div>
                <div className="space-y-1"><Label className="text-xs">Vacaciones días</Label><Input type="number" step="1" value={editing.vacaciones_dias ?? diasVacacionesRD(Number(editing.anios_servicio || 0))} readOnly className="bg-muted/40" /></div>
                <div className="space-y-1"><Label className="text-xs">Vacaciones monto</Label><Input type="number" step="0.01" value={editing.vacaciones_monto ?? 0} onChange={e => setEditing({ ...editing, vacaciones_monto: Number(e.target.value) })} /></div>
                <div className="space-y-1"><Label className="text-xs">Navidad proporcional</Label><Input value={fmtNav(editing.navidad_meses ?? 0, editing.navidad_dias ?? 0)} readOnly className="bg-muted/40" /></div>
                <div className="space-y-1"><Label className="text-xs">Navidad monto</Label><Input type="number" step="0.01" value={editing.navidad_monto ?? 0} onChange={e => setEditing({ ...editing, navidad_monto: Number(e.target.value) })} /></div>
                <div className="space-y-1"><Label className="text-xs">Salario pendiente</Label><Input type="number" step="0.01" value={editing.salario_pendiente ?? 0} onChange={e => setEditing({ ...editing, salario_pendiente: Number(e.target.value) })} /></div>
                <div className="space-y-1"><Label className="text-xs">Otros ingresos</Label><Input type="number" step="0.01" value={editing.otros_ingresos ?? 0} onChange={e => setEditing({ ...editing, otros_ingresos: Number(e.target.value) })} /></div>
                <div className="space-y-1"><Label className="text-xs">Descuentos</Label><Input type="number" step="0.01" value={editing.descuentos ?? 0} onChange={e => setEditing({ ...editing, descuentos: Number(e.target.value) })} /></div>
              </div>

              <div className="rounded-lg border bg-muted/30 p-2 text-sm space-y-1">
                <div className="flex justify-between"><span className="text-muted-foreground">Subtotal (preaviso + cesantía + vacaciones)</span><span className="font-mono">{rd(subtotal)}</span></div>
                <div className="flex justify-between border-t pt-1 font-bold"><span>Total a recibir</span><span className="font-mono">{rd(totalCalc)}</span></div>
              </div>
              <div className="space-y-1"><Label className="text-xs">Observaciones</Label><Input value={editing.observations || ""} onChange={e => setEditing({ ...editing, observations: e.target.value })} /></div>
              <p className="text-[11px] text-amber-700">Cálculo referencial — validar con asesoría legal/contable antes de aprobar.</p>
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
