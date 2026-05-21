"use client"

/**
 * Carga la librería SheetJS (XLSX) bajo demanda desde CDN y devuelve una
 * promesa que resuelve con el namespace cuando esté lista.
 *
 * - Se carga UNA vez por sesión: la promesa se cachea.
 * - Si el script ya estaba cargado por otra parte de la página, la primera
 *   llamada lo detecta y resuelve inmediatamente.
 * - Reemplaza al patrón anterior de inyectar `<script>` directo en el JSX
 *   más el "espera 2 seg y reintenta" que mostraba toasts feos al usuario.
 */

const XLSX_CDN = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"

// Tipo opaco — los componentes hacen cast cuando necesitan métodos concretos.
export type XLSXModule = unknown

let cachedPromise: Promise<XLSXModule> | null = null

function getGlobalXlsx(): XLSXModule | undefined {
  if (typeof window === "undefined") return undefined
  return (window as unknown as { XLSX?: XLSXModule }).XLSX
}

export function loadXLSX(): Promise<XLSXModule> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("loadXLSX llamado en el servidor"))
  }

  const existing = getGlobalXlsx()
  if (existing) return Promise.resolve(existing)

  if (cachedPromise) return cachedPromise

  cachedPromise = new Promise<XLSXModule>((resolve, reject) => {
    // Si ya hay una etiqueta de script con el src, escuchamos su load.
    const existingScript = document.querySelector<HTMLScriptElement>(
      `script[src="${XLSX_CDN}"]`,
    )
    const handleLoad = () => {
      const xlsx = getGlobalXlsx()
      if (xlsx) resolve(xlsx)
      else reject(new Error("No se pudo cargar la librería XLSX"))
    }
    const handleError = () => {
      cachedPromise = null
      reject(new Error("No se pudo cargar la librería XLSX (red)"))
    }

    if (existingScript) {
      existingScript.addEventListener("load", handleLoad, { once: true })
      existingScript.addEventListener("error", handleError, { once: true })
      return
    }

    const script = document.createElement("script")
    script.src = XLSX_CDN
    script.async = true
    script.crossOrigin = "anonymous"
    script.referrerPolicy = "no-referrer"
    script.addEventListener("load", handleLoad, { once: true })
    script.addEventListener("error", handleError, { once: true })
    document.head.appendChild(script)
  })

  return cachedPromise
}
