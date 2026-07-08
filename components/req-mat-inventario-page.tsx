"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useAppStore, apiCallCached, apiJsonp, normalizeApiUrl, invalidateReadCache } from "@/lib/store"
import { useCurrentBusiness } from "@/hooks/use-current-business"
import { useSessionUser } from "@/hooks/use-session-user"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Boxes, Save, CheckCircle2, Eraser, Search, Loader2, Printer, Check } from "lucide-react"
import type { Material, MaterialInventory } from "@/lib/materials-client"
import { fmtNum } from "@/lib/materials-client"
import { printInventarioPdf } from "@/lib/inventario-materiales-pdf"

type Line = { qty: string; obs: string }

const todayISO = () => new Date().toISOString().slice(0, 10)

export function ReqMatInventarioPage() {
  const { apiUrl, showToast } = useAppStore()
  const business = useCurrentBusiness()
  const sessionUser = useSessionUser()
  const responsable = sessionUser?.nombre || sessionUser?.username || "—"

  const [catalog, setCatalog] = useState<Material[]>([])
  const [branches, setBranches] = useState<string[]>([])
  const [branch, setBranch] = useState("")
  const [invDate, setInvDate] = useState(todayISO())
  const [search, setSearch] = useState("")
  const [notes, setNotes] = useState("")
  const [lines, setLines] = useState<Record<string, Line>>({})
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [invStatus, setInvStatus] = useState<"borrador" | "finalizado" | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingDraft, setLoadingDraft] = useState(false)
  const [saving, setSaving] = useState(false)
  const [finalizing, setFinalizing] = useState(false)
  const [autosaveState, setAutosaveState] = useState<"idle" | "saving" | "saved">("idle")

  const dirtyRef = useRef(false)
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Handoff desde "Histórico → Editar": abre esa sucursal + fecha (borrador).
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("csl-inv-edit")
      if (raw) {
        sessionStorage.removeItem("csl-inv-edit")
        const { branch: b, date } = JSON.parse(raw) as { branch?: string; date?: string }
        if (b) setBranch(b)
        if (date) setInvDate(date)
      }
    } catch { /* ignore */ }
  }, [])

  // ── Carga inicial: catálogo (reutilizado) + sucursales del usuario ─────────
  useEffect(() => {
    const load = async () => {
      try {
        const endpoint = normalizeApiUrl(apiUrl)
        const [cat, br] = await Promise.all([
          apiCallCached(endpoint, { action: "getMaterialCatalog" }),
          apiCallCached(endpoint, { action: "getMaterialBranches" }),
        ])
        if (cat?.ok) setCatalog(((cat.records as Material[]) || []).filter((m) => m.active))
        if (br?.ok) {
          const list = (br.records as string[]) || []
          setBranches(list)
          if (list.length === 1) setBranch(list[0])
        }
      } catch (e) {
        showToast(e instanceof Error ? e.message : "Error al cargar", "error")
      } finally {
        setLoading(false)
      }
    }
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiUrl])

  // ── Al elegir sucursal + fecha: recuperar el borrador (autoguardado) ───────
  const loadDraft = useCallback(async () => {
    if (!branch || !invDate) {
      setLines({}); setCurrentId(null); setInvStatus(null); setNotes("")
      return
    }
    setLoadingDraft(true)
    dirtyRef.current = false
    try {
      const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "getInventoryDraft", branch, inventoryDate: invDate })
      const rec = res?.ok ? (res.record as MaterialInventory | null) : null
      if (rec) {
        const next: Record<string, Line> = {}
        for (const it of rec.items || []) {
          if (it.materialId) next[it.materialId] = { qty: it.quantity == null ? "" : String(it.quantity), obs: it.observation || "" }
        }
        setLines(next)
        setCurrentId(rec.id)
        setInvStatus(rec.status)
        setNotes(rec.notes || "")
      } else {
        setLines({}); setCurrentId(null); setInvStatus(null); setNotes("")
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error al cargar el borrador", "error")
    } finally {
      setLoadingDraft(false)
    }
  }, [apiUrl, branch, invDate, showToast])

  useEffect(() => { void loadDraft() }, [loadDraft])

  // ── Estado derivado ────────────────────────────────────────────────────────
  const filteredCatalog = useMemo(() => {
    const q = search.trim().toUpperCase()
    return q ? catalog.filter((m) => (m.name || "").toUpperCase().includes(q)) : catalog
  }, [catalog, search])

  const grouped = useMemo(() => {
    const g: Record<string, Material[]> = {}
    filteredCatalog.forEach((m) => { (g[m.supplierGroup || "—"] = g[m.supplierGroup || "—"] || []).push(m) })
    return Object.entries(g).sort((a, b) => a[0].localeCompare(b[0]))
  }, [filteredCatalog])

  const get = (id: string): Line => lines[id] || { qty: "", obs: "" }
  const hasQty = (l: Line) => l.qty.trim() !== "" && Number.isFinite(Number(l.qty))

  const kpis = useMemo(() => {
    const total = catalog.length
    let contados = 0
    let cantidad = 0
    for (const m of catalog) {
      const l = lines[m.id]
      if (l && hasQty(l)) { contados += 1; cantidad += Number(l.qty) || 0 }
    }
    return { total, contados, sinContar: Math.max(0, total - contados), cantidad }
  }, [catalog, lines])

  const setLine = (id: string, patch: Partial<Line>) => {
    dirtyRef.current = true
    setLines((prev) => ({ ...prev, [id]: { ...get(id), ...patch } }))
  }

  const clearAll = () => {
    dirtyRef.current = false
    setLines({}); setNotes("")
  }

  // Ítems a persistir: solo materiales con una cantidad válida (incluye 0).
  const buildItems = useCallback(() =>
    catalog
      .filter((m) => hasQty(get(m.id)))
      .map((m) => ({
        materialId: m.id,
        materialName: m.name,
        supplierGroup: m.supplierGroup,
        unit: m.unit || "unidad",
        quantity: Number(get(m.id).qty),
        observation: get(m.id).obs || "",
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [catalog, lines])

  // ── Guardado (borrador / finalizar) ────────────────────────────────────────
  const persist = useCallback(async (status: "borrador" | "finalizado", silent = false): Promise<boolean> => {
    if (!branch) { if (!silent) showToast("Selecciona una sucursal", "error"); return false }
    if (!invDate) { if (!silent) showToast("Selecciona la fecha del inventario", "error"); return false }
    const items = buildItems()
    if (status === "finalizado" && items.length === 0) {
      showToast("Registra al menos un material contado para finalizar", "error"); return false
    }
    try {
      const res = await apiJsonp(normalizeApiUrl(apiUrl), {
        action: "saveInventory",
        id: currentId || "",
        branch,
        inventoryDate: invDate,
        status,
        notes,
        userName: responsable,
        items: JSON.stringify(items),
      })
      if (!res?.ok) throw new Error((res as { error?: string })?.error || "Error al guardar")
      const rec = res.record as MaterialInventory
      if (rec?.id) setCurrentId(rec.id)
      setInvStatus(rec?.status || status)
      dirtyRef.current = false
      invalidateReadCache("getInventories")
      return true
    } catch (e) {
      if (!silent) showToast(e instanceof Error ? e.message : "Error al guardar", "error")
      return false
    }
  }, [apiUrl, branch, invDate, currentId, notes, buildItems, responsable, showToast])

  const saveDraft = async () => {
    setSaving(true)
    const ok = await persist("borrador")
    setSaving(false)
    if (ok) showToast("Borrador guardado", "success")
  }

  const finalize = async () => {
    if (finalizing) return
    setFinalizing(true)
    const ok = await persist("finalizado")
    setFinalizing(false)
    if (ok) {
      showToast("Inventario finalizado", "success")
      // El inventario finalizado es inmutable → limpiar para un nuevo conteo.
      clearAll(); setCurrentId(null); setInvStatus(null)
    }
  }

  // ── Autoguardado de borrador (evita pérdida de datos en conteos largos) ────
  useEffect(() => {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current)
    if (!dirtyRef.current || !branch || !invDate || loadingDraft) return
    if (buildItems().length === 0) return
    autosaveTimer.current = setTimeout(async () => {
      setAutosaveState("saving")
      const ok = await persist("borrador", true)
      setAutosaveState(ok ? "saved" : "idle")
      if (ok) setTimeout(() => setAutosaveState("idle"), 2500)
    }, 1500)
    return () => { if (autosaveTimer.current) clearTimeout(autosaveTimer.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, notes, branch, invDate])

  const printPdf = async () => {
    // Imprime el borrador actual tal como está (guardándolo antes si hay id).
    const items = buildItems()
    if (items.length === 0) { showToast("No hay materiales contados para imprimir", "error"); return }
    printInventarioPdf({
      inventory: {
        id: currentId || "borrador",
        branch,
        inventoryDate: invDate,
        status: (invStatus || "borrador") as "borrador" | "finalizado",
        notes,
        items: items.map((it, i) => ({
          id: String(i),
          materialName: it.materialName,
          supplierGroup: it.supplierGroup,
          quantity: it.quantity,
          unit: it.unit,
          observation: it.observation,
        })),
      },
      business,
      responsable,
      generadoPor: responsable,
      origin: window.location.origin,
    })
  }

  const canEdit = invStatus !== "finalizado"

  return (
    <div className="space-y-5">
      {/* Filtros + acciones */}
      <Card className="border-[color:var(--brand-border)]">
        <CardContent className="flex flex-col gap-3 p-3 sm:p-4">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div>
              <Label className="text-xs">Sucursal *</Label>
              <Select value={branch} onValueChange={setBranch}>
                <SelectTrigger className="mt-1 h-10"><SelectValue placeholder="Selecciona sucursal" /></SelectTrigger>
                <SelectContent>
                  {branches.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Fecha del inventario *</Label>
              <Input type="date" className="mt-1 h-10" value={invDate} onChange={(e) => setInvDate(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Buscar material</Label>
              <div className="relative mt-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input className="h-10 pl-8" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filtrar por nombre..." />
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {invStatus === "finalizado" ? (
                <Badge variant="outline" className="bg-emerald-100 text-emerald-700 border-emerald-200">Finalizado (solo lectura)</Badge>
              ) : currentId ? (
                <Badge variant="outline" className="bg-amber-100 text-amber-700 border-amber-200">Borrador</Badge>
              ) : null}
              {autosaveState === "saving" && <span className="flex items-center gap-1 text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Guardando…</span>}
              {autosaveState === "saved" && <span className="flex items-center gap-1 text-emerald-600"><Check className="h-3 w-3" /> Guardado</span>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" className="h-10" onClick={printPdf}><Printer className="mr-1.5 h-4 w-4" />PDF</Button>
              <Button variant="outline" className="h-10" onClick={clearAll} disabled={!canEdit}><Eraser className="mr-1.5 h-4 w-4" />Limpiar</Button>
              <Button variant="outline" className="h-10" onClick={saveDraft} disabled={saving || !canEdit || !branch}>
                {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}Guardar borrador
              </Button>
              <Button className="h-10" onClick={finalize} disabled={finalizing || !canEdit || !branch}>
                {finalizing ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-4 w-4" />}Finalizar inventario
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Total de materiales" value={kpis.total} />
        <KpiCard label="Materiales contados" value={kpis.contados} tone="emerald" />
        <KpiCard label="Materiales sin contar" value={kpis.sinContar} tone="amber" />
        <KpiCard label="Cantidad total registrada" value={fmtNum(kpis.cantidad)} tone="cyan" />
      </div>

      {/* Nota general */}
      <div>
        <Label className="text-xs">Nota general (opcional)</Label>
        <Input className="mt-1 h-9" value={notes} onChange={(e) => { dirtyRef.current = true; setNotes(e.target.value) }} placeholder="Observación del conteo..." disabled={!canEdit} />
      </div>

      {/* Listado por proveedor */}
      {loading || loadingDraft ? (
        <div className="py-10 text-center text-sm text-muted-foreground">Cargando materiales...</div>
      ) : !branch ? (
        <div className="py-10 text-center text-sm text-muted-foreground">Selecciona una sucursal para comenzar el conteo.</div>
      ) : grouped.length === 0 ? (
        <div className="py-10 text-center text-sm text-muted-foreground">No hay materiales en el catálogo{search ? " para esa búsqueda" : ""}.</div>
      ) : (
        grouped.map(([supplier, mats]) => (
          <Card key={supplier} className="border-[color:var(--brand-border)]">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Boxes className="h-4 w-4 text-[color:var(--brand-primary)]" /> {supplier}
                <Badge variant="secondary" className="ml-1">{mats.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th className="py-1.5">Material</th>
                      <th className="w-24 py-1.5">Unidad</th>
                      <th className="w-36 py-1.5">Cant. en existencia</th>
                      <th className="py-1.5">Observación</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mats.map((m) => {
                      const l = get(m.id)
                      const counted = hasQty(l)
                      return (
                        <tr key={m.id} className={`border-b last:border-0 ${counted ? "bg-emerald-50/40" : ""}`}>
                          <td className="py-2 font-medium">{m.name}</td>
                          <td className="py-2 text-xs text-muted-foreground">{m.unit}</td>
                          <td className="py-2">
                            <Input
                              id={`qty-${m.id}`}
                              type="number"
                              min={0}
                              step="any"
                              inputMode="decimal"
                              placeholder="0"
                              disabled={!canEdit}
                              value={l.qty}
                              onChange={(e) => setLine(m.id, { qty: e.target.value })}
                              className="h-11 w-28 text-base"
                            />
                          </td>
                          <td className="py-2">
                            <Input
                              disabled={!canEdit}
                              value={l.obs}
                              onChange={(e) => setLine(m.id, { obs: e.target.value })}
                              placeholder="Opcional"
                              className="h-11"
                            />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  )
}

function KpiCard({ label, value, tone = "slate" }: { label: string; value: number | string; tone?: "slate" | "emerald" | "amber" | "cyan" }) {
  const toneCls: Record<string, string> = {
    slate: "text-slate-700",
    emerald: "text-emerald-600",
    amber: "text-amber-600",
    cyan: "text-cyan-600",
  }
  return (
    <Card className="border-[color:var(--brand-border)]">
      <CardContent className="p-3">
        <div className={`text-2xl font-bold ${toneCls[tone]}`}>{value}</div>
        <div className="mt-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  )
}
