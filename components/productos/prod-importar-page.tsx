"use client"

/**
 * Inventario de Productos › Importar Excel.
 *
 * El archivo se lee EN EL NAVEGADOR (nunca se sube): SheetJS lo convierte a
 * matriz, el parser puro arma las filas y el mapeo columna→sucursal se muestra
 * para que el usuario lo confirme antes de escribir nada. Luego se envía por
 * lotes de 200 filas con un mismo identificador de importación.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useAppStore, apiJsonp, normalizeApiUrl, invalidateReadCache } from "@/lib/store"
import { useSessionUser } from "@/hooks/use-session-user"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Upload, FileText, CheckCircle2, TriangleAlert, Loader2, History } from "lucide-react"
import { loadXLSX } from "@/lib/load-xlsx"
import { detectStockColumns, unresolvedStockColumns, parseProductSheet, dedupeByClave, summarizeImport } from "@/lib/productos-import"
import { fmtQty, type ProductoRow, type StockColumn, type ImportacionRow } from "@/lib/productos-client"

const LOTE = 200
const SIN_MAPEAR = "__sin_mapear__"

interface Preview {
  archivo: string
  rows: ProductoRow[]
  columnas: StockColumn[]
  sinMapear: string[]
  hojas: string[]
}

type XlsxApi = {
  read: (data: ArrayBuffer, opts: { type: string }) => { SheetNames: string[]; Sheets: Record<string, unknown> }
  utils: { sheet_to_json: (sheet: unknown, opts: { header: number; defval: string; raw: boolean }) => unknown[][] }
}

/**
 * Parsea ambas hojas con el mapeo de columnas VIGENTE y las consolida.
 * Los activos van de últimos: si una clave aparece en las dos hojas, gana la
 * fila activa (con sus precios y su estado).
 */
function construirFilas(
  columnas: StockColumn[],
  activos: unknown[][],
  inactivos: unknown[][] | null,
): ProductoRow[] {
  const usables = columnas.filter((c) => c.sucursal)
  const confirmadas = usables.map((c) => c.sucursal)
  const filasActivas = parseProductSheet(activos, { activo: true, columnas: usables })
  // La hoja de inactivos resuelve SUS propias columnas (limitadas a las
  // sucursales confirmadas) por si trae otro orden de cabecera.
  const filasInactivas = inactivos
    ? parseProductSheet(inactivos, { activo: false, sucursales: confirmadas })
    : []
  return dedupeByClave([...filasInactivas, ...filasActivas])
}

