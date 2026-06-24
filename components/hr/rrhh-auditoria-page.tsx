"use client"

import { useEffect, useState } from "react"
import { apiCall, normalizeApiUrl, useAppStore } from "@/lib/store"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Shield, Loader2, RefreshCw, Eye, AlertCircle } from "lucide-react"
import { useCurrentBusiness } from "@/hooks/use-current-business"
import { usePagination } from "@/lib/use-pagination"
import { DataPagination } from "@/components/ui/data-pagination"

interface AuditLog {
  id: string; user_email: string | null; module: string; action: string
  entity_type: string; entity_id: string | null
  old_values: unknown; new_values: unknown; created_at: string
}

const MODULES = ["dias_laborados", "prestamos", "incentivos", "nomina", "txt_bancarios", "vacaciones", "doble_sueldo"]
const ACTION_CLASS: Record<string, string> = {
  create: "bg-emerald-100 text-emerald-700 border-emerald-200",
  update: "bg-blue-100 text-blue-700 border-blue-200",
  approve: "bg-emerald-100 text-emerald-700 border-emerald-200",
  payment: "bg-blue-100 text-blue-700 border-blue-200",
  delete: "bg-red-100 text-red-700 border-red-200",
  generate: "bg-purple-100 text-purple-700 border-purple-200",
  config_update: "bg-amber-100 text-amber-700 border-amber-200",
}

export function RrhhAuditoriaPage() {
  const { apiUrl, showToast } = useAppStore()
  const business = useCurrentBusiness()
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [tableMissing, setTableMissing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [filterModule, setFilterModule] = useState("all")
  const [desde, setDesde] = useState("")
  const [detail, setDetail] = useState<AuditLog | null>(null)

  const call = (params: Record<string, string | number | boolean>) => apiCall(normalizeApiUrl(apiUrl), params)

  const reload = async () => {
    setLoading(true)
    try {
      const params: Record<string, string> = { action: "getHrAuditLogs" }
      if (filterModule !== "all") params.module = filterModule
      if (desde) params.desde = desde
      const res = await call(params) as { ok?: boolean; records?: AuditLog[]; tableMissing?: boolean }
      setTableMissing(Boolean(res?.tableMissing)); setLogs(res?.records ?? [])
    } catch (err) { showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error") } finally { setLoading(false) }
  }
  useEffect(() => { reload() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const pag = usePagination(logs, { initialPageSize: 50, resetKey: `${filterModule}|${desde}|${logs.length}` })

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-primary/10 p-2.5 text-primary"><Shield className="h-6 w-6" /></div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">RR.HH. · Reportes · {business.shortName}</p>
          <h2 className="mt-0.5 text-xl font-black tracking-tight">Auditoría RR.HH.</h2>
          <p className="mt-1 text-sm text-muted-foreground">Registro de acciones críticas (crear/editar/aprobar/pagar/eliminar) con usuario, valores anteriores y nuevos.</p>
        </div>
      </div>

      {tableMissing && !loading && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex items-start gap-2">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-amber-600" /><div>La tabla <code className="text-xs bg-amber-100 px-1 rounded">hr_audit_logs</code> aún no existe en este tenant.</div>
        </div>
      )}

      <div className="flex flex-wrap gap-3 items-end">
        <div className="min-w-[180px]">
          <Label className="text-xs">Módulo</Label>
          <Select value={filterModule} onValueChange={setFilterModule}>
            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {MODULES.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div><Label className="text-xs">Desde</Label><Input type="date" value={desde} onChange={e => setDesde(e.target.value)} className="h-8" /></div>
        <Button onClick={reload} disabled={loading} className="h-8"><RefreshCw className={`w-4 h-4 mr-1 ${loading ? "animate-spin" : ""}`} />Aplicar</Button>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          {loading ? (
            <div className="py-10 text-center text-sm text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Cargando...</div>
          ) : logs.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Sin registros de auditoría en el filtro.</div>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead className="text-xs">Fecha / hora</TableHead>
                <TableHead className="text-xs">Usuario</TableHead>
                <TableHead className="text-xs">Módulo</TableHead>
                <TableHead className="text-xs">Acción</TableHead>
                <TableHead className="text-xs">Entidad</TableHead>
                <TableHead className="text-xs text-center w-16">Ver</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {pag.pageItems.map(l => (
                  <TableRow key={l.id}>
                    <TableCell className="text-xs">{new Date(l.created_at).toLocaleString("es-DO")}</TableCell>
                    <TableCell className="text-xs">{l.user_email || "—"}</TableCell>
                    <TableCell className="text-xs">{l.module}</TableCell>
                    <TableCell><Badge variant="outline" className={ACTION_CLASS[l.action] || ""}>{l.action}</Badge></TableCell>
                    <TableCell className="text-xs font-mono">{l.entity_type}{l.entity_id ? `:${String(l.entity_id).slice(0, 8)}` : ""}</TableCell>
                    <TableCell className="text-center"><Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setDetail(l)} title="Ver detalle"><Eye className="h-3.5 w-3.5" /></Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <DataPagination page={pag.page} totalPages={pag.totalPages} total={pag.total} from={pag.from} to={pag.to} pageSize={pag.pageSize} onPage={pag.setPage} onPageSize={pag.setPageSize} label="registros" />
        </CardContent>
      </Card>

      <Dialog open={!!detail} onOpenChange={open => !open && setDetail(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Detalle de auditoría</DialogTitle></DialogHeader>
          {detail && (
            <div className="space-y-3 py-2 text-sm">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><b>Fecha:</b> {new Date(detail.created_at).toLocaleString("es-DO")}</div>
                <div><b>Usuario:</b> {detail.user_email || "—"}</div>
                <div><b>Módulo:</b> {detail.module}</div>
                <div><b>Acción:</b> {detail.action}</div>
                <div className="col-span-2"><b>Entidad:</b> {detail.entity_type} {detail.entity_id}</div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs font-semibold text-muted-foreground mb-1">Valores anteriores</div>
                  <pre className="text-[11px] bg-muted/40 rounded p-2 overflow-auto max-h-72 whitespace-pre-wrap">{detail.old_values ? JSON.stringify(detail.old_values, null, 2) : "—"}</pre>
                </div>
                <div>
                  <div className="text-xs font-semibold text-muted-foreground mb-1">Valores nuevos</div>
                  <pre className="text-[11px] bg-muted/40 rounded p-2 overflow-auto max-h-72 whitespace-pre-wrap">{detail.new_values ? JSON.stringify(detail.new_values, null, 2) : "—"}</pre>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
