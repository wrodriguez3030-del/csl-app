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
import { Fingerprint, Plus, Trash2, Save, X, Loader2, KeyRound, Monitor, ArrowLeft, Delete, CheckCircle2, AlertCircle } from "lucide-react"
import { useCurrentBusiness } from "@/hooks/use-current-business"

interface HrPunch {
  id: string
  employee_id: string
  type: string
  punched_at: string
  sucursal: string | null
  source: string
  is_correction: boolean
  correction_reason: string | null
}

const PUNCH_TYPES = ["entrada", "salida", "almuerzo_inicio", "almuerzo_fin", "salida_autorizada"]
const TYPE_LABEL: Record<string, string> = {
  entrada: "Entrada", salida: "Salida", almuerzo_inicio: "Inicio almuerzo",
  almuerzo_fin: "Fin almuerzo", salida_autorizada: "Salida autorizada",
}
const TYPE_CLASS: Record<string, string> = {
  entrada: "bg-emerald-100 text-emerald-700 border-emerald-200",
  salida: "bg-blue-100 text-blue-700 border-blue-200",
  almuerzo_inicio: "bg-amber-100 text-amber-700 border-amber-200",
  almuerzo_fin: "bg-amber-100 text-amber-700 border-amber-200",
  salida_autorizada: "bg-purple-100 text-purple-700 border-purple-200",
}

