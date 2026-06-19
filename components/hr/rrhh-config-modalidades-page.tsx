"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useAppStore, apiCall, normalizeApiUrl } from "@/lib/store"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { EmployeeSelect } from "@/components/hr/employee-select"
import { useCurrentBusiness } from "@/hooks/use-current-business"
import { ShieldCheck, Plus, Trash2, Save, Loader2, Globe, Building2, User } from "lucide-react"

interface ModalityConfig {
  id: string
  business_id: string
  sucursal: string | null
  employee_id: string | null
  allow_pin: boolean
  allow_qr: boolean
  allow_mobile_biometric: boolean
  allow_face: boolean
  allow_gps: boolean
  allow_kiosk: boolean
  allow_remote_punch: boolean
  require_photo: boolean
  require_location: boolean
  require_biometric: boolean
  only_within_schedule: boolean
  tolerance_minutes: number
  double_validation: boolean
  active: boolean
}

const ALLOW_FIELDS: { key: keyof ModalityConfig; label: string; hint: string }[] = [
  { key: "allow_pin", label: "PIN / código", hint: "Ponche con PIN del empleado" },
  { key: "allow_qr", label: "QR", hint: "Ponche escaneando el QR del empleado" },
  { key: "allow_mobile_biometric", label: "Biometría móvil", hint: "Huella / Face ID del celular (WebAuthn)" },
  { key: "allow_face", label: "Facial / selfie", hint: "Validación con cámara" },
  { key: "allow_gps", label: "GPS / geocerca", hint: "Ubicación dentro de la sucursal" },
  { key: "allow_kiosk", label: "Kiosko fijo", hint: "Tablet/dispositivo autorizado" },
  { key: "allow_remote_punch", label: "Ponche remoto", hint: "Permitir ponchar fuera de la sucursal" },
]
const REQUIRE_FIELDS: { key: keyof ModalityConfig; label: string; hint: string }[] = [
  { key: "require_location", label: "Ubicación obligatoria", hint: "No deja ponchar sin GPS" },
  { key: "require_photo", label: "Foto obligatoria", hint: "Exige selfie en cada ponche" },
  { key: "require_biometric", label: "Biometría obligatoria", hint: "Exige biometría del dispositivo" },
  { key: "only_within_schedule", label: "Solo dentro de horario", hint: "Bloquea ponches fuera del turno" },
  { key: "double_validation", label: "Doble validación", hint: "Exige 2 factores (ej. GPS + biometría)" },
]

function scopeLabel(c: ModalityConfig): { icon: typeof Globe; text: string; kind: string } {
  if (!c.sucursal && !c.employee_id) return { icon: Globe, text: "Global del negocio", kind: "Global" }
  if (c.sucursal && !c.employee_id) return { icon: Building2, text: c.sucursal, kind: "Sucursal" }
  return { icon: User, text: c.employee_id || "Empleado", kind: "Empleado" }
}

