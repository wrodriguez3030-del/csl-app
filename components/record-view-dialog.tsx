"use client"

import * as React from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"

/**
 * Diálogo de detalle genérico para listas/tablas.
 *
 * Renderiza los campos del record como tarjetas key-value en grid 2 cols.
 * Usado por pages que no tienen un dialog custom propio (Sucursales, Tecnicos,
 * Inventario, Cosmiatria-clientes, etc). Pages con dialogs ricos custom
 * (Reportes, Credenciales, Consentimientos, Certificados, Equipos) usan los
 * suyos.
 *
 * `extraSlot` permite a la page agregar contenido extra (ej: reportes
 * relacionados) sin reimplementar la cabecera ni los key-value.
 */

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
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

function isImageDataUrl(value: unknown) {
  return typeof value === "string" && /^data:image\/(png|jpe?g|webp);base64,/i.test(value)
}

function isSignatureKey(key: string) {
  return /firma|signature/i.test(key)
}

export function RecordViewDialog<T extends Record<string, unknown>>({
  record,
  title,
  onClose,
  extraSlot,
}: {
  record: T | null
  title: string
  onClose: () => void
  extraSlot?: React.ReactNode
}) {
  if (!record) return null
  const entries = Object.entries(record).filter(
    ([key, value]) => !key.startsWith("_") && typeof value !== "function",
  )
  return (
    <Dialog open={Boolean(record)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-2 md:grid-cols-2">
          {entries.map(([key, value]) => (
            <div key={key} className="rounded-lg border bg-muted/20 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {labelize(key)}
              </p>
              {isImageDataUrl(value) && isSignatureKey(key) ? (
                <img
                  src={String(value)}
                  alt={labelize(key)}
                  className="mt-2 max-h-40 rounded border bg-white p-2"
                />
              ) : (
                <p className="mt-1 whitespace-pre-wrap break-words text-sm">{valueText(value)}</p>
              )}
            </div>
          ))}
        </div>
        {extraSlot}
      </DialogContent>
    </Dialog>
  )
}
