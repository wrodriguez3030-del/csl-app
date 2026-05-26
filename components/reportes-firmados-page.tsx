"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  CalendarDays,
  Eye,
  FileSignature,
  FileText,
  Files,
  Loader2,
  Printer,
  Search,
  Sparkles,
  Trash2,
  UserRound,
  X,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { SEQ_HEADER_CLASS, SeqBadge } from "@/components/seq-badge"
import { apiJsonp, normalizeApiUrl, useAppStore } from "@/lib/store"
import { useAutoRefresh } from "@/hooks/use-auto-refresh"
import { useCurrentBusiness } from "@/hooks/use-current-business"
import type { Business } from "@/lib/types"
import { displayPhone, displayDocumento } from "@/lib/formatters"

/**
 * Vista centralizada de documentos firmados / pendientes:
 *   - Fichas dermatológicas
 *   - Consentimientos de masajes
 *   - Consentimientos de eliminación de tatuajes y cejas
 *
 * Carga las 3 fuentes en paralelo, las normaliza al mismo shape y permite
 * filtrar por tipo, sucursal, especialista, estado, fecha y búsqueda libre.
 *
 * Cada fila ofrece: ver detalle, imprimir / PDF, eliminar (con confirm),
 * abrir el cliente vinculado y abrir el módulo original (atajos del sidebar).
 */

type TipoReporte = "ficha" | "masajes" | "tatuajes"

interface ReporteUnificado {
  id: string
  tipo: TipoReporte
  fecha: string
  cliente: string
  clienteId: string
  documento: string
  telefono: string
  correo: string
  sucursal: string
  especialista: string
  estado: string
  firmaCliente: string
  firmaEspecialista: string
  raw: Record<string, unknown>
}

const TIPO_LABEL: Record<TipoReporte, string> = {
  ficha: "Ficha Dermatológica",
  masajes: "Consentimiento Masajes",
  tatuajes: "Consentimiento Tatuajes y Cejas",
}

const TIPO_ICON: Record<TipoReporte, React.ReactNode> = {
  ficha: <Sparkles className="h-3.5 w-3.5" />,
  masajes: <FileSignature className="h-3.5 w-3.5" />,
  tatuajes: <FileSignature className="h-3.5 w-3.5" />,
}

const TIPO_BADGE_CLASS: Record<TipoReporte, string> = {
  ficha: "bg-cyan-50 text-cyan-700 border-cyan-200",
  masajes: "bg-emerald-50 text-emerald-700 border-emerald-200",
  tatuajes: "bg-pink-50 text-pink-700 border-pink-200",
}

const TIPO_DELETE_ACTION: Record<TipoReporte, string> = {
  ficha: "deleteFichaDermatologia",
  masajes: "deleteConsentMasaje",
  tatuajes: "deleteConsentTatuajeCeja",
}

const TIPO_ROUTE: Record<TipoReporte, "cosmiatria-ficha" | "consent-masajes" | "consent-tatuajes-cejas"> = {
  ficha: "cosmiatria-ficha",
  masajes: "consent-masajes",
  tatuajes: "consent-tatuajes-cejas",
}

function formatDate(value?: string) {
  if (!value) return "-"
  const iso = String(value).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})/)
  return iso ? `${iso[3]}/${iso[2]}/${iso[1]}` : value
}