export function ProdImportarPage() {
  const { apiUrl, showToast } = useAppStore()
  const sessionUser = useSessionUser()
  const userName = sessionUser?.nombre || sessionUser?.username || ""

  const fileRef = useRef<HTMLInputElement>(null)
  // Las matrices crudas se conservan: si el usuario corrige el mapeo de una
  // columna, hay que VOLVER A PARSEAR para que las cantidades viajen a la
  // sucursal nueva. Sin esto el reparto se quedaría con el mapeo automático.
  const matricesRef = useRef<{ activos: unknown[][]; inactivos: unknown[][] | null }>({ activos: [], inactivos: null })
  const [branches, setBranches] = useState<string[]>([])
  const [preview, setPreview] = useState<Preview | null>(null)
  const [reading, setReading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [historial, setHistorial] = useState<ImportacionRow[]>([])

  const loadHistorial = useCallback(async () => {
    try {
      const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "getProductImports" })
      if (res?.ok) setHistorial((res.records as ImportacionRow[]) || [])
    } catch {
      /* el historial es informativo: no rompe la pantalla */
    }
  }, [apiUrl])

  useEffect(() => {
    const load = async () => {
      try {
        const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "getProductBranches" })
        if (res?.ok) setBranches((res.records as string[]) || [])
      } catch (e) {
        showToast(e instanceof Error ? e.message : "Error al cargar sucursales", "error")
      }
      void loadHistorial()
    }
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiUrl])

  // ── Leer el archivo en el navegador ────────────────────────────────────────
  const onFile = async (file: File) => {
    setReading(true)
    setPreview(null)
    setProgress(0)
    try {
      const XLSX = (await loadXLSX()) as XlsxApi
      const buffer = await file.arrayBuffer()
      const wb = XLSX.read(buffer, { type: "array" })
      const toMatrix = (name: string) =>
        XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "", raw: false }) as unknown[][]

      const nombres = wb.SheetNames as string[]
      const hojaActivos = nombres.find((n) => /producto/i.test(n)) || nombres[0]
      const hojaInactivos = nombres.find((n) => /inactiv/i.test(n))
      if (!hojaActivos) throw new Error("El archivo no tiene hojas legibles")

      const matriz = toMatrix(hojaActivos)
      if (!matriz.length) throw new Error("La hoja de productos está vacía")

      const columnas = detectStockColumns(matriz[0], branches)
      const sinMapear = unresolvedStockColumns(matriz[0], branches)

      const matrizInactivos = hojaInactivos ? toMatrix(hojaInactivos) : null
      matricesRef.current = { activos: matriz, inactivos: matrizInactivos }

      const rows = construirFilas(columnas, matriz, matrizInactivos)
      if (!rows.length) throw new Error("No se encontró ningún producto con nombre en el archivo")

      setPreview({
        archivo: file.name,
        rows,
        columnas,
        sinMapear,
        hojas: [hojaActivos, hojaInactivos].filter(Boolean) as string[],
      })
    } catch (e) {
      showToast(e instanceof Error ? e.message : "No se pudo leer el archivo", "error")
    } finally {
      setReading(false)
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  /** Cambiar a mano la sucursal de una columna (o dejarla sin importar). */
  const remap = (index: number, sucursal: string) => {
    setPreview((prev) => {
      if (!prev) return prev
      const columnas = prev.columnas.map((c) => (c.index === index ? { ...c, sucursal } : c))
      const { activos, inactivos } = matricesRef.current
      return { ...prev, columnas, rows: construirFilas(columnas, activos, inactivos) }
    })
  }

  const resumen = useMemo(() => (preview ? summarizeImport(preview.rows) : null), [preview])
  const sucursalesDestino = useMemo(
    () => [...new Set((preview?.columnas || []).map((c) => c.sucursal).filter(Boolean))],
    [preview],
  )

  // ── Enviar al servidor por lotes ───────────────────────────────────────────
  const importar = async () => {
    if (!preview || !resumen) return
    if (!sucursalesDestino.length) {
      showToast("Ninguna columna de existencia está asignada a una sucursal", "error")
      return
    }
    setImporting(true)
    setProgress(0)
    const importId = crypto.randomUUID()
    const endpoint = normalizeApiUrl(apiUrl)
    // Solo se manda la existencia de las columnas confirmadas por el usuario.
    const permitidas = new Set(sucursalesDestino)
    const filas = preview.rows.map((r) => ({
      ...r,
      stock: Object.fromEntries(Object.entries(r.stock).filter(([s]) => permitidas.has(s))),
    }))

    let creados = 0
    let actualizados = 0
    let descartados = 0
    try {
      for (let i = 0; i < filas.length; i += LOTE) {
        const lote = filas.slice(i, i + LOTE)
        const esUltimo = i + LOTE >= filas.length
        const res = await apiJsonp(endpoint, {
          action: "importProducts",
          importId,
          rows: JSON.stringify(lote),
          archivo: preview.archivo,
          sucursales: sucursalesDestino.join(","),
          esUltimoLote: esUltimo ? "true" : "false",
          userName,
          filasLeidas: filas.length,
          totalCreados: creados,
          totalActualizados: actualizados,
          totalDescartados: descartados,
          unidadesTotal: resumen.unidades,
        })
        if (!res?.ok) throw new Error(String(res?.error || "Falló la importación"))
        creados += Number(res.creados) || 0
        actualizados += Number(res.actualizados) || 0
        descartados += Number(res.descartados) || 0
        setProgress(Math.round(Math.min(100, ((i + lote.length) / filas.length) * 100)))
      }
      invalidateReadCache()
      showToast(`Importación lista: ${creados} nuevos, ${actualizados} actualizados`, "success")
      setPreview(null)
      void loadHistorial()
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error al importar", "error")
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="space-y-5">
      <Card className="border-[color:var(--brand-border)]">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Upload className="h-4 w-4 text-[color:var(--brand-primary)]" /> Cargar el archivo de productos
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Selecciona el archivo de productos (.xlsx). Se lee en tu navegador: verás el resumen y el
            reparto por sucursal <b>antes</b> de guardar nada.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f) }}
            />
            <Button className="h-10" onClick={() => fileRef.current?.click()} disabled={reading || importing}>
              {reading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <FileText className="mr-1.5 h-4 w-4" />}
              Elegir archivo
            </Button>
            {preview && <Badge variant="outline">{preview.archivo}</Badge>}
          </div>
        </CardContent>
      </Card>

      {preview && resumen && (
        <Card className="border-[color:var(--brand-border)]">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Revisa antes de importar</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-[color:var(--brand-border)] p-3">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Productos</div>
                <div className="text-2xl font-bold tabular-nums">{fmtQty(resumen.productos)}</div>
              </div>
              <div className="rounded-xl border border-[color:var(--brand-border)] p-3">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Unidades</div>
                <div className="text-2xl font-bold tabular-nums">{fmtQty(resumen.unidades)}</div>
              </div>
              <div className="rounded-xl border border-[color:var(--brand-border)] p-3">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Hojas leídas</div>
                <div className="text-sm font-medium">{preview.hojas.join(" · ")}</div>
              </div>
              <div className="rounded-xl border border-[color:var(--brand-border)] p-3">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Sucursales</div>
                <div className="text-sm font-medium">{sucursalesDestino.length || "—"}</div>
              </div>
            </div>

            <div>
              <Label className="text-xs">Columnas de existencia → sucursal</Label>
              <div className="mt-2 space-y-2">
                {preview.columnas.map((c) => (
                  <div key={c.index} className="flex flex-col gap-2 rounded-lg border border-[color:var(--brand-border)] p-2 sm:flex-row sm:items-center sm:justify-between">
                    <span className="text-sm">{c.columna.trim()}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {fmtQty(resumen.porSucursal[c.sucursal] || 0)} unidades
                      </span>
                      <Select value={c.sucursal || SIN_MAPEAR} onValueChange={(v) => remap(c.index, v === SIN_MAPEAR ? "" : v)}>
                        <SelectTrigger className="h-9 w-[200px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={SIN_MAPEAR}>No importar</SelectItem>
                          {branches.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                ))}
                {preview.columnas.length === 0 && (
                  <p className="text-sm text-amber-700">
                    No se reconoció ninguna columna de existencia en el archivo.
                  </p>
                )}
              </div>
            </div>

            {preview.sinMapear.length > 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  Estas columnas de existencia no corresponden a ninguna sucursal de este negocio y se
                  van a ignorar: <b>{preview.sinMapear.join(", ")}</b>
                </div>
              </div>
            )}

            <div className="rounded-lg border border-[color:var(--brand-border)] bg-muted/30 p-3 text-xs text-muted-foreground">
              Al importar, la existencia de las sucursales seleccionadas se <b>reemplaza</b> por la del
              archivo, y todo producto que ya no venga en él queda en cero. El catálogo, los precios y
              el estado también se actualizan.
            </div>

            {importing && <Progress value={progress} className="h-2" />}

            <div className="flex justify-end gap-2">
              <Button variant="outline" className="h-10" onClick={() => setPreview(null)} disabled={importing}>
                Cancelar
              </Button>
              <Button className="h-10" onClick={importar} disabled={importing || !sucursalesDestino.length}>
                {importing ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-4 w-4" />}
                Importar {fmtQty(resumen.productos)} productos
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="border-[color:var(--brand-border)]">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4 text-[color:var(--brand-primary)]" /> Importaciones anteriores
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {historial.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Todavía no se ha importado ningún archivo.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Fecha</th>
                    <th className="px-3 py-2 text-left">Archivo</th>
                    <th className="px-3 py-2 text-left">Sucursales</th>
                    <th className="px-3 py-2 text-right">Filas</th>
                    <th className="px-3 py-2 text-right">Nuevos</th>
                    <th className="px-3 py-2 text-right">Actualizados</th>
                    <th className="px-3 py-2 text-right">Unidades</th>
                    <th className="px-3 py-2 text-left">Usuario</th>
                  </tr>
                </thead>
                <tbody>
                  {historial.map((h) => (
                    <tr key={h.id} className="border-t border-[color:var(--brand-border)]">
                      <td className="px-3 py-2 whitespace-nowrap">
                        {h.createdAt ? new Date(h.createdAt).toLocaleString("es-DO", { dateStyle: "short", timeStyle: "short" }) : "—"}
                      </td>
                      <td className="px-3 py-2 text-xs">{h.archivo || "—"}</td>
                      <td className="px-3 py-2 text-xs">{(h.sucursales || []).map((s) => s.sucursal).join(", ") || "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtQty(h.filasLeidas)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtQty(h.productosCreados)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtQty(h.productosActualizados)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtQty(h.unidadesTotal)}</td>
                      <td className="px-3 py-2 text-xs">{h.usuarioNombre || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
