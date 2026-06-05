"use client"

import { useEffect, useState } from "react"
import { apiCall, normalizeApiUrl, useAppStore } from "@/lib/store"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { EmployeeSelect } from "@/components/hr/employee-select"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { FileText, Plus, Trash2, Save, X, Loader2, Download, FileDown, AlertCircle } from "lucide-react"
import { useCurrentBusiness } from "@/hooks/use-current-business"

interface BankAccount { id: string; employee_id: string; bank_name: string; account_number: string; account_type: string; beneficiary: string | null; is_primary: boolean; active: boolean }
interface PayrollRun { id: string; period_start: string; period_end: string; tipo: string; status: string; totals?: { neto?: number } }
interface TxtFile { id: string; filename: string; total: number; lineas: number; status: string; created_at: string }

const rd = (n: number | undefined) => `RD$ ${(Number(n) || 0).toLocaleString("es-DO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function downloadTxt(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function RrhhTxtBancariosPage() {
  const { apiUrl, showToast } = useAppStore()
  const business = useCurrentBusiness()
  const [accounts, setAccounts] = useState<BankAccount[]>([])
  const [runs, setRuns] = useState<PayrollRun[]>([])
  const [files, setFiles] = useState<TxtFile[]>([])
  const [tableMissing, setTableMissing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Partial<BankAccount> | null>(null)
  const [busy, setBusy] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const call = (params: Record<string, string | number | boolean>) => apiCall(normalizeApiUrl(apiUrl), params)

  const reload = async () => {
    setLoading(true)
    try {
      const [acc, rs, fs] = await Promise.all([
        call({ action: "getHrBankAccounts" }) as Promise<{ ok?: boolean; records?: BankAccount[]; tableMissing?: boolean }>,
        call({ action: "getHrPayrollRuns" }) as Promise<{ ok?: boolean; records?: PayrollRun[] }>,
        call({ action: "getHrBankTxtFiles" }) as Promise<{ ok?: boolean; records?: TxtFile[] }>,
      ])
      setTableMissing(Boolean(acc?.tableMissing))
      setAccounts(acc?.records ?? [])
      setRuns((rs?.records ?? []).filter(r => r.status === "aprobada" || r.status === "pagada"))
      setFiles(fs?.records ?? [])
    } catch (err) {
      showToast(`Error al cargar: ${err instanceof Error ? err.message : String(err)}`, "error")
    } finally { setLoading(false) }
  }
  useEffect(() => { reload() }, [])

  const saveAccount = async () => {
    if (!editing) return
    if (!editing.employee_id?.trim()) { showToast("Empleado obligatorio", "error"); return }
    if (!editing.account_number?.trim()) { showToast("Número de cuenta obligatorio", "error"); return }
    setBusy(true)
    try {
      const payload: Record<string, string | boolean> = {
        employee_id: editing.employee_id.trim(),
        bank_name: editing.bank_name || "—",
        account_number: editing.account_number.trim(),
        account_type: editing.account_type || "Ahorro",
        is_primary: editing.is_primary ?? true,
        active: editing.active ?? true,
      }
      if (editing.id) payload.id = editing.id
      if (editing.beneficiary) payload.beneficiary = editing.beneficiary
      const res = await call({ action: "saveHrBankAccount", data: JSON.stringify(payload) }) as { ok?: boolean; error?: string; tableMissing?: boolean }
      if (res?.tableMissing) { showToast("Tabla hr_employee_bank_accounts aún no existe", "info"); setEditing(null); return }
      if (!res?.ok) { showToast(`Error: ${res?.error || "no se pudo guardar"}`, "error"); return }
      showToast("Cuenta guardada", "success")
      setEditing(null); reload()
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error")
    } finally { setBusy(false) }
  }

  const delAccount = async (id: string) => {
    if (!confirm("¿Eliminar esta cuenta bancaria?")) return
    if (!confirm("Confirma de nuevo: se eliminará permanentemente.")) return
    setBusyId(id)
    try {
      await call({ action: "deleteHrBankAccount", id })
      setAccounts(prev => prev.filter(a => a.id !== id))
      showToast("Cuenta eliminada", "success")
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error")
    } finally { setBusyId(null) }
  }

  const generar = async (run: PayrollRun) => {
    setBusyId(run.id)
    try {
      const res = await call({ action: "generateBankTxt", run_id: run.id }) as
        { ok?: boolean; filename?: string; content?: string; total?: number; lineas?: number; omitidos?: string[]; duplicado?: boolean; error?: string }
      if (!res?.ok) { showToast(`Error: ${res?.error || "no se pudo generar"}`, "error"); return }
      if (res.filename && res.content != null) downloadTxt(res.filename, res.content)
      let msg = `${res.duplicado ? "TXT ya existía — re-descargado" : "TXT generado"}: ${res.lineas} línea(s), ${rd(res.total)}`
      if (res.omitidos && res.omitidos.length) msg += ` · ${res.omitidos.length} sin cuenta: ${res.omitidos.slice(0, 3).join(", ")}${res.omitidos.length > 3 ? "…" : ""}`
      showToast(msg, res.omitidos && res.omitidos.length ? "info" : "success")
      reload()
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error")
    } finally { setBusyId(null) }
  }

  const redescargar = async (id: string) => {
    setBusyId(id)
    try {
      const res = await call({ action: "getHrBankTxtFile", id }) as { ok?: boolean; record?: { filename: string; content: string } }
      if (res?.record?.content != null) downloadTxt(res.record.filename, res.record.content)
      else showToast("Archivo no encontrado", "error")
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : String(err)}`, "error")
    } finally { setBusyId(null) }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-primary/10 p-2.5 text-primary"><FileText className="h-6 w-6" /></div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">RR.HH. · Pagos · {business.shortName}</p>
            <h2 className="mt-0.5 text-xl font-black tracking-tight">Archivos TXT bancarios</h2>
            <p className="mt-1 text-sm text-muted-foreground">Genera el TXT de una corrida aprobada: CUENTA_ORIGEN,CUENTA_DESTINO,MONTO,NOMBRE (sin encabezado, 2 decimales, nombres en mayúsculas).</p>
          </div>
        </div>
        <Button onClick={() => setEditing({ account_type: "Ahorro", is_primary: true, active: true })} className="shrink-0"><Plus className="w-4 h-4 mr-1" />Nueva cuenta</Button>
      </div>

      {tableMissing && !loading && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex items-start gap-2">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-amber-600" />
          <div>Las tablas de TXT bancario aún no existen. Aplica la migración <code className="text-xs bg-amber-100 px-1 rounded">202606020008_hr_bank_txt.sql</code>.</div>
        </div>
      )}

      {/* Generar desde corridas aprobadas */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Generar TXT desde nómina aprobada</CardTitle></CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {runs.length === 0 ? (
            <div className="px-4 py-6 text-sm text-muted-foreground">No hay corridas aprobadas. Aprueba una nómina primero.</div>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead className="text-xs">Período</TableHead>
                <TableHead className="text-xs">Tipo</TableHead>
                <TableHead className="text-xs text-right">Neto</TableHead>
                <TableHead className="text-xs">Estado</TableHead>
                <TableHead className="text-xs text-center w-32">TXT</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {runs.map(r => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs">{r.period_start} → {r.period_end}</TableCell>
                    <TableCell className="text-xs">{r.tipo}</TableCell>
                    <TableCell className="text-xs text-right font-mono">{rd(r.totals?.neto)}</TableCell>
                    <TableCell><Badge variant="outline" className="bg-emerald-100 text-emerald-700 border-emerald-200">{r.status}</Badge></TableCell>
                    <TableCell className="text-center">
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => generar(r)} disabled={busyId === r.id}>
                        {busyId === r.id ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <FileDown className="w-3.5 h-3.5 mr-1" />}Generar
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Historial de archivos */}
      {files.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Historial de archivos generados</CardTitle></CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead className="text-xs">Archivo</TableHead>
                <TableHead className="text-xs text-right">Líneas</TableHead>
                <TableHead className="text-xs text-right">Total</TableHead>
                <TableHead className="text-xs">Fecha</TableHead>
                <TableHead className="text-xs text-center w-28">Descargar</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {files.map(f => (
                  <TableRow key={f.id}>
                    <TableCell className="text-xs font-mono">{f.filename}</TableCell>
                    <TableCell className="text-xs text-right">{f.lineas}</TableCell>
                    <TableCell className="text-xs text-right font-mono">{rd(f.total)}</TableCell>
                    <TableCell className="text-xs">{new Date(f.created_at).toLocaleString("es-DO")}</TableCell>
                    <TableCell className="text-center">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => redescargar(f.id)} disabled={busyId === f.id} title="Descargar"><Download className="h-3.5 w-3.5" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Cuentas bancarias */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Cuentas bancarias de empleados</CardTitle></CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {loading ? (
            <div className="py-10 text-center text-sm text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Cargando...</div>
          ) : accounts.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Sin cuentas. Agrega la cuenta primaria de cada empleado para incluirlo en el TXT.</div>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead className="text-xs">Empleado</TableHead>
                <TableHead className="text-xs">Banco</TableHead>
                <TableHead className="text-xs">Cuenta</TableHead>
                <TableHead className="text-xs">Tipo</TableHead>
                <TableHead className="text-xs">Beneficiario</TableHead>
                <TableHead className="text-xs text-center">Primaria</TableHead>
                <TableHead className="text-xs text-center w-20">Acciones</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {accounts.map(a => (
                  <TableRow key={a.id}>
                    <TableCell className="text-xs font-medium">{a.employee_id}</TableCell>
                    <TableCell className="text-xs">{a.bank_name}</TableCell>
                    <TableCell className="text-xs font-mono">{a.account_number}</TableCell>
                    <TableCell className="text-xs">{a.account_type}</TableCell>
                    <TableCell className="text-xs">{a.beneficiary || "—"}</TableCell>
                    <TableCell className="text-center">{a.is_primary ? <Badge variant="outline" className="bg-emerald-100 text-emerald-700 border-emerald-200">Sí</Badge> : "—"}</TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-0.5">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditing(a)} title="Editar">✎</Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:bg-red-50" onClick={() => delAccount(a.id)} disabled={busyId === a.id} title="Eliminar"><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Dialog cuenta */}
      <Dialog open={!!editing} onOpenChange={open => !open && setEditing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editing?.id ? "Editar cuenta" : "Nueva cuenta bancaria"}</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3 py-2">
              <div className="space-y-1"><Label className="text-xs">Empleado *</Label><EmployeeSelect value={editing.employee_id} onSelect={emp => setEditing({ ...editing, employee_id: emp?.empleado_id || "", beneficiary: emp?.nombre || editing.beneficiary || "" })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label className="text-xs">Banco</Label><Input value={editing.bank_name || ""} onChange={e => setEditing({ ...editing, bank_name: e.target.value })} placeholder="Banreservas, Popular..." /></div>
                <div className="space-y-1">
                  <Label className="text-xs">Tipo</Label>
                  <Select value={editing.account_type || "Ahorro"} onValueChange={v => setEditing({ ...editing, account_type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="Ahorro">Ahorro</SelectItem><SelectItem value="Corriente">Corriente</SelectItem></SelectContent>
                  </Select>
                </div>
                <div className="space-y-1 col-span-2"><Label className="text-xs">Número de cuenta *</Label><Input value={editing.account_number || ""} onChange={e => setEditing({ ...editing, account_number: e.target.value })} /></div>
                <div className="space-y-1 col-span-2"><Label className="text-xs">Beneficiario (si difiere del nombre)</Label><Input value={editing.beneficiary || ""} onChange={e => setEditing({ ...editing, beneficiary: e.target.value })} /></div>
              </div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editing.is_primary ?? true} onChange={e => setEditing({ ...editing, is_primary: e.target.checked })} />Cuenta primaria (la que se usa en el TXT)</label>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={busy}><X className="w-4 h-4 mr-1" />Cancelar</Button>
            <Button onClick={saveAccount} disabled={busy}>{busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