function pickString(...values: unknown[]) {
  for (const value of values) {
    const text = String(value ?? "").trim()
    if (text) return text
  }
  return ""
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function fichaToUnified(rows: Record<string, unknown>[]): ReporteUnificado[] {
  return rows.map((row) => ({
    id: pickString(row.id, row.FichaID, row.ficha_id),
    tipo: "ficha",
    fecha: pickString(row.fecha, row.Fecha),
    cliente: pickString(row.nombre_cliente, row.nombre, row.Nombre, row.nombreCliente),
    clienteId: pickString(row.clienteId, row.ClienteID, row.cliente_id),
    documento: pickString(row.documento, row.cedula, row.Cedula),
    telefono: pickString(row.telefono, row.Telefono),
    correo: pickString(row.correo, row.email, row.Email),
    sucursal: pickString(row.sucursal, row.Sucursal),
    especialista: pickString(row.especialista, row.nombreEspecialista, row.operadora, row.Operadora),
    estado: pickString(row.estado, row.Estado, "Completada"),
    firmaCliente: pickString(row.firma_cliente, row.firma, row.firmaDigital, row.FirmaDigital),
    firmaEspecialista: pickString(row.firma_especialista, row.firmaEspecialista, row.FirmaEspecialista),
    raw: row,
  }))
}

function consentToUnified(rows: Record<string, unknown>[], tipo: "masajes" | "tatuajes"): ReporteUnificado[] {
  return rows.map((row) => ({
    id: pickString(row.id, row.consent_id, row.consentId),
    tipo,
    fecha: pickString(row.fecha, row.Fecha),
    cliente: pickString(row.nombreCliente, row.NombreCliente, row.cliente_nombre),
    clienteId: pickString(row.clienteId, row.ClienteID, row.cliente_id),
    documento: pickString(row.documento, row.Documento, row.cedula),
    telefono: pickString(row.telefono, row.Telefono),
    correo: pickString(row.correo, row.Correo, row.email),
    sucursal: pickString(row.sucursal, row.Sucursal),
    especialista: pickString(row.nombreEspecialista, row.NombreEspecialista, row.especialista_nombre),
    estado: pickString(row.estado, row.Estado, "Pendiente"),
    firmaCliente: pickString(row.firmaCliente, row.FirmaCliente, row.firma_cliente),
    firmaEspecialista: pickString(row.firmaEspecialista, row.FirmaEspecialista, row.firma_especialista),
    raw: row,
  }))
}

export function ReportesFirmadosPage() {
  const { apiUrl, setActiveTab, showToast, setIsLoading, setLoadingMessage } = useAppStore()
  const business = useCurrentBusiness()
  const [items, setItems] = useState<ReporteUnificado[]>([])
  const [loading, setLoading] = useState(false)
  const [detalle, setDetalle] = useState<ReporteUnificado | null>(null)
  const [deletingId, setDeletingId] = useState("")

  // Filtros
  const [query, setQuery] = useState("")
  const [tipoFiltro, setTipoFiltro] = useState<"todos" | TipoReporte>("todos")
  const [sucursalFiltro, setSucursalFiltro] = useState("todas")
  const [especialistaFiltro, setEspecialistaFiltro] = useState("todos")
  const [estadoFiltro, setEstadoFiltro] = useState("todos")
  const [fechaDesde, setFechaDesde] = useState("")
  const [fechaHasta, setFechaHasta] = useState("")

  const load = useCallback(async (options: { silent?: boolean } = {}) => {
    const { silent = false } = options
    if (!silent) setLoading(true)
    try {
      const normalized = normalizeApiUrl(apiUrl)
      const [fichas, masajes, tatuajes] = await Promise.all([
        apiJsonp(normalized, { action: "getFichasDermatologia" }),
        apiJsonp(normalized, { action: "getConsentMasajes" }),
        apiJsonp(normalized, { action: "getConsentTatuajesCejas" }),
      ])
      const merged: ReporteUnificado[] = [
        ...fichaToUnified((fichas.records as Record<string, unknown>[]) || []),
        ...consentToUnified((masajes.records as Record<string, unknown>[]) || [], "masajes"),
        ...consentToUnified((tatuajes.records as Record<string, unknown>[]) || [], "tatuajes"),
      ].sort((a, b) => `${b.fecha}${b.id}`.localeCompare(`${a.fecha}${a.id}`))
      setItems(merged)
    } catch (error) {
      if (!silent) showToast(error instanceof Error ? error.message : "Error cargando reportes", "error")
    } finally {
      if (!silent) setLoading(false)
    }
  }, [apiUrl, showToast])

  useEffect(() => {
    void load()
  }, [load])

  // Auto-refresh silencioso del listado cada 60s. Salta si hay un dialog abierto.
  useAutoRefresh(() => load({ silent: true }), {
    intervalMs: 60_000,
    skipWhen: () => Boolean(detalle),
  })

  const sucursales = useMemo(
    () => Array.from(new Set(items.map((r) => r.sucursal).filter(Boolean))).sort(),
    [items],
  )
  const especialistas = useMemo(
    () => Array.from(new Set(items.map((r) => r.especialista).filter(Boolean))).sort(),
    [items],
  )
  const estados = useMemo(
    () => Array.from(new Set(items.map((r) => r.estado).filter(Boolean))).sort(),
    [items],
  )

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return items.filter((r) => {
      if (tipoFiltro !== "todos" && r.tipo !== tipoFiltro) return false
      if (sucursalFiltro !== "todas" && r.sucursal !== sucursalFiltro) return false
      if (especialistaFiltro !== "todos" && r.especialista !== especialistaFiltro) return false
      if (estadoFiltro !== "todos" && r.estado !== estadoFiltro) return false
      if (fechaDesde && r.fecha && r.fecha < fechaDesde) return false
      if (fechaHasta && r.fecha && r.fecha > fechaHasta) return false
      if (needle) {
        const haystack = [r.cliente, r.documento, r.telefono, r.correo, r.id, r.especialista]
          .join(" ")
          .toLowerCase()
        if (!haystack.includes(needle)) return false
      }
      return true
    })
  }, [items, query, tipoFiltro, sucursalFiltro, especialistaFiltro, estadoFiltro, fechaDesde, fechaHasta])

  const totals = useMemo(
    () => ({
      total: items.length,
      ficha: items.filter((r) => r.tipo === "ficha").length,
      masajes: items.filter((r) => r.tipo === "masajes").length,
      tatuajes: items.filter((r) => r.tipo === "tatuajes").length,
      firmados: items.filter((r) => r.firmaCliente).length,
    }),
    [items],
  )

  const handleClearFilters = () => {
    setQuery("")
    setTipoFiltro("todos")
    setSucursalFiltro("todas")
    setEspecialistaFiltro("todos")
    setEstadoFiltro("todos")
    setFechaDesde("")
    setFechaHasta("")
  }

  const handlePrint = (record: ReporteUnificado) => {
    const html = buildPrintHtml(record, business)
    const popup = window.open("", "_blank", "width=1000,height=900")
    if (!popup) {
      showToast("El navegador bloqueó la ventana de impresión", "error")
      return
    }
    popup.document.write(html)
    popup.document.close()
  }

  const handleDelete = async (record: ReporteUnificado) => {
    if (deletingId) return
    if (!window.confirm(`¿Eliminar definitivamente este ${TIPO_LABEL[record.tipo]}?`)) return
    setDeletingId(record.id)
    setIsLoading(true)
    setLoadingMessage("Eliminando…")
    try {
      const action = TIPO_DELETE_ACTION[record.tipo]
      await apiJsonp(normalizeApiUrl(apiUrl), { action, id: record.id })
      setItems((current) => current.filter((r) => !(r.id === record.id && r.tipo === record.tipo)))
      showToast("Registro eliminado", "success")
      if (detalle?.id === record.id && detalle?.tipo === record.tipo) setDetalle(null)
    } catch (error) {
      showToast(error instanceof Error ? error.message : "No se pudo eliminar", "error")
    } finally {
      setIsLoading(false)
      setDeletingId("")
    }
  }

  const handleOpenCliente = () => {
    setActiveTab("cosmiatria-clientes")
  }

  const handleOpenOriginal = (record: ReporteUnificado) => {
    setActiveTab(TIPO_ROUTE[record.tipo])
  }

  return (
    <div className="space-y-6">
      <Card className="csl-section-card">
        <CardContent className="p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="mb-2 flex items-center gap-2">
                <span className="csl-kpi-icon">
                  <Files className="h-5 w-5" />
                </span>
                <span className="csl-pill">Documentos</span>
              </div>
              <h2 className="font-heading text-2xl font-black tracking-tight text-[color:var(--brand-primary-dark)] sm:text-3xl">
                Historial Fichas y Consentimientos
              </h2>
              <p className="mt-1 max-w-2xl text-sm text-slate-500">
                Vista centralizada de fichas dermatológicas y consentimientos firmados. Cliente · sucursal · especialista · estado.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => void load()} disabled={loading} className="rounded-full gap-2">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Actualizar
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* KPIs */}
      <div className="grid gap-4 md:grid-cols-5">
        <Kpi label="Documentos" value={totals.total} />
        <Kpi label="Fichas" value={totals.ficha} tone="cyan" />
        <Kpi label="Masajes" value={totals.masajes} tone="emerald" />
        <Kpi label="Tatuajes/Cejas" value={totals.tatuajes} tone="pink" />
        <Kpi label="Firmados" value={totals.firmados} tone="success" />
      </div>

      {/* Filtros */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filtros</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 lg:grid-cols-[1.4fr_repeat(4,1fr)_auto]">
          <div>
            <Label className="text-xs">Búsqueda</Label>
            <div className="relative mt-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cliente, cédula, teléfono, correo, ID…" className="pl-9" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Tipo</Label>
            <Select value={tipoFiltro} onValueChange={(v) => setTipoFiltro(v as "todos" | TipoReporte)}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos los tipos</SelectItem>
                <SelectItem value="ficha">Ficha Dermatológica</SelectItem>
                <SelectItem value="masajes">Consentimiento Masajes</SelectItem>
                <SelectItem value="tatuajes">Tatuajes y Cejas</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Sucursal</Label>
            <Select value={sucursalFiltro} onValueChange={setSucursalFiltro}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas</SelectItem>
                {sucursales.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Especialista</Label>
            <Select value={especialistaFiltro} onValueChange={setEspecialistaFiltro}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                {especialistas.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Estado</Label>
            <Select value={estadoFiltro} onValueChange={setEstadoFiltro}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                {estados.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button variant="ghost" onClick={handleClearFilters} className="gap-1 text-xs">
              <X className="h-3.5 w-3.5" /> Limpiar
            </Button>
          </div>
          <div className="lg:col-span-3 grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Fecha desde</Label>
              <Input type="date" className="mt-1" value={fechaDesde} onChange={(e) => setFechaDesde(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Fecha hasta</Label>
              <Input type="date" className="mt-1" value={fechaHasta} onChange={(e) => setFechaHasta(e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabla */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
            <span>Documentos</span>
            <Badge variant="outline">{filtered.length}</Badge>
            {filtered.length !== items.length ? <span className="text-xs font-normal text-muted-foreground">de {items.length}</span> : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className={SEQ_HEADER_CLASS}>#</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Documento</TableHead>
                  <TableHead>Sucursal</TableHead>
                  <TableHead>Especialista</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={9} className="py-12 text-center text-sm text-muted-foreground">
                      <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin text-[color:var(--brand-primary)]" />
                      Cargando documentos…
                    </TableCell>
                  </TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="py-12 text-center text-muted-foreground">
                      No hay documentos que coincidan con los filtros.
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((r, i) => (
                    <TableRow
                      key={`${r.tipo}-${r.id}-${i}`}
                      className="cursor-pointer"
                      onClick={() => setDetalle(r)}
                    >
                      <TableCell className="text-center"><SeqBadge n={i + 1} /></TableCell>
                      <TableCell className="font-semibold whitespace-nowrap">{formatDate(r.fecha)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`${TIPO_BADGE_CLASS[r.tipo]} gap-1 text-[10px]`}>
                          {TIPO_ICON[r.tipo]}
                          {TIPO_LABEL[r.tipo]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="font-bold">{r.cliente || "—"}</div>
                        <div className="text-xs text-muted-foreground">{displayPhone(r.telefono) || r.correo || ""}</div>
                      </TableCell>
                      <TableCell>{displayDocumento(r.documento) || "—"}</TableCell>
                      <TableCell>{r.sucursal || "—"}</TableCell>
                      <TableCell>{r.especialista || "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={r.firmaCliente ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-amber-50 text-amber-700 border-amber-200"}>
                          {r.estado || (r.firmaCliente ? "Firmado" : "Pendiente")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" title="Ver detalle" onClick={() => setDetalle(r)}>
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" title="Imprimir / PDF" onClick={() => handlePrint(r)}>
                            <Printer className="h-4 w-4 text-[color:var(--brand-primary)]" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Eliminar"
                            disabled={deletingId === r.id}
                            onClick={() => void handleDelete(r)}
                          >
                            {deletingId === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 text-rose-600" />}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <DetalleDialog
        record={detalle}
        onClose={() => setDetalle(null)}
        onPrint={(r) => handlePrint(r)}
        onOpenCliente={handleOpenCliente}
        onOpenOriginal={handleOpenOriginal}
      />
    </div>
  )
}

function Kpi({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "success" | "cyan" | "emerald" | "pink" }) {
  const colorClass = {
    default: "text-[color:var(--brand-primary-dark)]",
    success: "text-emerald-700",
    cyan: "text-cyan-700",
    emerald: "text-emerald-700",
    pink: "text-pink-700",
  }[tone]
  return (
    <Card className="csl-section-card">
      <CardContent className="p-5">
        <div className="text-xs font-black uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
        <div className={`mt-2 font-heading text-3xl font-black ${colorClass}`}>{value.toLocaleString("es-DO")}</div>
      </CardContent>
    </Card>
  )
}

function DetalleDialog({
  record,
  onClose,
  onPrint,
  onOpenCliente,
  onOpenOriginal,
}: {
  record: ReporteUnificado | null
  onClose: () => void
  onPrint: (r: ReporteUnificado) => void
  onOpenCliente: () => void
  onOpenOriginal: (r: ReporteUnificado) => void
}) {
  if (!record) return null
  return (
    <Dialog open={Boolean(record)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-[820px]">
        <DialogHeader>
          <DialogTitle>{record.cliente || "Cliente sin nombre registrado"}</DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={`${TIPO_BADGE_CLASS[record.tipo]} gap-1 text-[10px]`}>
              {TIPO_ICON[record.tipo]}
              {TIPO_LABEL[record.tipo]}
            </Badge>
            <span>{formatDate(record.fecha)}</span>
            {record.sucursal ? <span>· {record.sucursal}</span> : null}
            <span className="font-mono text-[10px] text-muted-foreground/70">{record.id}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 md:grid-cols-2">
          <DetalleItem label="Cliente" value={record.cliente} />
          <DetalleItem label="Documento" value={displayDocumento(record.documento)} />
          <DetalleItem label="Teléfono" value={displayPhone(record.telefono)} />
          <DetalleItem label="Correo" value={record.correo} />
          <DetalleItem label="Sucursal" value={record.sucursal} />
          <DetalleItem label="Especialista" value={record.especialista} />
          <DetalleItem label="Estado" value={record.estado} />
          <DetalleItem label="ID" value={record.id} mono />
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <FirmaPreview label="Firma del cliente" value={record.firmaCliente} />
          <FirmaPreview label="Firma del especialista" value={record.firmaEspecialista} />
        </div>

        <DialogFooter className="flex-wrap gap-2">
          <Button variant="outline" onClick={() => onPrint(record)} className="gap-2">
            <Printer className="h-4 w-4" /> Imprimir / PDF
          </Button>
          {record.clienteId ? (
            <Button variant="outline" onClick={onOpenCliente} className="gap-2">
              <UserRound className="h-4 w-4" /> Abrir cliente
            </Button>
          ) : null}
          <Button onClick={() => onOpenOriginal(record)} className="gap-2">
            <FileText className="h-4 w-4" /> Abrir módulo original
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DetalleItem({ label, value, mono = false }: { label: string; value?: string; mono?: boolean }) {
  return (
    <div className="rounded-2xl border bg-slate-50/70 p-3">
      <div className="text-[10px] font-black uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className={`mt-1 break-words text-sm font-semibold ${mono ? "font-mono text-xs" : ""}`}>
        {value || "—"}
      </div>
    </div>
  )
}

function FirmaPreview({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border bg-slate-50/70 p-3">
      <div className="text-[10px] font-black uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      {value ? (
        <img src={value} alt={label} className="mt-3 h-24 w-full rounded-lg bg-white object-contain p-2" />
      ) : (
        <div className="mt-3 grid h-24 place-items-center rounded-lg border border-dashed text-xs text-muted-foreground">
          Sin firma
        </div>
      )}
    </div>
  )
}

/**
 * Genera un HTML simple e imprimible que cubre los 3 tipos de documento.
 * Para impresión avanzada con todos los campos, los módulos originales
 * tienen sus propios renderers; éste sirve como vista resumida unificada.
 */
function buildPrintHtml(record: ReporteUnificado, business?: Business) {
  const tipo = TIPO_LABEL[record.tipo]
  const brandName = business?.name || "Cibao Spa Laser"
  const brandColor = business?.primaryColor || "#14B7B0"
  const brandLogo = business?.logoUrl || "/cibao-spa-laser-logo.jpeg"
  return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>${escapeHtml(tipo)} - ${escapeHtml(record.cliente)}</title>
      <style>
        @page { size: A4; margin: 12mm; }
        body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #102A3A; font-size: 12px; }
        .header { display: flex; align-items: center; gap: 16px; border-bottom: 3px solid ${brandColor}; padding-bottom: 10px; margin-bottom: 12px; break-after: avoid; page-break-after: avoid; }
        .logo { width: 110px; height: 60px; object-fit: contain; }
        h1 { margin: 0; color: ${brandColor}; font-size: 18px; text-transform: uppercase; }
        .sub { color: #475569; font-weight: 700; margin-top: 4px; }
        .meta { margin-left: auto; font-size: 11px; color: #334155; text-align: right; }
        .section { margin-top: 10px; border: 1px solid #E1ECF2; border-radius: 10px; overflow: hidden; break-inside: auto; page-break-inside: auto; }
        .section-title { background: ${brandColor}; color: white; padding: 6px 10px; font-weight: 800; text-transform: uppercase; break-after: avoid; page-break-after: avoid; }
        .grid { display: grid; grid-template-columns: repeat(2, 1fr); }
        .field { min-height: 26px; border-bottom: 1px dotted #C7D7E0; padding: 5px 10px; display: flex; gap: 8px; break-inside: avoid; page-break-inside: avoid; }
        .field b { min-width: 145px; color: #0B3442; }
        .field span { flex: 1; }
        .full { grid-column: 1 / -1; }
        .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; padding: 14px 14px 10px; break-inside: avoid; page-break-inside: avoid; }
        .sig { text-align: center; break-inside: avoid; page-break-inside: avoid; }
        .sig img { width: 240px; height: 80px; object-fit: contain; border: 1px solid #E1ECF2; background: #fff; }
        .sig-empty { height: 80px; }
        .sig-line { border-top: 1px solid #102A3A; margin: 8px 24px 4px; }
        .sig-name { font-weight: 700; color: #334155; }
        .footer { margin-top: 14px; color: #64748B; font-size: 10px; text-align: center; }
        @media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
      </style>
    </head>
    <body>
      <div class="header">
        <img class="logo" src="${window.location.origin}${brandLogo}" alt="${escapeHtml(brandName)}" onerror="this.style.display='none'" />
        <div>
          <h1>${escapeHtml(tipo)}</h1>
          <div class="sub">${escapeHtml(brandName)} · Documento firmado</div>
        </div>
        <div class="meta">
          <b>ID:</b> ${escapeHtml(record.id)}<br/>
          <b>Fecha:</b> ${formatDate(record.fecha)}<br/>
          <b>Sucursal:</b> ${escapeHtml(record.sucursal || "-")}
        </div>
      </div>

      <div class="section">
        <div class="section-title">Datos del cliente</div>
        <div class="grid">
          <div class="field"><b>Nombre:</b><span>${escapeHtml(record.cliente || "-")}</span></div>
          <div class="field"><b>Documento:</b><span>${escapeHtml(displayDocumento(record.documento) || "-")}</span></div>
          <div class="field"><b>Teléfono:</b><span>${escapeHtml(displayPhone(record.telefono) || "-")}</span></div>
          <div class="field"><b>Correo:</b><span>${escapeHtml(record.correo || "-")}</span></div>
          <div class="field full"><b>Especialista:</b><span>${escapeHtml(record.especialista || "-")}</span></div>
          <div class="field full"><b>Estado:</b><span>${escapeHtml(record.estado || "-")}</span></div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Firmas</div>
        <div class="signatures">
          <div class="sig">
            <div><b>Firma del cliente</b></div>
            ${record.firmaCliente ? `<img src="${escapeHtml(record.firmaCliente)}" alt="firma cliente" />` : `<div class="sig-empty"></div>`}
            <div class="sig-line"></div>
            <div class="sig-name">${escapeHtml(record.cliente || "Cliente")}</div>
          </div>
          <div class="sig">
            <div><b>Firma del especialista</b></div>
            ${record.firmaEspecialista ? `<img src="${escapeHtml(record.firmaEspecialista)}" alt="firma especialista" />` : `<div class="sig-empty"></div>`}
            <div class="sig-line"></div>
            <div class="sig-name">${escapeHtml(record.especialista || "Especialista")}</div>
          </div>
        </div>
      </div>

      <div class="footer">
        Documento generado por Sistema Integral CSL · ${new Date().toLocaleString("es-DO")}
      </div>
      <script>setTimeout(() => window.print(), 450)</script>
    </body>
  </html>`
}
