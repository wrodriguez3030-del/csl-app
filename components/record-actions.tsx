"use client"

import { useMemo, useState } from "react"
import { Eye, Pencil, Printer, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useCurrentBusiness } from "@/hooks/use-current-business"
import { getBusinessBranding } from "@/lib/business"

type RecordActionsProps<T extends Record<string, unknown>> = {
  title: string
  record: T
  /** Cargador opcional del detalle COMPLETO por ID. Se invoca cuando el
   *  usuario hace click en Ver o en Imprimir (default), y el resultado
   *  reemplaza el `record` slim que vino del listado. Permite mantener los
   *  listados livianos (sin firmas/payload_json) sin perder datos en la
   *  vista de detalle ni en el PDF. */
  loadFullRecord?: () => Promise<T | null>
  onEdit?: () => void
  onDelete?: () => void
  onPrint?: () => void
  printTitle?: string
}

function labelize(key: string) {
  return key
    .replace(/^_/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .trim()
}

function valueText(value: unknown): string {
  if (value === null || value === undefined || value === "") return "-"
  if (Array.isArray(value)) return value.map(valueText).join(", ")
  if (typeof value === "object") {
    try { return JSON.stringify(value) } catch { return String(value) }
  }
  return String(value)
}

function escapeHtml(value: unknown) {
  return valueText(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

function isImageDataUrl(value: unknown) {
  return typeof value === "string" && /^data:image\/(png|jpe?g|webp);base64,/i.test(value)
}

function isSignatureKey(key: string) {
  return /firma|signature/i.test(key)
}

function printValueHtml(key: string, value: unknown) {
  if (isImageDataUrl(value) && isSignatureKey(key)) {
    return `<img src="${escapeHtml(value)}" alt="${escapeHtml(labelize(key))}" style="max-width:320px;max-height:150px;border:1px solid #d1d5db;background:white;padding:6px" />`
  }
  return escapeHtml(value)
}

function printRecord(title: string, entries: [string, unknown][], businessName: string = "Cibao Spa Laser") {
  const html = `<!doctype html><html><head><meta charset="utf-8" /><title>${escapeHtml(title)}</title><style>
body{font-family:Arial,Helvetica,sans-serif;margin:18px;font-size:12px;color:#111827}
.header{text-align:center;border-bottom:2px solid #00897b;margin-bottom:18px;padding-bottom:10px}
.logo{font-size:20px;font-weight:700;color:#00897b}
h1{font-size:16px;margin:6px 0 0}
table{width:100%;border-collapse:collapse}
th{background:#00897b;color:white;text-align:left;padding:7px;width:28%}
td{border:1px solid #d1d5db;padding:7px;vertical-align:top;white-space:pre-wrap}
tr:nth-child(even) td{background:#f8fafc}
</style></head><body><div class="header"><div class="logo">${escapeHtml(businessName.toUpperCase())}</div><h1>${escapeHtml(title)}</h1></div><table><tbody>${entries
    .map(([key, value]) => `<tr><th>${escapeHtml(labelize(key))}</th><td>${printValueHtml(key, value)}</td></tr>`)
    .join("")}</tbody></table></body></html>`
  const printWindow = window.open("", "_blank")
  if (!printWindow) return
  printWindow.document.write(html)
  printWindow.document.close()
  setTimeout(() => {
    printWindow.focus()
    printWindow.print()
  }, 400)
}

export function RecordActions<T extends Record<string, unknown>>({ title, record, loadFullRecord, onEdit, onDelete, onPrint, printTitle }: RecordActionsProps<T>) {
  const business = useCurrentBusiness()
  const [open, setOpen] = useState(false)
  const [fullRecord, setFullRecord] = useState<T | null>(null)
  const [isLoadingFull, setIsLoadingFull] = useState(false)
  const effective = fullRecord || record
  const entries = useMemo(
    () => Object.entries(effective).filter(([key, value]) => !key.startsWith("_") && typeof value !== "function"),
    [effective]
  )

  const ensureFull = async (): Promise<T> => {
    if (fullRecord) return fullRecord
    if (!loadFullRecord) return record
    try {
      setIsLoadingFull(true)
      const loaded = await loadFullRecord()
      if (loaded) {
        setFullRecord(loaded)
        return loaded
      }
    } catch (err) {
      console.warn("loadFullRecord falló — usando datos del listado slim:", err)
    } finally {
      setIsLoadingFull(false)
    }
    return record
  }

  const handleView = async () => {
    setOpen(true)
    if (loadFullRecord && !fullRecord) await ensureFull()
  }

  const handlePrintDefault = async () => {
    const full = await ensureFull()
    const printEntries = Object.entries(full).filter(([key, value]) => !key.startsWith("_") && typeof value !== "function")
    printRecord(printTitle || title, printEntries, getBusinessBranding(business).name)
  }

  return (
    <>
      <div className="flex justify-end gap-0.5">
        <Button size="icon" variant="ghost" className="h-7 w-7" title="Ver" onClick={() => void handleView()}>
          <Eye className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
        <Button size="icon" variant="ghost" className="h-7 w-7" title="Imprimir" onClick={() => onPrint ? onPrint() : void handlePrintDefault()}>
          <Printer className="h-3.5 w-3.5 text-primary" />
        </Button>
        {onEdit ? (
          <Button size="icon" variant="ghost" className="h-7 w-7" title="Editar" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        ) : null}
        {onDelete ? (
          <Button size="icon" variant="ghost" className="h-7 w-7" title="Eliminar" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        ) : null}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader><DialogTitle>{title}{isLoadingFull ? " · cargando detalle…" : ""}</DialogTitle></DialogHeader>
          <div className="grid gap-2 md:grid-cols-2">
            {entries.map(([key, value]) => (
              <div key={key} className="rounded-lg border bg-muted/20 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{labelize(key)}</p>
                {isImageDataUrl(value) && isSignatureKey(key) ? (
                  <img src={String(value)} alt={labelize(key)} className="mt-2 max-h-40 rounded border bg-white p-2" />
                ) : (
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm">{valueText(value)}</p>
                )}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
