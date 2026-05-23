"use client"

import type React from "react"
import { AlertTriangle } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

/**
 * Botones estandarizados Sí / No para todos los formularios del sistema.
 *
 * Diseño:
 *  - Pill grandes, touch-friendly (min 44px alto).
 *  - Color activo = --brand-primary del business actual (CSL / Depicenter).
 *  - Texto + check pequeño cuando seleccionado.
 *  - Responsive: 2 columnas horizontal por defecto; "vertical" apila.
 *  - Accesibilidad: radiogroup con aria-checked + type="button" (no submit).
 *
 * Compatibilidad de datos:
 *  - default options = ["Sí", "No"] (con tilde) — usado por consentimientos
 *    y nuevo-reporte.
 *  - Para ficha-dermatologia que ya guarda "Si" (sin tilde) en DB, pasar
 *    options={["Si","No"]} para no romper datos existentes.
 *
 * No se cambia ninguna estructura de DB.
 */

export interface SiNoButtonsProps {
  /** Texto/JSX de la pregunta. Si es JSX usar `ariaLabel` para a11y. */
  label?: React.ReactNode
  /** Valor actual. "" = sin seleccionar. */
  value: string
  /** Llamado con el string elegido (uno de `options`). */
  onChange: (value: string) => void
  /**
   * Tupla [valorSí, valorNo]. Default ["Sí", "No"] (con tilde).
   * Override a ["Si", "No"] si el campo en DB ya guarda sin tilde.
   */
  options?: readonly [string, string]
  /** Marca el grupo como requerido (asterisco visible). */
  required?: boolean
  disabled?: boolean
  /** Texto pequeño bajo los botones (gris). */
  helperText?: string
  /** Mensaje de error en rojo (oculta helperText). */
  error?: string
  /** "horizontal" (default, 2 cols) o "vertical" (apilado). */
  layout?: "horizontal" | "vertical"
  /** A11y: aria-label cuando `label` es JSX o se quiere uno distinto. */
  ariaLabel?: string
  /** Clase opcional para el contenedor externo. */
  className?: string
}

export function SiNoButtons({
  label,
  value,
  onChange,
  options = ["Sí", "No"],
  required,
  disabled,
  helperText,
  error,
  layout = "horizontal",
  ariaLabel,
  className,
}: SiNoButtonsProps) {
  const labelText = typeof label === "string" ? label : undefined
  return (
    <div className={cn("space-y-2", className)}>
      {label ? (
        <Label className="text-xs font-bold uppercase tracking-wide text-[color:var(--brand-primary-dark)]">
          {label}
          {required ? <span className="ml-0.5 text-rose-500">*</span> : null}
        </Label>
      ) : null}
      <div
        role="radiogroup"
        aria-label={ariaLabel || labelText}
        aria-required={required || undefined}
        className={cn(
          "gap-2",
          layout === "vertical" ? "grid grid-cols-1" : "grid grid-cols-2",
        )}
      >
        {options.map((opt) => {
          const isSelected = value === opt
          return (
            <button
              key={opt}
              type="button"
              role="radio"
              aria-checked={isSelected}
              aria-pressed={isSelected}
              disabled={disabled}
              onClick={() => onChange(opt)}
              className={cn(
                "flex min-h-[44px] items-center justify-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold transition-colors",
                "disabled:cursor-not-allowed disabled:opacity-50",
                isSelected
                  ? "border-[color:var(--brand-primary)] bg-[color:var(--brand-primary)] text-white shadow-sm"
                  : "border-[color:var(--brand-border)] bg-white text-[color:var(--brand-primary-dark)] hover:border-[color:var(--brand-primary)]/40 hover:bg-[color:var(--brand-primary-soft)]",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "flex h-4 w-4 items-center justify-center rounded-full border text-[10px] font-black leading-none",
                  isSelected
                    ? "border-white bg-white text-[color:var(--brand-primary)]"
                    : "border-[color:var(--brand-border)] text-transparent",
                )}
              >
                ✓
              </span>
              {opt}
            </button>
          )
        })}
      </div>
      {error ? (
        <p className="text-xs font-medium text-rose-600">{error}</p>
      ) : helperText ? (
        <p className="text-xs text-muted-foreground">{helperText}</p>
      ) : null}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SiNoConDetalle — Sí/No + input de detalle CONDICIONAL (solo si Sí).
// ─────────────────────────────────────────────────────────────────────────────
//
// Resuelve el patrón típico clínico:
//   "¿Tiene alergias?  [Sí][No]"
//   Si Sí → mostrar "¿A qué?" como Input/Textarea
//   Si No → ocultar el detalle Y limpiar su valor
//
// Además soporta una alerta opcional cuando se elige Sí (caso ¿Embarazada?).
// El bloqueo del submit lo decide el padre leyendo el value — esta función
// no asume nada del flujo de guardado.

export interface SiNoConDetalleProps extends Omit<SiNoButtonsProps, "onChange"> {
  /** Callback al cambiar Sí/No. Si se elige el valor "No" (options[1])
   *  el componente también llamará a onDetailChange("") para limpiar. */
  onChange: (value: string) => void
  /** Label del input de detalle. Ej "¿Cuáles?" / "¿A qué?". */
  detailLabel?: string
  /** Valor actual del detalle. */
  detailValue?: string
  /** Callback cuando cambia el detalle. */
  onDetailChange?: (value: string) => void
  /** Placeholder del input de detalle. */
  detailPlaceholder?: string
  /** Usar Textarea en vez de Input. Default false (Input). */
  detailMultiline?: boolean
  /** Alerta que aparece debajo cuando el value es "Sí"/"Si". */
  warningWhenYes?: React.ReactNode
}

export function SiNoConDetalle({
  options = ["Sí", "No"],
  value,
  onChange,
  detailLabel,
  detailValue = "",
  onDetailChange,
  detailPlaceholder,
  detailMultiline = false,
  warningWhenYes,
  ...rest
}: SiNoConDetalleProps) {
  const [yesValue, noValue] = options
  const isYes = value === yesValue
  const isNo = value === noValue

  const handleChange = (next: string) => {
    onChange(next)
    // Limpiar el detalle si cambia a "No" — evita guardar texto stale.
    if (next === noValue && onDetailChange && detailValue) {
      onDetailChange("")
    }
  }

  return (
    <div className="space-y-2">
      <SiNoButtons {...rest} options={options} value={value} onChange={handleChange} />
      {isYes && warningWhenYes ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{warningWhenYes}</span>
        </div>
      ) : null}
      {isYes && detailLabel !== undefined ? (
        <div className="space-y-1">
          {detailLabel ? <Label className="text-xs">{detailLabel}</Label> : null}
          {detailMultiline ? (
            <Textarea
              value={detailValue}
              onChange={(e) => onDetailChange?.(e.target.value)}
              placeholder={detailPlaceholder}
              className="min-h-16"
            />
          ) : (
            <Input
              value={detailValue}
              onChange={(e) => onDetailChange?.(e.target.value)}
              placeholder={detailPlaceholder}
            />
          )}
        </div>
      ) : null}
      {!isYes && !isNo ? null : null}
    </div>
  )
}

/** Mensaje estándar para la alerta cuando ¿Está embarazada? = Sí. */
export const EMBARAZO_WARNING_MESSAGE =
  "No podemos continuar con el tratamiento si está embarazada. Consulte con el personal antes de continuar."

