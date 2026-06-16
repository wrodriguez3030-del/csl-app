"use client"

import { useEffect, useMemo, useState } from "react"
import { apiCall, normalizeApiUrl, useAppStore } from "@/lib/store"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Loader2, Save, X, Clock, AlertTriangle } from "lucide-react"
import { calculateWeeklyWorkedHours, dayWorkedHours, fmtHours, lunchMinutesForShift, WEEKLY_HOURS_LIMIT } from "@/lib/work-hours"

const DOW = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"]
interface DayRow { day_of_week: number; is_working_day: boolean; start_time: string; end_time: string; break_minutes: number; lunch_start: string; lunch_end: string }

function defaultDays(): DayRow[] {
  // L-V 9:00-20:00, Sáb 8:00-16:00, Dom libre (0=Dom … 6=Sáb).
  return [0, 1, 2, 3, 4, 5, 6].map(d => {
    if (d === 0) return { day_of_week: 0, is_working_day: false, start_time: "", end_time: "", break_minutes: 0, lunch_start: "", lunch_end: "" }
    if (d === 6) return { day_of_week: 6, is_working_day: true, start_time: "08:00", end_time: "16:00", break_minutes: 60, lunch_start: "12:00", lunch_end: "13:00" }
    return { day_of_week: d, is_working_day: true, start_time: "09:00", end_time: "20:00", break_minutes: 60, lunch_start: "13:00", lunch_end: "14:00" }
  })
}
const hhmm = (v: unknown) => { const s = String(v ?? ""); return /^\d{2}:\d{2}/.test(s) ? s.slice(0, 5) : "" }
const toMin = (t: string) => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ""); return m ? Number(m[1]) * 60 + Number(m[2]) : null }
const minToHHMM = (mins: number) => { const m = ((Math.round(mins) % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}` }
// Ventana de almuerzo de 60 min centrada en el turno (autocompletado).
function centeredLunch(start: string, end: string): { ls: string; le: string } {
  const s = toMin(start), e = toMin(end)
  if (s == null || e == null || e - s < 60) return { ls: "13:00", le: "14:00" }
  const ls = s + Math.floor((e - s - 60) / 2)
  return { ls: minToHHMM(ls), le: minToHHMM(ls + 60) }
}
// Cálculo de horas centralizado en lib/work-hours.ts (mismo usado en la tarjeta).
const dayHours = (d: DayRow): number => dayWorkedHours(d)

export function EmployeeScheduleDialog({ employeeId, employeeName, sucursal, onClose }: { employeeId: string; employeeName: string; sucursal?: string; onClose: () => void }) {
  const { apiUrl, showToast } = useAppStore()
  const call = (p: Record<string, string | number | boolean>) => apiCall(normalizeApiUrl(apiUrl), p)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [id, setId] = useState<string>("")
  const [name, setName] = useState("Horario")
  const [suc, setSuc] = useState(sucursal || "")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [days, setDays] = useState<DayRow[]>(defaultDays())

  useEffect(() => {
    (async () => {
      setLoading(true)
      try {
        const res = await call({ action: "getHrEmployeeSchedule", employee_id: employeeId }) as { ok?: boolean; schedule?: Record<string, unknown> | null; days?: Record<string, unknown>[]; tableMissing?: boolean }
        if (res?.tableMissing) { showToast("Falta aplicar la migración de horarios en db-cls", "error") }
        if (res?.schedule) {
          const s = res.schedule
          setId(String(s.id || "")); setName(String(s.name || "Horario")); setSuc(String(s.sucursal || sucursal || ""))
          setFrom(s.effective_from ? String(s.effective_from).slice(0, 10) : ""); setTo(s.effective_to ? String(s.effective_to).slice(0, 10) : "")
          const base = defaultDays()
          for (const d of (res.days || [])) {
            const dw = Number(d.day_of_week)
            if (dw >= 0 && dw <= 6) base[dw] = { day_of_week: dw, is_working_day: d.is_working_day !== false, start_time: hhmm(d.start_time), end_time: hhmm(d.end_time), break_minutes: Number(d.break_minutes || 0), lunch_start: hhmm(d.lunch_start), lunch_end: hhmm(d.lunch_end) }
          }
          setDays(base)
        }
      } catch (e) { showToast(e instanceof Error ? e.message : "Error", "error") } finally { setLoading(false) }
    })()
  }, [employeeId]) // eslint-disable-line react-hooks/exhaustive-deps

  const setDay = (i: number, patch: Partial<DayRow>) => setDays(prev => prev.map((d, idx) => {
    if (idx !== i) return d
    const next = { ...d, ...patch }
    if (!next.is_working_day) {
      // Día libre → sin almuerzo.
      next.lunch_start = ""; next.lunch_end = ""; next.break_minutes = 0
    } else if (lunchMinutesForShift(next.start_time) === 0) {
      // Turno corrido (entrada 12:30) → sin almuerzo.
      next.lunch_start = ""; next.lunch_end = ""; next.break_minutes = 0
    } else if (!next.lunch_start || !next.lunch_end) {
      // Día trabajado con almuerzo y sin ventana → autocompletar 60 min.
      const { ls, le } = centeredLunch(next.start_time, next.end_time)
      next.lunch_start = ls; next.lunch_end = le; next.break_minutes = 60
    } else {
      next.break_minutes = 60
    }
    return next
  }))
  // El almuerzo es SIEMPRE 60 min: al cambiar un extremo, el otro se ajusta a ±60.
  const setLunchStart = (i: number, start: string) => { const s = toMin(start); setDay(i, { lunch_start: start, lunch_end: s != null ? minToHHMM(s + 60) : "", break_minutes: 60 }) }
  const setLunchEnd = (i: number, end: string) => { const e = toMin(end); setDay(i, { lunch_end: end, lunch_start: e != null ? minToHHMM(e - 60) : "", break_minutes: 60 }) }

  // Resumen semanal — almuerzo fijo 60 min/día (lib/work-hours.ts).
  const resumen = useMemo(() => {
    const w = calculateWeeklyWorkedHours(days)
    return { lab: w.workedDays, libres: w.freeDays, bruto: w.grossHours, desc: w.restHours, neto: w.totalHours, prom: w.avgHours, exceeds44: w.exceeds44 }
  }, [days])
  const h1 = (n: number) => `${(Math.round(n * 100) / 100).toLocaleString("es-DO", { maximumFractionDigits: 2 })} h`

  // Validación: cada día trabajado debe tener salida>entrada y almuerzo de
  // EXACTAMENTE 60 min dentro del turno; los días libres no llevan almuerzo.
  const validate = (): string | null => {
    for (const d of days) {
      if (!d.is_working_day) continue
      const s = toMin(d.start_time), e = toMin(d.end_time)
      if (s == null || e == null) return `Completa entrada y salida de ${DOW[d.day_of_week]}.`
      if (e <= s) return `En ${DOW[d.day_of_week]} la salida debe ser mayor que la entrada.`
      if (lunchMinutesForShift(d.start_time) === 0) continue // turno corrido: sin almuerzo
      const ls = toMin(d.lunch_start), le = toMin(d.lunch_end)
      if (ls == null || le == null || le - ls !== 60) return "El almuerzo debe ser de 60 minutos."
      if (ls < s || le > e) return `El almuerzo de ${DOW[d.day_of_week]} debe quedar dentro del turno.`
    }
    return null
  }

  const save = async () => {
    const err = validate()
    if (err) { showToast(err, "error"); return }
    setSaving(true)
    try {
      // Normaliza break_minutes=60 en días trabajados (almuerzo fijo) antes de guardar.
      const normDays = days.map(d => d.is_working_day ? { ...d, break_minutes: 60 } : { ...d, break_minutes: 0, lunch_start: "", lunch_end: "" })
      const payload = { id: id || undefined, employee_id: employeeId, name, sucursal: suc, effective_from: from, effective_to: to, active: true, days: normDays }
      const res = await call({ action: "saveHrEmployeeSchedule", data: JSON.stringify(payload) }) as { ok?: boolean; error?: string; tableMissing?: boolean }
      if (res?.tableMissing) { showToast("Falta aplicar la migración de horarios en db-cls", "error"); return }
      if (!res?.ok) { showToast(`Error: ${res?.error || "no se pudo guardar"}`, "error"); return }
      showToast("Horario guardado", "success"); onClose()
    } catch (e) { showToast(e instanceof Error ? e.message : "Error", "error") } finally { setSaving(false) }
  }

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Clock className="w-4 h-4" />Horario laboral · {employeeName}</DialogTitle></DialogHeader>
        {loading ? <div className="py-10 text-center text-sm text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Cargando…</div> : (
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label className="text-xs">Nombre del horario</Label><Input value={name} onChange={e => setName(e.target.value)} /></div>
              <div className="space-y-1"><Label className="text-xs">Sucursal</Label><Input value={suc} onChange={e => setSuc(e.target.value)} placeholder="Sin sucursal asignada" /></div>
              <div className="space-y-1"><Label className="text-xs">Efectivo desde</Label><Input type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
              <div className="space-y-1"><Label className="text-xs">Efectivo hasta (opcional)</Label><Input type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
            </div>
            <div className="border rounded-lg divide-y">
              {days.map((d, i) => (
                <div key={i} className="flex items-center gap-2 p-2 text-sm">
                  <label className="flex items-center gap-1.5 w-28 shrink-0">
                    <input type="checkbox" checked={d.is_working_day} onChange={e => setDay(i, { is_working_day: e.target.checked })} />
                    <span className="font-medium">{DOW[i]}</span>
                  </label>
                  {d.is_working_day ? (
                    <div className="flex items-center gap-1 flex-wrap">
                      <Input type="time" value={d.start_time} onChange={e => setDay(i, { start_time: e.target.value })} className="h-8 w-24" title="Entrada" />
                      <span className="text-muted-foreground">a</span>
                      <Input type="time" value={d.end_time} onChange={e => setDay(i, { end_time: e.target.value })} className="h-8 w-24" title="Salida" />
                      {lunchMinutesForShift(d.start_time) === 0 ? (
                        <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600 dark:bg-slate-500/15 dark:text-slate-300" title="Entrada 12:30 PM: trabaja seguido">Turno corrido · sin almuerzo</span>
                      ) : (
                        <>
                          <span className="text-[11px] text-muted-foreground ml-1">Almuerzo</span>
                          <Input type="time" value={d.lunch_start} onChange={e => setLunchStart(i, e.target.value)} className="h-8 w-24" title="Almuerzo inicio (60 min)" />
                          <span className="text-muted-foreground">a</span>
                          <Input type="time" value={d.lunch_end} onChange={e => setLunchEnd(i, e.target.value)} className="h-8 w-24" title="Almuerzo fin (60 min)" />
                          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" title="Almuerzo fijo">60 min</span>
                        </>
                      )}
                      <span className="ml-1 rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-bold text-primary" title="Total neto del día">{h1(dayHours(d))}</span>
                    </div>
                  ) : <span className="text-xs text-muted-foreground">Libre</span>}
                </div>
              ))}
            </div>
            <div className={`rounded-lg border p-3 ${resumen.exceeds44 ? "border-yellow-400 bg-yellow-50 dark:bg-yellow-500/10" : "bg-muted/20"}`}>
              <h4 className="text-sm font-bold mb-2 flex items-center justify-between gap-1.5">
                <span className="flex items-center gap-1.5"><Clock className="h-4 w-4 text-primary" />Resumen semanal</span>
                {resumen.exceeds44 ? (
                  <span className="inline-flex items-center gap-1 rounded-md bg-yellow-100 px-2 py-0.5 text-[11px] font-bold text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-300"><AlertTriangle className="h-3.5 w-3.5" />Sobre 44 h</span>
                ) : null}
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                <div><span className="text-muted-foreground">Días laborables</span><div className="font-bold text-base">{resumen.lab}</div></div>
                <div><span className="text-muted-foreground">Días libres</span><div className="font-bold text-base">{resumen.libres}</div></div>
                <div><span className="text-muted-foreground">Horas brutas</span><div className="font-bold text-base">{h1(resumen.bruto)}</div></div>
                <div><span className="text-muted-foreground">Descansos</span><div className="font-bold text-base">{h1(resumen.desc)}</div></div>
                <div><span className="text-muted-foreground">Promedio diario</span><div className="font-bold text-base">{h1(resumen.prom)}</div></div>
                <div className={`rounded px-2 py-1 ${resumen.exceeds44 ? "bg-yellow-200/60 dark:bg-yellow-500/20" : "bg-primary/10"}`}>
                  <span className={resumen.exceeds44 ? "text-yellow-800 dark:text-yellow-300" : "text-primary/80"}>Total semanal</span>
                  <div className={`font-black text-base ${resumen.exceeds44 ? "text-yellow-800 dark:text-yellow-300" : "text-primary"}`}>{fmtHours(resumen.neto)} h / {WEEKLY_HOURS_LIMIT} h</div>
                </div>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">Si el empleado no tiene horario, el ponche usa el horario de la sucursal (geocerca › workday_config).</p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}><X className="w-4 h-4 mr-1" />Cancelar</Button>
          <Button onClick={save} disabled={saving || loading}>{saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}Guardar horario</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
