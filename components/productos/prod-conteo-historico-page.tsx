"use client"

/**
 * Inventario de Productos › Histórico de conteos.
 *
 * Lista de conteos por sucursal con su estado y su diferencia total; al abrir
 * uno se ve el detalle renglón por renglón (sistema vs contado) y se imprime
 * el acta. Desde aquí también se aprueba o se rechaza un conteo enviado.
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import { useAppStore, apiJsonp, normalizeApiUrl, invalidateReadCache } from "@/lib/store"
import { useCurrentBusiness } from "@/hooks/use-current-business"
import { useSessionUser } from "@/hooks/use-session-user"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Printer, Loader2, ArrowLeft, CheckCircle2, XCircle } from "lucide-react"
import { fmtQty, diffConteo, CONTEO_ESTADO_LABEL, type Conteo, type ConteoConItems, type ConteoEstado } from "@/lib/productos-client"
import { printActaConteo } from "@/lib/inventario-productos-pdf"
import { canPerm } from "@/lib/permissions"

const TODOS = "__todos__"

const badgeTone: Record<ConteoEstado, string> = {
  borrador: "border-amber-200 bg-amber-50 text-amber-700",
  enviado: "border-sky-200 bg-sky-50 text-sky-700",
  aprobado: "border-emerald-200 bg-emerald-50 text-emerald-700",
  rechazado: "border-rose-200 bg-rose-50 text-rose-700",
}

export function ProdConteoHistoricoPage() {
  const { apiUrl, showToast } = useAppStore()
  const business = useCurrentBusiness()
  const sessionUser = useSessionUser()
  const userName = sessionUser?.nombre || sessionUser?.username || ""
  // Espejo del check del servidor (`canApproveCount` en products-inventory.ts).
  // Antes los botones se mostraban a cualquiera con el menú y el servidor los
  // rechazaba después: el usuario veía una acción que no podía ejecutar.
  const canApprove = canPerm(sessionUser, "productos.aprobar_conteo")

  const [records, setRecords] = useState<Conteo[]>([])
  const [estado, setEstado] = useState(TODOS)
  const [detalle, setDetalle] = useState<ConteoConItems | null>(null)
  const [soloDiferencias, setSoloDiferencias] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiJsonp(normalizeApiUrl(apiUrl), {
        action: "getProductCounts",
        estado: estado === TODOS ? "" : estado,
      })
      if (!res?.ok) throw new Error(String(res?.error || "No se pudo cargar el histórico"))
      setRecords((res.records as Conteo[]) || [])
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error al cargar", "error")
    } finally {
      setLoading(false)
    }
  }, [apiUrl, estado, showToast])

  useEffect(() => { void load() }, [load])

  const abrir = async (id: string) => {
    setBusy(true)
    try {
      const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "getProductCount", id })
      if (!res?.ok) throw new Error(String(res?.error || "No se pudo abrir el conteo"))
      setDetalle(res.record as ConteoConItems)
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error al abrir", "error")
    } finally {
      setBusy(false)
    }
  }

  const aprobar = async () => {
    if (!detalle) return
    const dif = detalle.items.filter((it) => diffConteo(it.cantidadSistema, it.cantidadContada) !== 0).length
    if (!window.confirm(`Vas a APROBAR el conteo de ${detalle.sucursal} del ${detalle.fecha}.\n\nLa existencia del sistema pasará a ser lo contado en ${detalle.items.length} productos${dif ? ` (${dif} con diferencia)` : ""}.\n\n¿Continuar?`)) return
    setBusy(true)
    try {
      const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "approveProductCount", id: detalle.id, userName })
      if (!res?.ok) throw new Error(String(res?.error || "No se pudo aprobar"))
      invalidateReadCache()
      showToast(`Conteo aprobado: ${res.ajustados} productos ajustados`, "success")
      await abrir(detalle.id)
      void load()
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error al aprobar", "error")
    } finally {
      setBusy(false)
    }
  }

  const rechazar = async () => {
    if (!detalle) return
    const motivo = window.prompt("Motivo del rechazo:")
    if (motivo === null) return
    setBusy(true)
    try {
      const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "rejectProductCount", id: detalle.id, motivo, userName })
      if (!res?.ok) throw new Error(String(res?.error || "No se pudo rechazar"))
      showToast("Conteo devuelto a borrador", "success")
      await abrir(detalle.id)
      void load()
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error al rechazar", "error")
    } finally {
      setBusy(false)
    }
  }

  const imprimir = () => {
    if (!detalle) return
    printActaConteo({
      sucursal: detalle.sucursal,
      fecha: detalle.fecha,
      estado: CONTEO_ESTADO_LABEL[detalle.estado],
      responsable: detalle.responsable,
      notas: detalle.notas,
      aprobadoPor: detalle.aprobadoPorNombre,
      items: detalle.items,
      business,
      origin: window.location.origin,
      generadoPor: userName,
      soloDiferencias,
    })
  }

  const itemsVisibles = useMemo(() => {
    if (!detalle) return []
    return soloDiferencias
      ? detalle.items.filter((it) => diffConteo(it.cantidadSistema, it.cantidadContada) !== 0)
      : detalle.items
  }, [detalle, soloDiferencias])

  // ── Detalle ────────────────────────────────────────────────────────────────
  if (detalle) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="ghost" className="h-9" onClick={() => setDetalle(null)}>
            <ArrowLeft className="mr-1.5 h-4 w-4" /> Volver al histórico
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={soloDiferencias} onCheckedChange={(v) => setSoloDiferencias(v === true)} />
              Solo diferencias
            </label>
            <Button variant="outline" className="h-9" onClick={imprimir}>
              <Printer className="mr-1.5 h-4 w-4" /> Acta en PDF
            </Button>
            {canApprove && detalle.estado !== "aprobado" && (
              <>
                <Button variant="outline" className="h-9" onClick={() => void rechazar()} disabled={busy}>
                  <XCircle className="mr-1.5 h-4 w-4" /> Rechazar
                </Button>
                <Button className="h-9" onClick={() => void aprobar()} disabled={busy}>
                  {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-4 w-4" />}
                  Aprobar y ajustar
                </Button>
              </>
            )}
          </div>
        </div>

        <Card className="border-[color:var(--brand-border)]">
          <CardHeader className="pb-2">
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              {detalle.sucursal} · {detalle.fecha}
              <Badge variant="outline" className={badgeTone[detalle.estado]}>{CONTEO_ESTADO_LABEL[detalle.estado]}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
              <span>Responsable: <b className="text-foreground">{detalle.responsable || "—"}</b></span>
              <span>Creado por: <b className="text-foreground">{detalle.creadoPorNombre || "—"}</b></span>
              {detalle.aprobadoPorNombre && <span>Aprobado por: <b className="text-foreground">{detalle.aprobadoPorNombre}</b></span>}
              {detalle.motivoRechazo && <span className="text-rose-600">Rechazo: {detalle.motivoRechazo}</span>}
            </div>
            {detalle.notas && <p className="text-sm">{detalle.notas}</p>}

            <div className="overflow-x-auto rounded-lg border border-[color:var(--brand-border)]">
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
                  {itemsVisibles.map((it) => {
                    const d = diffConteo(it.cantidadSistema, it.cantidadContada)
                    return (
                      <tr key={it.id} className="border-t border-[color:var(--brand-border)]">
                        <td className="px-3 py-1.5">
                          <div className="font-medium">{it.nombre}</div>
                          {it.sku && <div className="text-[11px] text-muted-foreground">{it.sku}</div>}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{fmtQty(it.cantidadSistema)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{fmtQty(it.cantidadContada)}</td>
                        <td className={`px-3 py-1.5 text-right tabular-nums font-semibold ${
                          d === 0 ? "text-emerald-600" : d > 0 ? "text-amber-600" : "text-rose-600"
                        }`}>
                          {d > 0 ? `+${fmtQty(d)}` : fmtQty(d)}
                        </td>
                        <td className="px-3 py-1.5 text-xs text-muted-foreground">{it.observacion || "—"}</td>
                      </tr>
                    )
                  })}
                  {itemsVisibles.length === 0 && (
                    <tr><td colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                      {soloDiferencias ? "Este conteo cuadró: no hay diferencias." : "El conteo no tiene renglones."}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  // ── Listado ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <Card className="border-[color:var(--brand-border)]">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-3 sm:p-4">
          <div className="w-56">
            <Select value={estado} onValueChange={setEstado}>
              <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={TODOS}>Todos los estados</SelectItem>
                <SelectItem value="borrador">Borrador</SelectItem>
                <SelectItem value="enviado">Enviado</SelectItem>
                <SelectItem value="aprobado">Aprobado</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void load()}>Actualizar</Button>
        </CardContent>
      </Card>

      <Card className="border-[color:var(--brand-border)]">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
            </div>
          ) : records.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">Todavía no hay conteos registrados.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Fecha</th>
                    <th className="px-3 py-2 text-left">Sucursal</th>
                    <th className="px-3 py-2 text-left">Responsable</th>
                    <th className="px-3 py-2 text-center">Estado</th>
                    <th className="px-3 py-2 text-right">Productos</th>
                    <th className="px-3 py-2 text-right">Diferencia</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((c) => (
                    <tr key={c.id} className="border-t border-[color:var(--brand-border)] hover:bg-muted/30">
                      <td className="px-3 py-2 whitespace-nowrap">{c.fecha}</td>
                      <td className="px-3 py-2">{c.sucursal}</td>
                      <td className="px-3 py-2 text-xs">{c.responsable || c.creadoPorNombre || "—"}</td>
                      <td className="px-3 py-2 text-center">
                        <Badge variant="outline" className={badgeTone[c.estado]}>{CONTEO_ESTADO_LABEL[c.estado]}</Badge>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtQty(c.itemsCount || 0)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums font-semibold ${
                        !c.diferenciaTotal ? "text-emerald-600" : c.diferenciaTotal > 0 ? "text-amber-600" : "text-rose-600"
                      }`}>
                        {(c.diferenciaTotal || 0) > 0 ? `+${fmtQty(c.diferenciaTotal)}` : fmtQty(c.diferenciaTotal || 0)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button variant="outline" size="sm" onClick={() => void abrir(c.id)} disabled={busy}>Ver</Button>
                      </td>
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