function fmtDateTime(iso: string): string {
  if (!iso) return "—"
  const d = new Date(iso)
  return d.toLocaleString("es-DO", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
}

export function RrhhPonchePage() {
  const { apiUrl, showToast } = useAppStore()
  const business = useCurrentBusiness()
  const [mode, setMode] = useState<"admin" | "kiosk">("admin")

  const call = (params: Record<string, string | number | boolean>) => apiCall(normalizeApiUrl(apiUrl), params)

  // ── Admin ──────────────────────────────────────────────────────────────
  const [punches, setPunches] = useState<HrPunch[]>([])
  const [tableMissing, setTableMissing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [correction, setCorrection] = useState<Partial<HrPunch> | null>(null)
  const [pinDialog, setPinDialog] = useState<{ employee_id: string; pin: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [search, setSearch] = useState("")

  const reload = async () => {
    setLoading(true)
    try {
      const res = await call({ action: "getHrPunches" }) as { ok?: boolean; records?: HrPunch[]; tableMissing?: boolean }
      setTableMissing(Boolean(res?.tableMissing))
      setPunches(res?.records ?? [])
    } catch (err) {
      showToast(`Error al cargar ponches: ${err instanceof Error ? err.message : String(err)}`, "error")
    } finally { setLoading(false) }
  }
  useEffect(() => { if (mode === "admin") reload() }, [mode])

  const filtered = useMemo(() => {
    if (!search) return punches
    const q = search.toLowerCase()
    return punches.filter(p => String(p.employee_id).toLowerCase().includes(q))
  }, [punches, search])

  const handleSaveCorrection = async () => {
    if (!correction) return
    if (!correction.employee_id?.trim() || !correction.type) { showToast("Empleado y tipo obligatorios", "error"); return }
    if (!correction.correction_reason?.trim()) { showToast("El motivo de la corrección es obligatorio", "error"); return }
    setSaving(true)
    try {
      const payload: Record<string, string | boolean> = {
        employee_id: correction.employee_id.trim(),
        type: correction.type,
        is_correction: true,
        correction_reason: correction.correction_reason.trim(),
        source: "manual",
      }
      if (correction.punched_at) payload.punched_at = new Date(correction.punched_at).toISOString()
      if (correction.sucursal) payload.sucursal = correction.sucursal
      const res = await call({ action: "saveHrPunch", data: JSON.stringify(payload) }) as { ok?: boolean; error?: string; tableMissing?: boolean }
      if (!res?.ok) { showToast(`Error: ${res?.error || "no se pudo guardar"}`, "error"); return }
      showToast("Marca registrada", "success")
      setCorrection(null)
      reload()
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error")
    } finally { setSaving(false) }
  }

  const handleSavePin = async () => {
    if (!pinDialog) return
    if (!pinDialog.employee_id.trim()) { showToast("Empleado obligatorio", "error"); return }
    setSaving(true)
    try {
      const res = await call({ action: "setHrEmployeePin", employee_id: pinDialog.employee_id.trim(), pin: pinDialog.pin }) as { ok?: boolean; error?: string }
      if (!res?.ok) { showToast(`Error: ${res?.error || "no se pudo guardar el PIN"}`, "error"); return }
      showToast(pinDialog.pin ? "PIN asignado" : "PIN eliminado", "success")
      setPinDialog(null)
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error")
    } finally { setSaving(false) }
  }

  const delPunch = async (id: string) => {
    if (!confirm("¿Eliminar esta marca de ponche?")) return
    setDeletingId(id)
    try {
      await call({ action: "deleteHrPunch", id })
      setPunches(prev => prev.filter(p => p.id !== id))
      showToast("Marca eliminada", "success")
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error")
    } finally { setDeletingId(null) }
  }

  if (mode === "kiosk") {
    return <KioskMode business={business.shortName} onExit={() => setMode("admin")} call={call} />
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-primary/10 p-2.5 text-primary"><Fingerprint className="h-6 w-6" /></div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">RR.HH. · Asistencia · {business.shortName}</p>
            <h2 className="mt-0.5 text-xl font-black tracking-tight">Ponche / Reloj checador</h2>
            <p className="mt-1 text-sm text-muted-foreground">Marcas de entrada/salida, corrección manual y gestión de PIN. Modo kiosco para el equipo.</p>
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button variant="outline" onClick={() => setPinDialog({ employee_id: "", pin: "" })}><KeyRound className="w-4 h-4 mr-1" />PIN empleado</Button>
          <Button variant="outline" onClick={() => setCorrection({ type: "entrada", punched_at: new Date().toISOString().slice(0, 16) })}><Plus className="w-4 h-4 mr-1" />Marca manual</Button>
          <Button onClick={() => setMode("kiosk")}><Monitor className="w-4 h-4 mr-1" />Modo kiosco</Button>
        </div>
      </div>

      {tableMissing && !loading && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex items-start gap-2">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-amber-600" />
          <div>La tabla <code className="text-xs bg-amber-100 px-1 rounded">hr_punches</code> aún no existe en este tenant. Aplica la migración <code className="text-xs bg-amber-100 px-1 rounded">202606020002_hr_phase2_schedules_punches.sql</code>.</div>
        </div>
      )}

      <div className="max-w-xs">
        <Label className="text-xs">Buscar empleado</Label>
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="ID empleado..." className="h-8" />
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          {loading ? (
            <div className="py-10 text-center text-sm text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Cargando ponches...</div>
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Sin marcas registradas.</div>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead className="text-xs">Empleado</TableHead>
                <TableHead className="text-xs">Tipo</TableHead>
                <TableHead className="text-xs">Fecha / hora</TableHead>
                <TableHead className="text-xs">Sucursal</TableHead>
                <TableHead className="text-xs">Origen</TableHead>
                <TableHead className="text-xs text-center w-16">Acciones</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {filtered.map(p => (
                  <TableRow key={p.id}>
                    <TableCell className="text-sm font-medium">{p.employee_id}</TableCell>
                    <TableCell><Badge variant="outline" className={TYPE_CLASS[p.type] || ""}>{TYPE_LABEL[p.type] || p.type}</Badge></TableCell>
                    <TableCell className="text-xs">{fmtDateTime(p.punched_at)}</TableCell>
                    <TableCell className="text-xs">{p.sucursal || "—"}</TableCell>
                    <TableCell className="text-xs">{p.is_correction ? <span className="text-amber-600" title={p.correction_reason || ""}>corrección</span> : p.source}</TableCell>
                    <TableCell className="text-center">
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:bg-red-50" onClick={() => delPunch(p.id)} disabled={deletingId === p.id} title="Eliminar">
                        {deletingId === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Dialog marca manual / corrección */}
      <Dialog open={!!correction} onOpenChange={open => !open && setCorrection(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Marca manual (corrección)</DialogTitle></DialogHeader>
          {correction && (
            <div className="space-y-3 py-2">
              <div className="space-y-1"><Label className="text-xs">Empleado *</Label><EmployeeSelect value={correction.employee_id} onSelect={emp => setCorrection({ ...correction, employee_id: emp?.empleado_id || "" })} /></div>
              <div className="space-y-1">
                <Label className="text-xs">Tipo *</Label>
                <Select value={correction.type || "entrada"} onValueChange={v => setCorrection({ ...correction, type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{PUNCH_TYPES.map(t => <SelectItem key={t} value={t}>{TYPE_LABEL[t]}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label className="text-xs">Fecha / hora</Label><Input type="datetime-local" value={correction.punched_at || ""} onChange={e => setCorrection({ ...correction, punched_at: e.target.value })} /></div>
                <div className="space-y-1"><Label className="text-xs">Sucursal</Label><Input value={correction.sucursal || ""} onChange={e => setCorrection({ ...correction, sucursal: e.target.value })} /></div>
              </div>
              <div className="space-y-1"><Label className="text-xs">Motivo de la corrección *</Label><Input value={correction.correction_reason || ""} onChange={e => setCorrection({ ...correction, correction_reason: e.target.value })} placeholder="Olvidó ponchar la entrada" /></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCorrection(null)} disabled={saving}><X className="w-4 h-4 mr-1" />Cancelar</Button>
            <Button onClick={handleSaveCorrection} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog PIN */}
      <Dialog open={!!pinDialog} onOpenChange={open => !open && setPinDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>PIN de empleado</DialogTitle></DialogHeader>
          {pinDialog && (
            <div className="space-y-3 py-2">
              <div className="space-y-1"><Label className="text-xs">Empleado *</Label><EmployeeSelect value={pinDialog.employee_id} onSelect={emp => setPinDialog({ ...pinDialog, employee_id: emp?.empleado_id || "" })} /></div>
              <div className="space-y-1"><Label className="text-xs">PIN (4-6 dígitos · vacío para quitar)</Label><Input value={pinDialog.pin} inputMode="numeric" onChange={e => setPinDialog({ ...pinDialog, pin: e.target.value.replace(/\D/g, "").slice(0, 6) })} placeholder="1234" /></div>
              <p className="text-xs text-muted-foreground">El PIN se guarda cifrado (hash). Sirve para que el empleado marque en el modo kiosco.</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPinDialog(null)} disabled={saving}><X className="w-4 h-4 mr-1" />Cancelar</Button>
            <Button onClick={handleSavePin} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── Modo kiosco ────────────────────────────────────────────────────────────
function KioskMode({ business, onExit, call }: {
  business: string
  onExit: () => void
  call: (p: Record<string, string | number | boolean>) => Promise<Record<string, unknown>>
}) {
  const [pin, setPin] = useState("")
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; msg: string; sub?: string } | null>(null)

  const press = (d: string) => { if (pin.length < 6) setPin(pin + d) }
  const clear = () => setPin("")
  const back = () => setPin(pin.slice(0, -1))

  const submit = async () => {
    if (pin.length < 4 || busy) return
    setBusy(true)
    try {
      const res = await call({ action: "punchByPin", pin }) as { ok?: boolean; empleado?: string; tipo?: string; error?: string }
      if (res?.ok) {
        setResult({ ok: true, msg: res.empleado || "Marca registrada", sub: TYPE_LABEL[res.tipo || ""] || res.tipo })
      } else {
        setResult({ ok: false, msg: res?.error || "PIN no válido" })
      }
    } catch {
      setResult({ ok: false, msg: "Error de conexión" })
    } finally {
      setBusy(false)
      setPin("")
      setTimeout(() => setResult(null), 3500)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-950 text-white">
      <Button variant="ghost" className="absolute top-4 left-4 text-slate-300 hover:text-white" onClick={onExit}>
        <ArrowLeft className="w-4 h-4 mr-1" />Salir del kiosco
      </Button>
      <div className="absolute top-5 right-6 text-sm font-bold uppercase tracking-widest text-cyan-400">{business}</div>

      {result ? (
        <div className="flex flex-col items-center gap-4 animate-in fade-in">
          {result.ok
            ? <CheckCircle2 className="w-24 h-24 text-emerald-400" />
            : <AlertCircle className="w-24 h-24 text-rose-400" />}
          <div className="text-3xl font-black">{result.msg}</div>
          {result.sub && <div className="text-xl text-cyan-300 font-semibold">{result.sub} registrada ✓</div>}
        </div>
      ) : (
        <>
          <h1 className="mb-2 text-2xl font-bold text-slate-200">Reloj checador</h1>
          <p className="mb-6 text-sm text-slate-400">Ingresa tu PIN y presiona ✓</p>
          <div className="mb-6 flex gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className={`h-4 w-4 rounded-full ${i < pin.length ? "bg-cyan-400" : "bg-slate-700"}`} />
            ))}
          </div>
          <div className="grid grid-cols-3 gap-3">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map(d => (
              <button key={d} onClick={() => press(d)} className="h-20 w-20 rounded-2xl bg-slate-800 text-3xl font-bold hover:bg-slate-700 active:scale-95 transition">{d}</button>
            ))}
            <button onClick={back} className="h-20 w-20 rounded-2xl bg-slate-800 text-slate-300 hover:bg-slate-700 flex items-center justify-center"><Delete className="w-7 h-7" /></button>
            <button onClick={() => press("0")} className="h-20 w-20 rounded-2xl bg-slate-800 text-3xl font-bold hover:bg-slate-700 active:scale-95 transition">0</button>
            <button onClick={submit} disabled={pin.length < 4 || busy} className="h-20 w-20 rounded-2xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 flex items-center justify-center">
              {busy ? <Loader2 className="w-8 h-8 animate-spin" /> : <CheckCircle2 className="w-8 h-8" />}
            </button>
          </div>
          <button onClick={clear} className="mt-5 text-xs text-slate-500 hover:text-slate-300">Limpiar</button>
        </>
      )}
    </div>
  )
}