export function RrhhConfigModalidadesPage() {
  const apiUrl = useAppStore((s) => s.apiUrl)
  const activeBusinessSlug = useAppStore((s) => s.activeBusinessSlug)
  const showToast = useAppStore((s) => s.showToast)
  const business = useCurrentBusiness()

  const [configs, setConfigs] = useState<ModalityConfig[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<ModalityConfig | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [tableMissing, setTableMissing] = useState(false)
  const [sucursales, setSucursales] = useState<string[]>([])

  // Añadir nuevo alcance
  const [newKind, setNewKind] = useState<"sucursal" | "empleado">("sucursal")
  const [newSucursal, setNewSucursal] = useState<string>("")
  const [newEmployee, setNewEmployee] = useState<string>("")

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const url = normalizeApiUrl(apiUrl)
      const [cfgRes, geoRes] = await Promise.all([
        apiCall(url, { action: "getHrModalityConfig" }) as Promise<{ records?: ModalityConfig[]; tableMissing?: boolean }>,
        apiCall(url, { action: "getHrBranchGeofences" }) as Promise<{ records?: { sucursal: string }[] }>,
      ])
      setTableMissing(Boolean(cfgRes?.tableMissing))
      const list = (cfgRes?.records ?? [])
      setConfigs(list)
      setSucursales([...new Set((geoRes?.records ?? []).map((g) => g.sucursal).filter(Boolean))].sort())
      // Selecciona la global por defecto.
      const global = list.find((c) => !c.sucursal && !c.employee_id)
      const first = global || list[0] || null
      setSelectedId(first?.id ?? null)
      setDraft(first ? { ...first } : null)
    } catch {
      setConfigs([]); setDraft(null)
    } finally { setLoading(false) }
  }, [apiUrl])

  useEffect(() => { load() }, [load, activeBusinessSlug])

  const selectConfig = (c: ModalityConfig) => { setSelectedId(c.id); setDraft({ ...c }) }
  const setField = (k: keyof ModalityConfig, v: boolean | number) =>
    setDraft((d) => (d ? { ...d, [k]: v } : d))

  const save = async (payload: Partial<ModalityConfig>, successMsg: string) => {
    setSaving(true)
    try {
      const res = await apiCall(normalizeApiUrl(apiUrl), {
        action: "saveHrModalityConfig", data: JSON.stringify(payload),
      }) as { ok?: boolean; error?: string; tableMissing?: boolean }
      if (res?.ok) { showToast(successMsg, "success"); await load() }
      else showToast(res?.error || "No se pudo guardar", "error")
    } catch { showToast("Error de red al guardar", "error") }
    finally { setSaving(false) }
  }

  const saveDraft = () => {
    if (!draft) return
    save({
      sucursal: draft.sucursal, employee_id: draft.employee_id,
      allow_pin: draft.allow_pin, allow_qr: draft.allow_qr,
      allow_mobile_biometric: draft.allow_mobile_biometric, allow_face: draft.allow_face,
      allow_gps: draft.allow_gps, allow_kiosk: draft.allow_kiosk,
      allow_remote_punch: draft.allow_remote_punch, require_photo: draft.require_photo,
      require_location: draft.require_location, require_biometric: draft.require_biometric,
      only_within_schedule: draft.only_within_schedule, tolerance_minutes: draft.tolerance_minutes,
      double_validation: draft.double_validation, active: draft.active,
    }, "Configuración guardada")
  }

  const addScope = async () => {
    if (newKind === "sucursal" && !newSucursal) { showToast("Selecciona una sucursal", "error"); return }
    if (newKind === "empleado" && !newEmployee) { showToast("Selecciona un empleado", "error"); return }
    const exists = configs.some((c) =>
      newKind === "sucursal" ? c.sucursal === newSucursal && !c.employee_id : c.employee_id === newEmployee)
    if (exists) { showToast("Ya existe una config para ese alcance", "error"); return }
    await save({
      sucursal: newKind === "sucursal" ? newSucursal : null,
      employee_id: newKind === "empleado" ? newEmployee : null,
    }, "Alcance agregado")
    setNewSucursal(""); setNewEmployee("")
  }

  const removeScope = async (c: ModalityConfig) => {
    if (!c.sucursal && !c.employee_id) { showToast("No se puede borrar la config global", "error"); return }
    const res = await apiCall(normalizeApiUrl(apiUrl), { action: "deleteHrModalityConfig", id: c.id }) as { ok?: boolean; error?: string }
    if (res?.ok) { showToast("Alcance eliminado", "success"); await load() }
    else showToast(res?.error || "No se pudo eliminar", "error")
  }

  const sortedConfigs = useMemo(() => {
    const rank = (c: ModalityConfig) => (!c.sucursal && !c.employee_id ? 0 : c.sucursal ? 1 : 2)
    return [...configs].sort((a, b) => rank(a) - rank(b) || (a.sucursal || a.employee_id || "").localeCompare(b.sucursal || b.employee_id || ""))
  }, [configs])

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
          RR.HH. · Asistencia · {business.shortName}
        </p>
        <h2 className="mt-1 flex items-center gap-2 text-2xl font-black tracking-tight">
          <ShieldCheck className="h-6 w-6 text-cyan-600" /> Configuración de modalidades de ponche
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Define qué modalidades de ponche están habilitadas y qué validaciones son obligatorias.
          La config global aplica a todo {business.displayName}; las de sucursal o empleado la sobreescriben.
          Solo administradores pueden editar.
        </p>
      </div>

      {tableMissing && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          La tabla de configuración aún no está migrada en este entorno.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        {/* Lista de alcances */}
        <div className="space-y-3">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Alcances configurados</CardTitle></CardHeader>
            <CardContent className="space-y-1.5">
              {loading ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</p>
              ) : sortedConfigs.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin configuraciones.</p>
              ) : sortedConfigs.map((c) => {
                const sl = scopeLabel(c)
                const Icon = sl.icon
                return (
                  <div key={c.id}
                    className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm cursor-pointer transition-colors ${selectedId === c.id ? "border-cyan-300 bg-cyan-50" : "hover:bg-muted/40"}`}
                    onClick={() => selectConfig(c)}>
                    <span className="flex min-w-0 items-center gap-2">
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{sl.text}</span>
                    </span>
                    <span className="flex items-center gap-1">
                      {!c.active && <Badge variant="outline" className="text-[10px]">off</Badge>}
                      <Badge variant="secondary" className="text-[10px]">{sl.kind}</Badge>
                      {(c.sucursal || c.employee_id) && (
                        <button onClick={(e) => { e.stopPropagation(); removeScope(c) }} className="text-rose-500 hover:text-rose-700">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </span>
                  </div>
                )
              })}
            </CardContent>
          </Card>

          {/* Agregar alcance */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Agregar alcance</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <div className="flex gap-1">
                <Button size="sm" variant={newKind === "sucursal" ? "default" : "outline"} onClick={() => setNewKind("sucursal")} className="flex-1">Sucursal</Button>
                <Button size="sm" variant={newKind === "empleado" ? "default" : "outline"} onClick={() => setNewKind("empleado")} className="flex-1">Empleado</Button>
              </div>
              {newKind === "sucursal" ? (
                <Select value={newSucursal} onValueChange={setNewSucursal}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Sucursal…" /></SelectTrigger>
                  <SelectContent>
                    {sucursales.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
                <EmployeeSelect value={newEmployee} onSelect={(e) => setNewEmployee(e?.empleado_id || "")} />
              )}
              <Button size="sm" onClick={addScope} disabled={saving} className="w-full gap-2">
                <Plus className="h-4 w-4" /> Crear con valores por defecto
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Editor del alcance seleccionado */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center justify-between">
              <span>{draft ? scopeLabel(draft).text : "Selecciona un alcance"}</span>
              {draft && <Badge variant="secondary">{scopeLabel(draft).kind}</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {!draft ? (
              <p className="text-sm text-muted-foreground">Elige un alcance de la lista para editar sus modalidades.</p>
            ) : (
              <>
                <div>
                  <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">Modalidades permitidas</h4>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {ALLOW_FIELDS.map((f) => (
                      <label key={f.key} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
                        <span className="min-w-0">
                          <span className="block text-sm font-medium">{f.label}</span>
                          <span className="block text-xs text-muted-foreground">{f.hint}</span>
                        </span>
                        <Switch checked={Boolean(draft[f.key])} onCheckedChange={(v) => setField(f.key, v)} />
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">Validaciones obligatorias</h4>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {REQUIRE_FIELDS.map((f) => (
                      <label key={f.key} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
                        <span className="min-w-0">
                          <span className="block text-sm font-medium">{f.label}</span>
                          <span className="block text-xs text-muted-foreground">{f.hint}</span>
                        </span>
                        <Switch checked={Boolean(draft[f.key])} onCheckedChange={(v) => setField(f.key, v)} />
                      </label>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap items-end gap-4">
                  <div className="space-y-1">
                    <Label htmlFor="tol" className="text-xs">Tolerancia de tardanza (min)</Label>
                    <Input id="tol" type="number" min={0} className="h-9 w-[160px]"
                      value={draft.tolerance_minutes}
                      onChange={(e) => setField("tolerance_minutes", Math.max(0, Number(e.target.value) || 0))} />
                  </div>
                  <label className="flex items-center gap-2 rounded-lg border px-3 py-2">
                    <Switch checked={draft.active} onCheckedChange={(v) => setField("active", v)} />
                    <span className="text-sm font-medium">Configuración activa</span>
                  </label>
                </div>

                <div className="flex gap-2 border-t pt-4">
                  <Button onClick={saveDraft} disabled={saving} className="gap-2">
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Guardar cambios
                  </Button>
                  {(draft.sucursal || draft.employee_id) && (
                    <Button variant="outline" onClick={() => removeScope(draft)} className="gap-2 text-rose-600">
                      <Trash2 className="h-4 w-4" /> Eliminar alcance
                    </Button>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
