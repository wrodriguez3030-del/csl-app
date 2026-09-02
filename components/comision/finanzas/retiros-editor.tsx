"use client"

/** Retiros de socios del período: lista y alta/edición en línea. */
import { useCallback, useEffect, useState } from "react"
import { useAppStore, apiJsonp, normalizeApiUrl, invalidateReadCache } from "@/lib/store"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DashPanel } from "@/components/dashboard-kit"
import { Plus, Trash2, Loader2 } from "lucide-react"
import { SimpleTable, fmtRD } from "@/components/bi-finance/bi-shared"

export interface PartnerWithdrawal {
  id?: string; withdrawal_date: string; kind: "dividendo" | "cuenta"
  partner: string; amount: number; notes: string
}

const empty = (from: string): PartnerWithdrawal => ({ withdrawal_date: from || new Date().toISOString().slice(0, 10), kind: "dividendo", partner: "", amount: 0, notes: "" })
const KIND_LABEL: Record<string, string> = { dividendo: "Dividendo", cuenta: "Retiro de cuenta" }

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><Label className="text-xs text-muted-foreground">{label}</Label>{children}</div>
}

export function RetirosEditor({ from, to, canManage, onChanged }: { from: string; to: string; canManage: boolean; onChanged: () => void }) {
  const { apiUrl, showToast } = useAppStore()
  const [rows, setRows] = useState<PartnerWithdrawal[]>([])
  const [draft, setDraft] = useState<PartnerWithdrawal | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "getPartnerWithdrawals", from, to })
      if (res?.ok) setRows((res.rows as PartnerWithdrawal[]) || [])
    } catch { /* el panel queda vacío */ }
  }, [apiUrl, from, to])
  useEffect(() => { void load() }, [load])

  const save = async () => {
    if (!draft) return
    setBusy(true)
    try {
      const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "savePartnerWithdrawal", data: JSON.stringify({ ...draft, amount: Number(draft.amount) }) })
      if (!res?.ok) throw new Error((res as { error?: string })?.error || "No se pudo guardar")
      invalidateReadCache("getBiFinanceData")
      setDraft(null); await load(); onChanged()
      showToast("Retiro guardado", "success")
    } catch (e) { showToast(e instanceof Error ? e.message : "Error", "error") } finally { setBusy(false) }
  }

  const remove = async (r: PartnerWithdrawal) => {
    if (!r.id || !window.confirm(`¿Eliminar el retiro de ${fmtRD(r.amount)} del ${r.withdrawal_date}?`)) return
    setBusy(true)
    try {
      const res = await apiJsonp(normalizeApiUrl(apiUrl), { action: "deletePartnerWithdrawal", id: r.id })
      if (!res?.ok) throw new Error((res as { error?: string })?.error || "No se pudo eliminar")
      invalidateReadCache("getBiFinanceData")
      await load(); onChanged()
      showToast("Retiro eliminado", "success")
    } catch (e) { showToast(e instanceof Error ? e.message : "Error", "error") } finally { setBusy(false) }
  }

  return (
    <DashPanel title="Retiros de socios del período" action={canManage && !draft ? "Añadir" : undefined} onAction={() => setDraft(empty(from))}>
      {rows.length ? (
        <SimpleTable
          head={["Fecha", "Tipo", "Socio", "Monto", "Notas", ""]}
          alignRight={[3]}
          rows={rows.map((r) => [
            r.withdrawal_date, KIND_LABEL[r.kind] || r.kind, r.partner || "—", fmtRD(r.amount), r.notes || "—",
            canManage ? (<Button key={r.id} variant="ghost" size="sm" className="h-7 text-rose-600" disabled={busy} onClick={() => remove(r)}><Trash2 className="h-3.5 w-3.5" /></Button>) as unknown as string : "",
          ])}
        />
      ) : <p className="py-4 text-center text-sm text-muted-foreground">Sin retiros registrados en el período.</p>}

      {draft ? (
        <div className="mt-3 grid gap-2 rounded-lg border p-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Fecha"><Input type="date" value={draft.withdrawal_date} onChange={(e) => setDraft({ ...draft, withdrawal_date: e.target.value })} /></Field>
          <Field label="Tipo">
            <Select value={draft.kind} onValueChange={(v) => setDraft({ ...draft, kind: v as PartnerWithdrawal["kind"] })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="dividendo">Dividendo</SelectItem><SelectItem value="cuenta">Retiro de cuenta</SelectItem></SelectContent>
            </Select>
          </Field>
          <Field label="Socio"><Input value={draft.partner} onChange={(e) => setDraft({ ...draft, partner: e.target.value })} placeholder="Opcional" /></Field>
          <Field label="Monto"><Input type="number" min="0" step="0.01" value={draft.amount || ""} onChange={(e) => setDraft({ ...draft, amount: Number(e.target.value) })} /></Field>
          <Field label="Notas"><Input value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="Opcional" /></Field>
          <div className="flex items-end gap-2 lg:col-span-5">
            <Button size="sm" disabled={busy || !draft.amount} onClick={save}>{busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Plus className="mr-1.5 h-4 w-4" />}Guardar</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDraft(null)}>Cancelar</Button>
          </div>
        </div>
      ) : null}
      {!canManage ? <p className="mt-2 text-[11px] text-muted-foreground">Solo lectura: necesitas el permiso «Gestionar inversiones y retiros de socios».</p> : null}
    </DashPanel>
  )
}
