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
import { Search, Save, Send, CheckCircle2, Loader2, Check, ClipboardCheck, Scale, TrendingUp, TrendingDown, ScanLine, TriangleAlert } from "lucide-react"
import { fmtQty, diffConteo, CONTEO_ESTADO_LABEL, type ConteoEstado, type ConteoConItems } from "@/lib/productos-client"
import { matchProductByCode, normalizeBarcode, isRepeatScan, ajusteVisibilidad } from "@/lib/productos-scan"
import { BarcodeScanner, useBarcodeWedge, beep } from "@/components/productos/barcode-scanner"

interface ProductoLinea {
  id: string
  nombre: string
  sku: string
  sistema: number
  activo: boolean
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

  const [scannerOn, setScannerOn] = useState(false)
  const [ultimo, setUltimo] = useState<{ id: string; nombre: string; cantidad: number } | null>(null)
  /** Casillas de cantidad por producto: al escanear se enfoca la del producto leído. */
  const cantidadRefs = useRef<Record<string, HTMLInputElement | null>>({})
  /** Caja de escaneo: el cursor vuelve aquí solo tras cada lectura. */
  const cajaRef = useRef<HTMLInputElement | null>(null)
  const [desconocidos, setDesconocidos] = useState<Record<string, number>>({})

  const dirty = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ultimaLectura = useRef<{ code: string; at: number } | null>(null)
  const productosRef = useRef<ProductoLinea[]>([])

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
        // Solo activos: los inactivos están fuera del inventario.
        apiJsonp(endpoint, { action: "getProductStockReport", sucursales: sucursal, soloActivos: "true" }),
        apiJsonp(endpoint, { action: "getProductCountDraft", sucursal, fecha }),
      ])
      if (!stockRes?.ok) throw new Error(String(stockRes?.error || "No se pudieron cargar las existencias"))

      const lineas: ProductoLinea[] = ((stockRes.records as { id: string; nombre: string; sku: string; activo?: boolean; stock: Record<string, number> }[]) || [])
        .map((p) => ({ id: p.id, nombre: p.nombre, sku: p.sku || "", sistema: Number(p.stock?.[sucursal]) || 0, activo: p.activo !== false }))
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

  // El handler del escáner no debe recrearse en cada tecleo: lee el catálogo
  // por referencia para que la pistola siga funcionando sin re-suscribirse.
  useEffect(() => { productosRef.current = productos }, [productos])

  // ── Lectura de código de barra (cámara o pistola) ──────────────────────────
  /**
   * Una lectura = UNA unidad, y va sumando.
   *
   * `origen` importa: la CÁMARA devuelve el mismo código muchas veces por
   * segundo mientras el envase siga delante del lente, así que ahí sí hay que
   * ignorar repeticiones. La pistola y la caja de escaneo, no: cada disparo es
   * deliberado, y bloquearlos impedía contar varias unidades del mismo producto.
   */
  const onScan = useCallback((raw: string, origen: "camara" | "lector" | "caja" = "lector"): boolean => {
    const code = normalizeBarcode(raw)
    if (!code) return false
    if (origen === "camara") {
      const ahora = Date.now()
      if (isRepeatScan(code, ultimaLectura.current, ahora)) return false
      ultimaLectura.current = { code, at: ahora }
    }

    if (estado === "aprobado") {
      showToast("Este conteo ya está aprobado: no admite más lecturas", "error")
      return false
    }

    const prod = matchProductByCode(code, productosRef.current)
    if (!prod) {
      // Desde la caja de escaneo no se avisa: puede ser que estés escribiendo
      // el nombre de un producto para filtrar, no un código.
      if (origen === "caja") return false
      beep(false)
      setDesconocidos((prev) => ({ ...prev, [code]: (prev[code] || 0) + 1 }))
      showToast(`Código ${code} no está en el catálogo`, "error")
      return false
    }

    dirty.current = true
    setContado((prev) => {
      const siguiente = (Number(prev[prod.id]) || 0) + 1
      setUltimo({ id: prod.id, nombre: prod.nombre, cantidad: siguiente })
      return { ...prev, [prod.id]: String(siguiente) }
    })
    // Que la fila se vea, aunque la escondan el buscador o el filtro de ceros.
    const arregla = ajusteVisibilidad(
      { nombre: prod.nombre, sku: prod.sku, sistema: prod.sistema, contado: contadoRef.current[prod.id] ?? "" },
      { search: searchRef.current, incluirCeros: cerosRef.current },
    )
    if (arregla.limpiarBusqueda) setSearch("")
    if (arregla.mostrarCeros) setIncluirCeros(true)
    // Se lleva la vista a la fila, pero NO el cursor: el cursor vive en la caja
    // de escaneo para que la siguiente lectura entre sin tocar nada.
    requestAnimationFrame(() => {
      cantidadRefs.current[prod.id]?.scrollIntoView({ block: "center", behavior: "smooth" })
    })
    beep(true)
    return true
  }, [estado, showToast])

  // Espejos para que `onScan` lea el estado actual sin recrearse en cada tecla.
  const contadoRef = useRef(contado); contadoRef.current = contado
  const searchRef = useRef(search); searchRef.current = search
  const cerosRef = useRef(incluirCeros); cerosRef.current = incluirCeros

  // La pistola lectora escucha siempre, sin abrir la cámara ni hacer clic.
  useBarcodeWedge((c) => { onScan(c, "lector") }, Boolean(sucursal) && estado !== "aprobado")

  // ── Estado derivado ────────────────────────────────────────────────────────
  const visibles = useMemo(() => {
    const q = search.trim().toUpperCase()
    return productos.filter((p) => {
      const contadoYa = String(contado[p.id] ?? "").trim() !== ""
      if (!incluirCeros && p.sistema === 0 && !contadoYa) return false
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
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
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
              <Button
                variant={scannerOn ? "default" : "outline"}
                className="h-10"
                onClick={() => setScannerOn((v) => !v)}
                disabled={bloqueado || !sucursal}
              >
                <ScanLine className="mr-1.5 h-4 w-4" />{scannerOn ? "Cerrar escáner" : "Escanear"}
              </Button>
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

      {scannerOn && sucursal && !bloqueado && (
        <BarcodeScanner onCode={(c) => { onScan(c, "camara") }} onClose={() => setScannerOn(false)} />
      )}

      {ultimo && (
        <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-bold text-emerald-900">{ultimo.nombre}</div>
            <div className="text-xs text-emerald-700">Última lectura · llevas {fmtQty(ultimo.cantidad)} contadas</div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setUltimo(null)}>Ocultar</Button>
        </div>
      )}

      {Object.keys(desconocidos).length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-bold text-amber-900">
            <TriangleAlert className="h-4 w-4" /> Códigos leídos que no están en el catálogo
          </div>
          <p className="mt-1 text-xs text-amber-800">
            Estos productos existen en el estante pero no en el archivo importado. Anótalos:
            el conteo no puede ajustarlos.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {Object.entries(desconocidos).map(([code, veces]) => (
              <Badge key={code} variant="outline" className="border-amber-300 bg-white text-amber-900">
                {code} · {veces} {veces === 1 ? "lectura" : "lecturas"}
              </Badge>
            ))}
          </div>
          <Button variant="ghost" size="sm" className="mt-2" onClick={() => setDesconocidos({})}>Limpiar</Button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard title="Productos contados" value={kpis.contados} icon={ClipboardCheck} variant="success" />
        <KpiCard title="Sin contar" value={kpis.sinContar} icon={Scale} />
        <KpiCard title="Sobrantes" value={kpis.sobrantes} icon={TrendingUp} variant="warning" />
        <KpiCard title="Faltantes" value={kpis.faltantes} icon={TrendingDown} variant="destructive" />
      </div>

      <div>
        <Label className="text-xs">Nota general del conteo (opcional)</Label>
        <Input className="mt-1 h-9" value={notas} onChange={(e) => { dirty.current = true; setNotas(e.target.value) }} disabled={bloqueado} placeholder="Observación general..." />

        {/* Caja de escaneo. Aquí vive el cursor: la pistola escribe dentro y al
            llegar el Enter se suma una unidad. También sirve para buscar a mano:
            si lo escrito no es un código conocido, se queda filtrando la lista. */}
        <div className="mt-4">
          <Label className="text-sm font-semibold">Escanear o buscar producto</Label>
          <div className="relative mt-1.5">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-6 w-6 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={cajaRef}
              autoFocus
              className="h-16 rounded-2xl pl-14 text-xl font-medium"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return
                e.preventDefault()
                // Se lee del propio campo, no del estado: la pistola teclea más
                // rápido de lo que React re-renderiza y el estado llegaría corto.
                const v = e.currentTarget.value.trim()
                if (!v) return
                if (onScan(v, "caja")) setSearch("")
              }}
              onBlur={(e) => {
                // El cursor vuelve solo, PERO nunca le quita el sitio a otro
                // campo: si vas a escribir una cantidad o una observación, mandas tú.
                const destino = (e.relatedTarget as HTMLElement | null)?.tagName?.toLowerCase()
                if (bloqueado || destino === "input" || destino === "textarea" || destino === "select" || destino === "button") return
                requestAnimationFrame(() => cajaRef.current?.focus())
              }}
              disabled={bloqueado}
              placeholder="Pasa el lector o escribe nombre o código…"
            />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Cada lectura suma una unidad. El cursor se queda aquí solo: no hace falta hacer clic entre producto y producto.
          </p>
        </div>
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
                      <tr
                        key={p.id}
                        className={`border-t border-[color:var(--brand-border)] ${
                          ultimo?.id === p.id ? "bg-emerald-50/70" : ""
                        }`}
                      >
                        <td className="px-3 py-1.5">
                          <div className="font-medium">{p.nombre}</div>
                          {p.sku && <div className="text-[11px] text-muted-foreground">{p.sku}</div>}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{fmtQty(p.sistema)}</td>
                        <td className="px-3 py-1.5 text-right">
                          <Input
                            ref={(el) => { cantidadRefs.current[p.id] = el }}
                            type="number"
                            min={0}
                            inputMode="decimal"
                            className={`ml-auto h-9 w-24 text-right ${ultimo?.id === p.id ? "ring-2 ring-emerald-400" : ""}`}
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
