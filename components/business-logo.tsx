"use client"

import { useState } from "react"
import type { Business } from "@/lib/types"

/**
 * Renderiza el logo de un negocio con fallback gráfico si la imagen no carga.
 *
 * Pensado para el período de transición donde
 *   - `public/cibao-spa-laser-logo.jpeg` SÍ existe
 *   - `public/brands/depicenter-logo.jpg` puede no existir aún
 *
 * Si el src falla, mostramos las primeras 3 letras del slug del negocio
 * (DEP / CSL) como texto, conservando dimensiones del contenedor original.
 */
export function BusinessLogo({
  business,
  className = "",
  alt,
}: {
  business: Business
  className?: string
  alt?: string
}) {
  const [errored, setErrored] = useState(false)

  if (errored || !business.logoUrl) {
    return (
      <div
        className={`flex items-center justify-center bg-slate-100 font-black uppercase tracking-wider text-[color:var(--brand-primary-dark)] ${className}`}
        aria-label={alt || business.name}
      >
        <span className="text-[10px] sm:text-xs">{business.slug.slice(0, 3).toUpperCase()}</span>
      </div>
    )
  }

  return (
    <img
      src={business.logoUrl}
      alt={alt || business.name}
      className={className}
      onError={() => setErrored(true)}
    />
  )
}
