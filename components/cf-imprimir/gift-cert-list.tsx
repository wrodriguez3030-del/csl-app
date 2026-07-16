"use client"

/**
 * CF PARA IMPRIMIR · Listado de certificados de regalo.
 *
 * Tabla con filtros (búsqueda, estado, sucursal), paginación y acciones por
 * fila (abrir/editar, imprimir, PDF, imagen, duplicar, historial). Los cambios
 * de estado (entregar/canjear/anular) se realizan al abrir el certificado.
 */
import { useMemo, useState, type ReactNode } from "react"
import {
  Plus, Search, Pencil, Printer, FileDown, ImageDown, Copy, History, Loader2, RefreshCw, X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { usePagination } from "@/lib/use-pagination"
import { DataPagination } from "@/components/ui/data-pagination"
import type { SystemUser } from "@/lib/security"
import { effectiveEstado } from "@/lib/certificados/cert-state"
import { GIFT_ESTADOS, type GiftCertData } from "@/lib/certificados/cert-layout"
import {
  buildExportSvg, makeQrDataUri, rasterizeSvg, svgToPdfBytes,
  downloadBlob, downloadBytes, certFilenameBase, printSvg,
} from "@/lib/certificados/cert-export"
import { errMsg, useGiftCertificates, type GiftCertAuditRow, type GiftCertRecord } from "./use-gift-certificates"

const TODAY = new Date().toISOString().slice(0, 10)

const ESTADO_STYLES: Record<string, string> = {
  Borrador: "bg-slate-100 text-slate-700",
  Emitido: "bg-sky-100 text-sky-800",
  Entregado: "bg-indigo-100 text-indigo-800",
  Canjeado: "bg-emerald-100 text-emerald-800",
  Vencido: "bg-amber-100 text-amber-800",
  Anulado: "bg-rose-100 text-rose-800",
}

function recToData(rec: GiftCertRecord): GiftCertData {
  return {
    codigo: rec.codigo,
    otorgadoA: rec.otorgadoA,
    cortesiaDe: rec.cortesiaDe,
    validoPara: rec.validoPara,
    validoHasta: rec.validoHasta,
    fechaEmision: rec.fechaEmision,
    sucursal: rec.sucursal,
    sucursalDireccion: rec.sucursalDireccion,
    sucursalTelefono: rec.sucursalTelefono,
    templateId: rec.templateId,
  }
}

export function GiftCertList({
  gc,
  user,
  onNew,
  onOpen,
}: {
  gc: ReturnType<typeof useGiftCertificates>
  user: SystemUser | null
  onNew: () => void
  onOpen: (rec: GiftCertRecord) => void
}) {
  const [search, setSearch] = useState("")
  const [estado, setEstado] = useState("")
  const [sucursal, setSucursal] = useState("")
  const [busyRow, setBusyRow] = useState("")
  const [rowError, setRowError] = useState("")
  const [historyFor, setHistoryFor] = useState<GiftCertRecord | null>(null)
  const [audit, setAudit] = useState<GiftCertAuditRow[]>([])
  const [auditLoading, setAuditLoading] = useState(false)

  const sucursalOptions = useMemo(
    () => Array.from(new Set(gc.records.map((r) => r.sucursal).filter(Boolean))).sort(),
    [gc.records],
  )

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase()
    return gc.records.filter((r) => {
      const eff = effectiveEstado(r.estado, r.validoHasta, TODAY)
      if (estado && eff !== estado) return false
      if (sucursal && r.sucursal !== sucursal) return false
      if (term) {
        const hay = [r.codigo, r.otorgadoA, r.cortesiaDe, r.validoPara, r.sucursal, r.creadoPor].join(" ").toLowerCase()
        if (!hay.includes(term)) return false
      }
      return true
    })
  }, [gc.records, search, estado, sucursal])

  const pag = usePagination(rows, { initialPageSize: 25, resetKey: `${search}|${estado}|${sucursal}` })

  async function exportRow(rec: GiftCertRecord, kind: "print" | "pdf" | "png" | "jpg") {
    if (busyRow) return
    setBusyRow(`${rec.codigo}:${kind}`)
    setRowError("")
    try {
      const url = `${window.location.origin}/certificado-regalo/validar?c=${encodeURIComponent(rec.codigo)}`
      const qr = await makeQrDataUri(url)
      const svg = await buildExportSvg(recToData(rec), qr)
      const base = certFilenameBase(recToData(rec))
      if (kind === "print") {
        if (!printSvg(svg, rec.codigo)) setRowError("Habilita las ventanas emergentes para imprimir.")
        else gc.logExport(rec.codigo, "imprimir")
      } else if (kind === "pdf") {
        downloadBytes(await svgToPdfBytes(svg), `${base}.pdf`)
        gc.logExport(rec.codigo, "descargar_pdf")
      } else {
        const blob = await rasterizeSvg(svg, { scale: 3, type: kind === "png" ? "image/png" : "image/jpeg", quality: 0.95 })
        downloadBlob(blob, `${base}.${kind}`)
        gc.logExport(rec.codigo, kind === "png" ? "descargar_png" : "descargar_jpg")
      }
    } catch (e) {
      setRowError(errMsg(e))
    } finally {
      setBusyRow("")
    }
  }

  async function openHistory(rec: GiftCertRecord) {
    setHistoryFor(rec)
    setAudit([])
    setAuditLoading(true)
    try {
      setAudit(await gc.getAudit(rec.codigo))
    } catch (e) {
      setRowError(errMsg(e))
    } finally {
      setAuditLoading(false)
    }
  }

  const spinning = (key: string) => busyRow === key

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold">Certificados</h3>
          <p className="text-sm text-muted-foreground">{gc.records.length} en total</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void gc.refresh()} disabled={gc.loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${gc.loading ? "animate-spin" : ""}`} />Actualizar
          </Button>
          <Button size="sm" onClick={onNew}><Plus className="mr-2 h-4 w-4" />Nuevo certificado</Button>
        </div>
      </div>

      {gc.error ? <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{gc.error}</div> : null}
      {rowError ? <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{rowError}</div> : null}

      <Card>
        <CardHeader className="gap-3 pb-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por código, beneficiario, quien obsequia, servicio, usuario..." />
            </div>
            <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={estado} onChange={(e) => setEstado(e.target.value)}>
              <option value="">Todos los estados</option>
              {GIFT_ESTADOS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={sucursal} onChange={(e) => setSucursal(e.target.value)}>
              <option value="">Todas las sucursales</option>
              {sucursalOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30 text-left">
                  <th className="px-3 py-2 font-semibold">Código</th>
                  <th className="px-3 py-2 font-semibold">Otorgado a</th>
                  <th className="px-3 py-2 font-semibold">Cortesía de</th>
                  <th className="px-3 py-2 font-semibold">Válido para</th>
                  <th className="px-3 py-2 font-semibold">Sucursal</th>
                  <th className="px-3 py-2 font-semibold">Emisión</th>
                  <th className="px-3 py-2 font-semibold">Vence</th>
                  <th className="px-3 py-2 font-semibold">Estado</th>
                  <th className="px-3 py-2 font-semibold">Creó</th>
                  <th className="px-3 py-2 text-right font-semibold">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {rows.length ? (
                  pag.pageItems.map((r) => {
                    const eff = effectiveEstado(r.estado, r.validoHasta, TODAY)
                    return (
                      <tr key={r.codigo} className="border-b hover:bg-muted/20">
                        <td className="px-3 py-2 font-mono text-xs">{r.codigo}</td>
                        <td className="px-3 py-2 font-medium">{r.otorgadoA}</td>
                        <td className="px-3 py-2">{r.cortesiaDe}</td>
                        <td className="px-3 py-2">{r.validoPara}</td>
                        <td className="px-3 py-2">{r.sucursal}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-xs">{r.fechaEmision}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-xs">{r.validoHasta}</td>
                        <td className="px-3 py-2">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${ESTADO_STYLES[eff] || "bg-slate-100 text-slate-700"}`}>{eff}</span>
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{r.creadoPor}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-end gap-0.5">
                            <IconBtn title="Abrir / editar" onClick={() => onOpen(r)}><Pencil className="h-4 w-4" /></IconBtn>
                            <IconBtn title="Imprimir" onClick={() => exportRow(r, "print")} busy={spinning(`${r.codigo}:print`)}><Printer className="h-4 w-4" /></IconBtn>
                            <IconBtn title="Descargar PDF" onClick={() => exportRow(r, "pdf")} busy={spinning(`${r.codigo}:pdf`)}><FileDown className="h-4 w-4" /></IconBtn>
                            <IconBtn title="Descargar imagen (PNG)" onClick={() => exportRow(r, "png")} busy={spinning(`${r.codigo}:png`)}><ImageDown className="h-4 w-4" /></IconBtn>
                            <IconBtn title="Duplicar como nuevo" onClick={() => void gc.duplicate(r.codigo).then((rec) => onOpen(rec)).catch((e) => setRowError(errMsg(e)))}><Copy className="h-4 w-4" /></IconBtn>
                            <IconBtn title="Historial" onClick={() => openHistory(r)}><History className="h-4 w-4" /></IconBtn>
                          </div>
                        </td>
                      </tr>
                    )
                  })
                ) : (
                  <tr><td colSpan={10} className="px-3 py-12 text-center text-muted-foreground">{gc.loading ? "Cargando..." : "No hay certificados que coincidan."}</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <DataPagination
            page={pag.page}
            totalPages={pag.totalPages}
            total={pag.total}
            from={pag.from}
            to={pag.to}
            pageSize={pag.pageSize}
            onPage={pag.setPage}
            onPageSize={pag.setPageSize}
            label="certificados"
          />
        </CardContent>
      </Card>

      {historyFor ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setHistoryFor(null)}>
          <Card className="max-h-[80vh] w-full max-w-lg overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Historial · {historyFor.codigo}</CardTitle>
              <Button variant="ghost" size="icon" onClick={() => setHistoryFor(null)}><X className="h-4 w-4" /></Button>
            </CardHeader>
            <CardContent className="max-h-[60vh] overflow-auto">
              {auditLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Cargando historial...</div>
              ) : audit.length ? (
                <ul className="space-y-2">
                  {audit.map((a) => (
                    <li key={a.id} className="rounded border px-3 py-2 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold capitalize">{a.accion.replace(/_/g, " ")}</span>
                        <span className="text-xs text-muted-foreground">{new Date(a.created_at).toLocaleString("es-DO")}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">{a.usuario || "—"}{a.motivo ? ` · ${a.motivo}` : ""}</div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">Sin movimientos registrados.</p>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  )
}

function IconBtn({ title, onClick, busy, children }: { title: string; onClick: () => void; busy?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={busy}
      className="rounded p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50"
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : children}
    </button>
  )
}
