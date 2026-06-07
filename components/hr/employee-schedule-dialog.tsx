"use client"

import { useEffect, useMemo, useState } from "react"
import { apiCall, normalizeApiUrl, useAppStore } from "@/lib/store"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Loader2, Save, X, Clock } from "lucide-react"

const DOW = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"]
interface DayRow { day_of_week: number; is_working_day: boolean; start_time: string; end_time: string; break_minutes: number }

function defaultDays(): DayRow[] {
  // L-V 9:00-20:00, Sáb 8:00-16:00, Dom libre (0=Dom … 6=Sáb).
  return [0, 1, 2, 3, 4, 5, 6].map(d => {
    if (d === 0) return { day_of_week: 0, is_working_day: false, start_time: "", end_time: "", break_minutes: 0 }
    if (d === 6) return { day_of_week: 6, is_working_day: true, start_time: "08:00", end_time: "16:00", break_minutes: 0 }
    return { day_of_week: d, is_working_day: true, start_time: "09:00", end_time: "20:00", break_minutes: 0 }
  })
}
const hhmm = (v: unknown) => { const s = String(v ?? ""); return /^\d{2}:\d{2}/.test(s) ? s.slice(0, 5) : "" }

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
            if (dw >= 0 && dw <= 6) base[dw] = { day_of_week: dw, is_working_day: d.is_working_day !== false, start_time: hhmm(d.start_time), end_time: hhmm(d.end_time), break_minutes: Number(d.break_minutes || 0) }
          }
          setDays(base)
        }
      } catch (e) { showToast(e instanceof Error ? e.message : "Error", "error") } finally { setLoading(false) }
    })()
  }, [employeeId]) // eslint-disable-line react-hooks/exhaustive-deps

  const setDay = (i: number, patch: Partial<DayRow>) => setDays(prev => prev.map((d, idx) => idx === i ? { ...d, ...patch } : d))

  // Resumen semanal en tiempo real (cruce de medianoche soportado).
  const resumen = useMemo(() => {
    const toMin = (t: string) => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ""); return m ? Number(m[1]) * 60 + Number(m[2]) : null }
    let lab = 0, bruto = 0, desc = 0
    for (const d of days) {
      if (!d.is_working_day) continue
      lab++
      const s = toMin(d.start_time), e = toMin(d.end_time)
      if (s == null || e == null) continue
      let mins = e - s; if (mins <= 0) mins += 24 * 60 // salida < entrada → cruce de medianoche
      bruto += mins / 60
      desc += (Number(d.break_minutes) || 0) / 60
    }
    const neto = Math.max(0, bruto - desc)
    return { lab, libres: 7 - lab, bruto, desc, neto, prom: lab > 0 ? neto / lab : 0 }
  }, [days])
  const h1 = (n: number) => `${(Math.round(n * 100) / 100).toLocaleString("es-DO", { maximumFractionDigits: 2 })} h`

  const save = async () => {
    setSaving(true)
    try {
      const payload = { id: id || undefined, employee_id: employeeId, name, sucursal: suc, effective_from: from, effective_to: to, active: true, days }
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
                      <Input type="time" value={d.start_time} onChange={e => setDay(i, { start_time: e.target.value })} className="h-8 w-28" />
                      <span className="text-muted-foreground">a</span>
                      <Input type="time" value={d.end_time} onChange={e => setDay(i, { end_time: e.target.value })} className="h-8 w-28" />
                      <Input type="number" min="0" step="5" value={d.break_minutes} onChange={e => setDay(i, { break_minutes: Number(e.target.value) })} className="h-8 w-20" title="Descanso (min)" />
                      <span className="text-[11px] text-muted-foreground">min desc.</span>
                    </div>
                  ) : <span className="text-xs text-muted-foreground">Libre</span>}
                </div>
              ))}
            </div>
            <div className="rounded-lg border bg-muted/20 p-3">
              <h4 className="text-sm font-bold mb-2 flex items-center gap-1.5"><Clock className="h-4 w-4 text-primary" />Resumen semanal</h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                <div><span className="text-muted-foreground">Días laborables</span><div className="font-bold text-base">{resumen.lab}</div></div>
                <div><span className="text-muted-foreground">Días libres</span><div className="font-bold text-base">{resumen.libres}</div></div>
                <div><span className="text-muted-foreground">Horas brutas</span><div className="font-bold text-base">{h1(resumen.bruto)}</div></div>
                <div><span className="text-muted-foreground">Descansos</span><div className="font-bold text-base">{h1(resumen.desc)}</div></div>
                <div><span className="text-muted-foreground">Promedio diario</span><div className="font-bold text-base">{h1(resumen.prom)}</div></div>
                <div className="rounded bg-primary/10 px-2 py-1"><span className="text-primary/80">Horas netas semanales</span><div className="font-black text-base text-primary">{h1(resumen.neto)}</div></div>
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
