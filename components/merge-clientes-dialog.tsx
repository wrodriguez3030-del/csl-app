"use client"

import { useEffect, useMemo, useState } from "react"
import { ArrowRight, Check, Loader2, Search, Users, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Textarea } from "@/components/ui/textarea"
import { apiJsonp, normalizeApiUrl, useAppStore } from "@/lib/store"
import { searchClients } from "@/lib/cliente-search"
import { displayPhone, displayDocumento } from "@/lib/formatters"
import type { ClienteCosmiatria } from "@/lib/types"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  clientes: ClienteCosmiatria[]
  onMerged?: () => void
}

// Campos comparables (DB column → label visible). Estos son los que el operador
// puede elegir como "valor final" antes de confirmar la unificación.
const COMPARE_FIELDS: Array<{ key: keyof ClienteCosmiatria; column: string; label: string; format?: (v: string) => string }> = [
  { key: "Nombre", column: "nombre", label: "Nombre" },
  { key: "Apellido", column: "apellido", label: "Apellido" },
  { key: "Telefono", column: "telefono", label: "Teléfono", format: displayPhone },
  { key: "Telefono2", column: "telefono2", label: "Teléfono 2", format: displayPhone },
  { key: "DocumentoIdentidad", column: "documento_identidad", label: "Documento", format: displayDocumento },
  { key: "Email", column: "email", label: "Correo" },
  { key: "Direccion", column: "direccion", label: "Dirección" },
  { key: "Sucursal", column: "sucursal", label: "Sucursal" },
]

type ChoiceSide = "primary" | "duplicate"

interface MergeResult {
  counts: { fichas: number; masajes: number; tatuajes: number; links: number }
  primary: ClienteCosmiatria
  warning?: string
}

