"use client"

/**
 * Inventario de Productos › Conteo físico (captura manual).
 *
 * Eliges sucursal y fecha; el sistema carga los productos con la cantidad que
 * tiene registrada CONGELADA en ese momento, y tú escribes lo contado. La
 * diferencia se ve en vivo. Se guarda como borrador (autoguardado) y al
 * APROBAR el stock del sistema pasa a ser lo contado.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useAppStore, apiJsonp, normalizeApiUrl, invalidateReadCache } from "@/lib/store"
import { useSessionUser } from "@/hooks/use-session-user"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { KpiCard } from "@/components/kpi-card"
import { Search, Save, Send, CheckCircle2, Loader2, Check, ClipboardCheck, Scale, TrendingUp, TrendingDown } from "lucide-react"
import { fmtQty, diffConteo, CONTEO_ESTADO_LABEL, type ConteoEstado, type ConteoConItems } from "@/lib/productos-client"

interface ProductoLinea {
  id: string
  nombre: string
  sku: string
  sistema: number
}

const hoyISO = () => new Date().toISOString().slice(0, 10)

export function ProdConteoPage() {
  const { apiUrl, showToast } = useAppStore()
  const sessionUser = useSessionUser()
  const userName = sessionUser?.nombre || sessionUser?.username || ""

  const [branches, setBranches] = useState<string[]>([])
  const [sucursal, setSucursal] = useState("")
  const [fecha, setFecha] = useState(hoyISO())
  const [productos, setProductos] = useState<ProductoLinea[]>([])
  const [contado, setContado] = useState<Record<string, string>>({})
  const [obs, setObs] = useState<Record<string, string>>({})
  const [notas, setNotas] = useState("")
  const [responsable, setResponsable] = useState("")
  const [conteoId, setConteoId] = useState<string | null>(null)
  const [estado, setEstado] = useState<ConteoEstado | null>(null)
  const [search, setSearch] = useState("")
  const [incluirCeros, setIncluirCeros] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [autosave, setAutosave] = useState<"idle" | "saving" | "saved">("idle")

  const dirty = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const load = async () => {
      try {
        const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "getProductBranches" })
        if (res?.ok) {
          const list = (res.records as string[]) || []
          setBranches(list)
          if (list.length === 1) setSucursal(list[0])
        }
      } catch (e) {
        showToast(e instanceof Error ? e.message : "Error al cargar sucursales", "error")
      } finally {
        setLoading(false)
      }
    }
    void load()
    setResponsable(userName)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiUrl])

  // ── Abrir el conteo de (sucursal, fecha): existencias + borrador previo ────
  const abrir = useCallback(async () => {
    if (!sucursal || !fecha) {
      setProductos([]); setContado({}); setObs({}); setConteoId(null); setEstado(null)
      return
    }
    setLoading(true)
    dirty.current = false
    try {
      const endpoint = normalizeApiUrl(apiUrl)
      const [stockRes, draftRes] = await Promise.all([
        apiJsonp(endpoint, { action: "getProductStockReport", sucursales: sucursal }),
        apiJsonp(endpoint, { action: "getProductCountDraft", sucursal, fecha }),
      ])
      if (!stockRes?.ok) throw new Error(String(stockRes?.error || "No se pudieron cargar las existencias"))

      const lineas: ProductoLinea[] = ((stockRes.records as { id: string; nombre: string; sku: string; stock: Record<string, number> }[]) || [])
        .map((p) => ({ id: p.id, nombre: p.nombre, sku: p.sku || "", sistema: Number(p.stock?.[sucursal]) || 0 }))
        .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))
      setProductos(lineas)

      const draft = draftRes?.ok ? (draftRes.record as ConteoConItems | null) : null
      if (draft) {
        const c: Record<string, string> = {}
        const o: Record<string, string> = {}
        for (const it of draft.items || []) {
          if (!it.productoId) continue
          c[it.productoId] = String(it.cantidadContada)
          if (it.observacion) o[it.productoId] = it.observacion
        }
        setContado(c); setObs(o)
        setConteoId(draft.id)
        setEstado(draft.estado)
        setNotas(draft.notas || "")
        setResponsable(draft.responsable || userName)
      } else {
        setContado({}); setObs({}); setConteoId(null); setEstado(null); setNotas("")
        setResponsable(userName)
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error al abrir el conteo", "error")
    } finally {
      setLoading(false)
    }
  }, [apiUrl, sucursal, fecha, userName, showToast])

  useEffect(() => { void abrir() }, [abrir])

  // ── Estado derivado ────────────────────────────────────────────────────────
  const visibles = useMemo(() => {
    const q = search.trim().toUpperCase()
    return productos.filter((p) => {
      if (!incluirCeros && p.sistema === 0 && !contado[p.id]) return false
      if (!q) return true
      return p.nombre.toUpperCase().includes(q) || p.sku.toUpperCase().includes(q)
    })
  }, [productos, search, incluirCeros, contado])

  const itemsContados = useMemo(
    () => productos.filter((p) => String(contado[p.id] ?? "").trim() !== ""),
    [productos, contado],
  )

  const kpis = useMemo(() => {
    let sobrantes = 0
    let faltantes = 0
    let unidades = 0
    for (const p of itemsContados) {
      const q = Number(contado[p.id]) || 0
      const d = diffConteo(p.sistema, q)
      unidades += q
      if (d > 0) sobrantes += 1
      if (d < 0) faltantes += 1
    }
    return { contados: itemsContados.length, sinContar: productos.length - itemsContados.length, sobrantes, faltantes, unidades }
  }, [itemsContados, contado, productos.length])

  const payloadItems = useCallback(
    () =>
      itemsContados.map((p) => ({
        productoId: p.id,
        nombre: p.nombre,
        sku: p.sku || null,
        cantidadSistema: p.sistema,
        cantidadContada: Number(contado[p.id]) || 0,
        observacion: obs[p.id] || null,
      })),
    [itemsContados, contado, obs],
  )

  const guardar = useCallback(
    async (nuevoEstado: "borrador" | "enviado", silencioso = false) => {
      if (!sucursal || !fecha) return
      if (!silencioso) setSaving(true)
      else setAutosave("saving")
      try {
        const res = await apiJsonp(normalizeApiUrl(apiUrl), {
          action: "saveProductCount",
          id: conteoId || "",
          sucursal,
          fecha,
          estado: nuevoEstado,
          notas,
          responsable,
          userName,
          items: JSON.stringify(payloadItems()),
        })
        if (!res?.ok) throw new Error(String(res?.error || "No se pudo guardar"))
        const rec = res.record as { id: string; estado: ConteoEstado }
        setConteoId(rec.id)
        setEstado(rec.estado)
        dirty.current = false
        if (silencioso) {
          setAutosave("saved")
          setTimeout(() => setAutosave("idle"), 2000)
        } else {
          showToast(nuevoEstado === "enviado" ? "Conteo enviado para aprobación" : "Borrador guardado", "success")
        }
      } catch (e) {
        setAutosave("idle")
        showToast(e instanceof Error ? e.message : "Error al guardar", "error")
      } finally {
        if (!silencioso) setSaving(false)
      }
    },
    [apiUrl, conteoId, sucursal, fecha, notas, responsable, userName, payloadItems, showToast],
  )

  // Autoguardado: 3 s después de la última tecla, si hay algo que guardar.
  useEffect(() => {
    if (!dirty.current || estado === "aprobado" || !sucursal) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void guardar("borrador", true), 3000)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [contado, obs, notas, estado, sucursal, guardar])

  const aprobar = async () => {
    if (!conteoId) {
      showToast("Guarda el conteo antes de aprobarlo", "error")
      return
    }
    const dif = kpis.sobrantes + kpis.faltantes
    const msg = `Vas a APROBAR el conteo de ${sucursal}.\n\nLa existencia del sistema pasará a ser lo contado en ${kpis.contados} productos${dif ? ` (${dif} con diferencia)` : ""}.\n\n¿Continuar?`
    if (!window.confirm(msg)) return
    setSaving(true)
    try {
      await guardar("borrador", true)
      const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "approveProductCount", id: conteoId, userName })
      if (!res?.ok) throw new Error(String(res?.error || "No se pudo aprobar"))
      invalidateReadCache()
      showToast(`Conteo aprobado: ${res.ajustados} productos ajustados`, "success")
      void abrir()
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error al aprobar", "error")
    } finally {
      setSaving(false)
    }
  }

  const bloqueado = estado === "aprobado"
  const setQty = (id: string, v: string) => { dirty.current = true; setContado((p) => ({ ...p, [id]: v })) }
  const setNota = (id: string, v: string) => { dirty.current = true; setObs((p) => ({ ...p, [id]: v })) }

  return (
    <div className="space-y-5">
      <Card className="border-[color:var(--brand-border)]">
        <CardContent className="flex flex-col gap-3 p-3 sm:p-4">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
            <div>
              <Label className="text-xs">Sucursal *</Label>
              <Select value={sucursal} onValueChange={setSucursal}>
                <SelectTrigger className="mt-1 h-10"><SelectValue placeholder="Selecciona sucursal" /></SelectTrigger>
                <SelectContent>
                  {branches.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Fecha del conteo *</Label>
              <Input type="date" className="mt-1 h-10" value={fecha} onChange={(e) => setFecha(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Responsable</Label>
              <Input className="mt-1 h-10" value={responsable} onChange={(e) => { dirty.current = true; setResponsable(e.target.value) }} disabled={bloqueado} />
            </div>
            <div>
              <Label className="text-xs">Buscar producto</Label>
              <div className="relative mt-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input className="h-10 pl-8" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nombre o código..." />
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-3 text-xs">
              {estado && (
                <Badge
                  variant="outline"
                  className={
                    estado === "aprobado"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : estado === "enviado"
                        ? "border-sky-200 bg-sky-50 text-sky-700"
                        : "border-amber-200 bg-amber-50 text-amber-700"
                  }
                >
                  {CONTEO_ESTADO_LABEL[estado]}
                </Badge>
              )}
              {autosave === "saving" && <span className="flex items-center gap-1 text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Guardando…</span>}
              {autosave === "saved" && <span className="flex items-center gap-1 text-emerald-600"><Check className="h-3 w-3" /> Guardado</span>}
              <label className="flex cursor-pointer items-center gap-2">
                <Checkbox checked={incluirCeros} onCheckedChange={(v) => setIncluirCeros(v === true)} />
                Incluir productos en cero
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" className="h-10" onClick={() => void guardar("borrador")} disabled={saving || bloqueado || !sucursal}>
                {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}Guardar borrador
              </Button>
              <Button variant="outline" className="h-10" onClick={() => void guardar("enviado")} disabled={saving || bloqueado || !itemsContados.length}>
                <Send className="mr-1.5 h-4 w-4" />Enviar
              </Button>
              <Button className="h-10" onClick={aprobar} disabled={saving || bloqueado || !itemsContados.length}>
                <CheckCircle2 className="mr-1.5 h-4 w-4" />Aprobar y ajustar
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard title="Productos contados" value={kpis.contados} icon={ClipboardCheck} variant="success" />
        <KpiCard title="Sin contar" value={kpis.sinContar} icon={Scale} />
        <KpiCard title="Sobrantes" value={kpis.sobrantes} icon={TrendingUp} variant="warning" />
        <KpiCard title="Faltantes" value={kpis.faltantes} icon={TrendingDown} variant="destructive" />
      </div>

      <div>
        <Label className="text-xs">Nota general del conteo (opcional)</Label>
        <Input className="mt-1 h-9" value={notas} onChange={(e) => { dirty.current = true; setNotas(e.target.value) }} disabled={bloqueado} placeholder="Observación general..." />
      </div>

      <Card className="border-[color:var(--brand-border)]">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
            </div>
          ) : !sucursal ? (
            <p className="py-12 text-center text-sm text-muted-foreground">Selecciona una sucursal para comenzar el conteo.</p>
          ) : visibles.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No hay productos que mostrar{search ? " para esa búsqueda" : ""}.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Producto</th>
                    <th className="px-3 py-2 text-right">Sistema</th>
                    <th className="px-3 py-2 text-right">Contado</th>
                    <th className="px-3 py-2 text-right">Diferencia</th>
                    <th className="px-3 py-2 text-left">Observación</th>
                  </tr>
                </thead>
                <tbody>
                  {visibles.map((p) => {
                    const valor = contado[p.id] ?? ""
                    const tiene = String(valor).trim() !== ""
                    const d = tiene ? diffConteo(p.sistema, Number(valor) || 0) : null
                    return (
                      <tr key={p.id} className="border-t border-[color:var(--brand-border)]">
                        <td className="px-3 py-1.5">
                          <div className="font-medium">{p.nombre}</div>
                          {p.sku && <div className="text-[11px] text-muted-foreground">{p.sku}</div>}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{fmtQty(p.sistema)}</td>
                        <td className="px-3 py-1.5 text-right">
                          <Input
                            type="number"
                            min={0}
                            inputMode="decimal"
                            className="ml-auto h-9 w-24 text-right"
                            value={valor}
                            onChange={(e) => setQty(p.id, e.target.value)}
                            disabled={bloqueado}
                          />
                        </td>
                        <td className={`px-3 py-1.5 text-right tabular-nums font-semibold ${
                          d === null ? "text-muted-foreground" : d === 0 ? "text-emerald-600" : d > 0 ? "text-amber-600" : "text-rose-600"
                        }`}>
                          {d === null ? "—" : d > 0 ? `+${fmtQty(d)}` : fmtQty(d)}
                        </td>
                        <td className="px-3 py-1.5">
                          <Input
                            className="h-9"
                            value={obs[p.id] || ""}
                            onChange={(e) => setNota(p.id, e.target.value)}
                            disabled={bloqueado}
                            placeholder="—"
                          />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