export function MergeClientesDialog({ open, onOpenChange, clientes, onMerged }: Props) {
  const { apiUrl, showToast } = useAppStore()

  const [step, setStep] = useState<"select" | "compare" | "result">("select")
  const [primary, setPrimary] = useState<ClienteCosmiatria | null>(null)
  const [duplicate, setDuplicate] = useState<ClienteCosmiatria | null>(null)
  const [primarySearch, setPrimarySearch] = useState("")
  const [duplicateSearch, setDuplicateSearch] = useState("")
  const [choices, setChoices] = useState<Record<string, ChoiceSide>>({})
  const [confirm, setConfirm] = useState(false)
  const [note, setNote] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [result, setResult] = useState<MergeResult | null>(null)

  useEffect(() => {
    if (open) {
      setStep("select")
      setPrimary(null)
      setDuplicate(null)
      setPrimarySearch("")
      setDuplicateSearch("")
      setChoices({})
      setConfirm(false)
      setNote("")
      setSubmitting(false)
      setError("")
      setResult(null)
    }
  }, [open])

  // Solo clientes activos (no fusionados ya) y no inactivos.
  const activos = useMemo(
    () => clientes.filter((c) => {
      if (c.Estado === "Inactivo") return false
      const merged = (c as unknown as Record<string, unknown>).merged_into_cliente_id
      return !merged
    }),
    [clientes],
  )
  const primaryMatches = useMemo(
    () => (primarySearch.trim() ? searchClients(activos, primarySearch, { limit: 8 }) : []),
    [activos, primarySearch],
  )
  const duplicateMatches = useMemo(() => {
    if (!duplicateSearch.trim()) return []
    return searchClients(activos, duplicateSearch, { limit: 8 }).filter((c) => c.ClienteID !== primary?.ClienteID)
  }, [activos, duplicateSearch, primary])

  const selectPrimary = (c: ClienteCosmiatria) => {
    setPrimary(c)
    setPrimarySearch("")
    setError("")
  }
  const selectDuplicate = (c: ClienteCosmiatria) => {
    setDuplicate(c)
    setDuplicateSearch("")
    setError("")
  }

  const goToCompare = () => {
    if (!primary || !duplicate) {
      setError("Selecciona un cliente principal y un duplicado.")
      return
    }
    // Inicializar choices: por defecto valor del PRIMARY si está, sino del duplicate.
    const initial: Record<string, ChoiceSide> = {}
    for (const field of COMPARE_FIELDS) {
      const pVal = String(primary[field.key] || "").trim()
      initial[field.column] = pVal ? "primary" : "duplicate"
    }
    setChoices(initial)
    setStep("compare")
  }

  const setChoice = (column: string, side: ChoiceSide) => {
    setChoices((current) => ({ ...current, [column]: side }))
  }

  const buildFinalFields = (): Record<string, string> => {
    if (!primary || !duplicate) return {}
    const final: Record<string, string> = {}
    for (const field of COMPARE_FIELDS) {
      const side = choices[field.column] === "duplicate" ? duplicate : primary
      final[field.column] = String(side[field.key] || "").trim()
    }
    return final
  }

  const confirmMerge = async () => {
    if (!primary || !duplicate) return
    if (!confirm) {
      setError("Marca la confirmación antes de continuar.")
      return
    }
    setSubmitting(true)
    setError("")
    try {
      const response = await apiJsonp(normalizeApiUrl(apiUrl), {
        action: "mergeClientes",
        primaryClienteId: primary.ClienteID,
        duplicateClienteId: duplicate.ClienteID,
        note,
        finalFields: JSON.stringify(buildFinalFields()),
      })
      const typed = response as { ok?: boolean; code?: string; error?: string; counts?: MergeResult["counts"]; primary?: Record<string, unknown>; warning?: string }
      if (!typed?.ok) {
        throw new Error(typed?.error || "Error al unificar clientes")
      }
      setResult({
        counts: typed.counts || { fichas: 0, masajes: 0, tatuajes: 0, links: 0 },
        primary: (typed.primary || {}) as unknown as ClienteCosmiatria,
        warning: typed.warning,
      })
      setStep("result")
      onMerged?.()
    } catch (mergeError) {
      setError(mergeError instanceof Error ? mergeError.message : "Error al unificar clientes")
    } finally {
      setSubmitting(false)
    }
  }

  const renderCard = (c: ClienteCosmiatria | null, side: "principal" | "duplicado") => {
    if (!c) {
      return (
        <div className="rounded-lg border border-dashed bg-muted/40 p-3 text-sm text-muted-foreground">
          Aún no has seleccionado el cliente {side}.
        </div>
      )
    }
    return (
      <div className="rounded-lg border-2 border-primary/30 bg-primary/5 p-3">
        <p className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">
          Cliente {side}
        </p>
        <p className="mt-1 truncate text-base font-bold text-primary">
          {`${c.Nombre} ${c.Apellido || ""}`.trim()}
        </p>
        <p className="text-xs text-muted-foreground">
          {displayPhone(c.Telefono) || "Sin teléfono"}
          {c.DocumentoIdentidad ? ` · ${displayDocumento(c.DocumentoIdentidad)}` : ""}
        </p>
        {c.Sucursal ? <p className="text-xs text-muted-foreground">{c.Sucursal}</p> : null}
      </div>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[960px] max-h-[calc(100dvh-24px)] overflow-y-auto p-5 sm:p-6"
        style={{ width: "min(960px, calc(100vw - 16px))" }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Users className="h-5 w-5" /> Unificar clientes
          </DialogTitle>
          <DialogDescription>
            Selecciona el cliente principal y el cliente duplicado. Todos los registros del duplicado pasarán al cliente principal.
          </DialogDescription>
        </DialogHeader>

        {step === "select" ? (
          <div className="grid gap-4 py-2 md:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-sm font-bold">Cliente principal</Label>
              {renderCard(primary, "principal")}
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={primarySearch}
                  onChange={(e) => setPrimarySearch(e.target.value)}
                  placeholder="Buscar por nombre, teléfono, cédula..."
                  className="pl-9"
                />
              </div>
              {primaryMatches.length > 0 ? (
                <div className="max-h-[200px] overflow-y-auto rounded-md border divide-y">
                  {primaryMatches.map((c) => (
                    <button
                      key={c.ClienteID}
                      type="button"
                      onClick={() => selectPrimary(c)}
                      className="flex w-full flex-col px-3 py-2 text-left text-sm hover:bg-primary/5"
                    >
                      <span className="font-semibold">{`${c.Nombre} ${c.Apellido || ""}`.trim()}</span>
                      <span className="text-xs text-muted-foreground">
                        {displayPhone(c.Telefono) || "—"}
                        {c.DocumentoIdentidad ? ` · ${displayDocumento(c.DocumentoIdentidad)}` : ""}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-bold">Cliente duplicado</Label>
              {renderCard(duplicate, "duplicado")}
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={duplicateSearch}
                  onChange={(e) => setDuplicateSearch(e.target.value)}
                  placeholder="Buscar el cliente a fusionar..."
                  className="pl-9"
                />
              </div>
              {duplicateMatches.length > 0 ? (
                <div className="max-h-[200px] overflow-y-auto rounded-md border divide-y">
                  {duplicateMatches.map((c) => (
                    <button
                      key={c.ClienteID}
                      type="button"
                      onClick={() => selectDuplicate(c)}
                      className="flex w-full flex-col px-3 py-2 text-left text-sm hover:bg-amber-50"
                    >
                      <span className="font-semibold">{`${c.Nombre} ${c.Apellido || ""}`.trim()}</span>
                      <span className="text-xs text-muted-foreground">
                        {displayPhone(c.Telefono) || "—"}
                        {c.DocumentoIdentidad ? ` · ${displayDocumento(c.DocumentoIdentidad)}` : ""}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ) : step === "compare" && primary && duplicate ? (
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-sm">
              <div className="rounded border bg-primary/5 px-3 py-2 font-semibold">
                {`${primary.Nombre} ${primary.Apellido || ""}`.trim()}
              </div>
              <ArrowRight className="h-5 w-5 text-muted-foreground" />
              <div className="rounded border bg-amber-50 px-3 py-2 font-semibold">
                {`${duplicate.Nombre} ${duplicate.Apellido || ""}`.trim()}
              </div>
            </div>

            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-bold uppercase tracking-wide">Campo</th>
                    <th className="px-3 py-2 text-left text-xs font-bold uppercase tracking-wide">Principal</th>
                    <th className="px-3 py-2 text-left text-xs font-bold uppercase tracking-wide">Duplicado</th>
                    <th className="px-3 py-2 text-center text-xs font-bold uppercase tracking-wide">Conservar</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {COMPARE_FIELDS.map((field) => {
                    const pRaw = String(primary[field.key] || "").trim()
                    const dRaw = String(duplicate[field.key] || "").trim()
                    const pDisplay = field.format ? field.format(pRaw) : pRaw
                    const dDisplay = field.format ? field.format(dRaw) : dRaw
                    const choice = choices[field.column] || "primary"
                    return (
                      <tr key={field.column}>
                        <td className="px-3 py-2 font-semibold">{field.label}</td>
                        <td className="px-3 py-2 text-muted-foreground">{pDisplay || "—"}</td>
                        <td className="px-3 py-2 text-muted-foreground">{dDisplay || "—"}</td>
                        <td className="px-3 py-2">
                          <div className="flex justify-center gap-1">
                            <Button
                              size="sm"
                              variant={choice === "primary" ? "default" : "outline"}
                              onClick={() => setChoice(field.column, "primary")}
                              className="h-7 px-2 text-xs"
                              disabled={!pRaw && !dRaw}
                            >
                              Principal
                            </Button>
                            <Button
                              size="sm"
                              variant={choice === "duplicate" ? "default" : "outline"}
                              onClick={() => setChoice(field.column, "duplicate")}
                              className="h-7 px-2 text-xs"
                              disabled={!dRaw}
                            >
                              Duplicado
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Nota (opcional)</Label>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Razón o contexto de la unificación..."
                rows={2}
              />
            </div>

            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
              <p className="font-bold">Esta acción no es reversible automáticamente.</p>
              <p className="mt-1">
                Todos los registros del cliente duplicado (fichas dermatológicas, consentimientos
                masajes, eliminación tatuajes y cejas) pasarán al cliente principal. El cliente
                duplicado quedará archivado con estado <b>Fusionado</b>. Los PDFs y firmas
                existentes no se modifican.
              </p>
              <label className="mt-2 flex items-start gap-2">
                <Checkbox checked={confirm} onCheckedChange={(v) => setConfirm(v === true)} />
                <span>Entiendo que todos los registros se moverán al cliente principal.</span>
              </label>
            </div>
          </div>
        ) : step === "result" && result ? (
          <div className="space-y-3 py-2">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-700">
              <div className="flex items-center gap-2 font-bold">
                <Check className="h-5 w-5" /> Cliente unificado correctamente
              </div>
              <p className="mt-1 text-sm">Movidos al cliente principal:</p>
              <ul className="mt-2 grid grid-cols-2 gap-1 text-sm">
                <li>· Fichas dermatológicas: <b>{result.counts.fichas}</b></li>
                <li>· Consentimientos masajes: <b>{result.counts.masajes}</b></li>
                <li>· Consentimientos tatuajes/cejas: <b>{result.counts.tatuajes}</b></li>
                <li>· Links públicos: <b>{result.counts.links}</b></li>
              </ul>
              {result.warning ? (
                <p className="mt-2 text-xs text-amber-800">⚠ {result.warning}</p>
              ) : null}
            </div>
            {result.primary?.ClienteID ? (
              <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Cliente principal</div>
                <div className="mt-1 font-bold">
                  {`${result.primary.Nombre || ""} ${result.primary.Apellido || ""}`.trim()}
                </div>
                <div className="text-xs text-muted-foreground">
                  {displayPhone(result.primary.Telefono) || "—"}
                  {result.primary.DocumentoIdentidad ? ` · ${displayDocumento(result.primary.DocumentoIdentidad)}` : ""}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {error ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs font-semibold text-rose-700">
            <X className="mr-1 inline h-3 w-3" />
            {error}
          </div>
        ) : null}

        <DialogFooter className="sticky bottom-0 -mx-5 mt-3 flex-col gap-2 border-t bg-background px-5 pt-3 sm:-mx-6 sm:flex-row sm:px-6">
          {step === "select" ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button onClick={goToCompare} disabled={!primary || !duplicate}>
                Comparar datos
              </Button>
            </>
          ) : step === "compare" ? (
            <>
              <Button variant="outline" onClick={() => setStep("select")} disabled={submitting}>← Atrás</Button>
              <Button
                onClick={confirmMerge}
                disabled={!confirm || submitting}
                className="gap-2"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
                {submitting ? "Unificando..." : "Confirmar unificación"}
              </Button>
            </>
          ) : (
            <Button onClick={() => onOpenChange(false)} className="w-full sm:w-auto">Cerrar</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
