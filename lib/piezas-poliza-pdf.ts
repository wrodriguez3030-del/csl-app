/**
 * Generador del PDF de "Lista piezas póliza" — usa window.print() sobre HTML
 * formal, mismo patrón que pulse-cuadre-pdf.ts.
 *
 * Multi-tenant: recibe el Business resuelto para usar logo/nombre correctos
 * (Cibao Spa Laser vs Depicenter). Los datos ya vienen filtrados desde la
 * página — el helper no aplica filtros, solo renderiza.
 */

import type { PiezaPolizaLista } from "@/lib/types"
import type { Business } from "@/lib/types"

export interface PiezasPolizaSnapshot {
  business: Business
  pendientes: PiezaPolizaLista[]
  recibidas: PiezaPolizaLista[]
  filtros: {
    busqueda?: string
    estado?: string
    prioridad?: string
    suplidor?: string
    sucursal?: string
  }
  generadoEn: string
  generadoPor?: string
  /** Origin absoluto (window.location.origin) para resolver assets en el popup. */
  origin: string
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function prioColor(p: string): string {
  if (p === "Alta") return "#dc2626"
  if (p === "Media") return "#2563eb"
  return "#059669"
}

function rowHtml(item: PiezaPolizaLista, includeRecibida: boolean): string {
  return `
    <tr>
      <td><b>${escapeHtml(item.PiezaNombre)}</b></td>
      <td>${escapeHtml(item.CategoriaSnapshot || "—")}</td>
      <td class="num">${item.Cantidad}</td>
      <td>${escapeHtml(item.Sucursal || "—")}</td>
      <td><span class="badge" style="background: ${prioColor(item.Prioridad)}; color: white">${escapeHtml(item.Prioridad)}</span></td>
      <td>${escapeHtml(item.FechaSolicitada)}</td>
      ${includeRecibida ? `<td>${escapeHtml(item.FechaRecibida || "—")}</td>` : ""}
      <td>${escapeHtml(item.Suplidor || "—")}</td>
      <td>${escapeHtml(item.Nota || "")}</td>
    </tr>`
}

function activeFiltersSummary(filtros: PiezasPolizaSnapshot["filtros"]): string {
  const parts: string[] = []
  if (filtros.busqueda) parts.push(`Búsqueda: <b>${escapeHtml(filtros.busqueda)}</b>`)
  if (filtros.estado && filtros.estado !== "todas") parts.push(`Estado: <b>${escapeHtml(filtros.estado)}</b>`)
  if (filtros.prioridad && filtros.prioridad !== "todas") parts.push(`Prioridad: <b>${escapeHtml(filtros.prioridad)}</b>`)
  if (filtros.suplidor && filtros.suplidor !== "todos") parts.push(`Suplidor: <b>${escapeHtml(filtros.suplidor)}</b>`)
  if (filtros.sucursal && filtros.sucursal !== "todas") parts.push(`Sucursal: <b>${escapeHtml(filtros.sucursal)}</b>`)
  return parts.length ? parts.join(" · ") : "Sin filtros aplicados"
}

export function buildPiezasPolizaPdfHtml(snapshot: PiezasPolizaSnapshot): string {
  const { business, pendientes, recibidas, filtros, generadoEn, generadoPor, origin } = snapshot
  const total = pendientes.length + recibidas.length
  const all = [...pendientes, ...recibidas]
  const altas = all.filter((i) => i.Prioridad === "Alta").length
  const medias = all.filter((i) => i.Prioridad === "Media").length
  const bajas = all.filter((i) => i.Prioridad === "Baja").length
  const suplidoresSet = new Set(all.map((i) => i.Suplidor).filter(Boolean) as string[])
  const sucursalesSet = new Set(all.map((i) => i.Sucursal).filter(Boolean) as string[])
  const logoSrc = `${origin}${business.logoUrl}`
  const accent = business.primaryColor || "#0f766e"

  const pendientesRows = pendientes.map((i) => rowHtml(i, false)).join("")
  const recibidasRows = recibidas.map((i) => rowHtml(i, true)).join("")

  return `<!doctype html><html><head><meta charset="utf-8" />
<title>Lista piezas póliza · ${escapeHtml(business.name)}</title>
<style>
  @page { size: letter portrait; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111827; font-size: 11px; margin: 0; }
  .header { border-bottom: 3px solid ${accent}; padding-bottom: 10px; margin-bottom: 14px; display: flex; justify-content: space-between; align-items: center; gap: 16px; }
  .brand { display: flex; align-items: center; gap: 12px; }
  .brand img { height: 56px; width: auto; object-fit: contain; }
  .brand-text .name { font-size: 16px; font-weight: 800; color: ${accent}; letter-spacing: .02em; }
  .brand-text .title { font-size: 14px; margin: 2px 0 0; font-weight: 700; color: #111827; }
  .brand-text .subtitle { font-size: 10px; color: #475569; margin-top: 2px; }
  .meta { color: #475569; font-size: 10px; text-align: right; }
  h2 { font-size: 12px; background: ${accent}; color: white; padding: 5px 8px; margin: 14px 0 6px; text-transform: uppercase; letter-spacing: .03em; border-radius: 4px; }
  .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-bottom: 10px; }
  .stat { border: 1px solid #d7dee8; border-radius: 6px; padding: 6px 8px; text-align: center; }
  .stat .v { font-size: 16px; font-weight: 800; }
  .stat .l { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: #64748b; margin-top: 2px; }
  .filters { font-size: 10px; color: #475569; margin: 4px 0 10px; padding: 6px 8px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 5px 6px; border: 1px solid #e2e8f0; font-size: 10px; vertical-align: top; }
  th { background: #f8fafc; text-align: left; font-weight: 700; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .badge { padding: 2px 6px; border-radius: 999px; font-size: 9px; font-weight: 800; letter-spacing: .04em; }
  .empty { text-align: center; padding: 12px; color: #94a3b8; font-style: italic; }
  .footer { margin-top: 18px; padding-top: 8px; border-top: 1px solid #e5e7eb; color: #64748b; font-size: 9px; text-align: center; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head><body>

<div class="header">
  <div class="brand">
    <img src="${escapeHtml(logoSrc)}" alt="${escapeHtml(business.name)}" onerror="this.style.display='none'" />
    <div class="brand-text">
      <div class="name">${escapeHtml(business.name)}</div>
      <h1 class="title">Lista piezas póliza</h1>
      <div class="subtitle">Piezas pendientes y recibidas por suplidor</div>
    </div>
  </div>
  <div class="meta">
    <div>Generado: <b>${escapeHtml(generadoEn)}</b></div>
    ${generadoPor ? `<div>Por: <b>${escapeHtml(generadoPor)}</b></div>` : ""}
  </div>
</div>

<div class="summary">
  <div class="stat"><div class="v">${total}</div><div class="l">Total piezas</div></div>
  <div class="stat"><div class="v" style="color:#2563eb">${pendientes.length}</div><div class="l">Pendientes</div></div>
  <div class="stat"><div class="v" style="color:#059669">${recibidas.length}</div><div class="l">Recibidas</div></div>
  <div class="stat"><div class="v" style="color:#dc2626">${altas}</div><div class="l">Prioridad alta</div></div>
  <div class="stat"><div class="v" style="color:#2563eb">${medias}</div><div class="l">Prioridad media</div></div>
  <div class="stat"><div class="v" style="color:#059669">${bajas}</div><div class="l">Prioridad baja</div></div>
  <div class="stat"><div class="v">${suplidoresSet.size}</div><div class="l">Suplidores</div></div>
  <div class="stat"><div class="v">${sucursalesSet.size}</div><div class="l">Sucursales</div></div>
</div>

<div class="filters">${activeFiltersSummary(filtros)}</div>

<h2>Pendientes por recibir (${pendientes.length})</h2>
${pendientes.length === 0 ? `<div class="empty">No hay piezas pendientes con los filtros actuales.</div>` : `
<table>
  <thead><tr>
    <th>Pieza</th><th>Categoría</th><th class="num">Cant.</th>
    <th>Sucursal</th><th>Prioridad</th>
    <th>Fecha solicitada</th><th>Suplidor</th><th>Nota</th>
  </tr></thead>
  <tbody>${pendientesRows}</tbody>
</table>`}

<h2>Recibidas (${recibidas.length})</h2>
${recibidas.length === 0 ? `<div class="empty">No hay piezas recibidas con los filtros actuales.</div>` : `
<table>
  <thead><tr>
    <th>Pieza</th><th>Categoría</th><th class="num">Cant.</th>
    <th>Sucursal</th><th>Prioridad</th>
    <th>Fecha solicitada</th><th>Fecha recibida</th><th>Suplidor</th><th>Nota</th>
  </tr></thead>
  <tbody>${recibidasRows}</tbody>
</table>`}

<div class="footer">
  ${escapeHtml(business.name)} · Lista piezas póliza · Generado ${escapeHtml(generadoEn)}
</div>

</body></html>`
}

/** Abre popup, escribe HTML y dispara diálogo de impresión (Guardar como PDF). */
export function printPiezasPoliza(snapshot: PiezasPolizaSnapshot): void {
  const html = buildPiezasPolizaPdfHtml(snapshot)
  const popup = window.open("", "_blank", "width=1100,height=900")
  if (!popup) return
  popup.document.write(html)
  popup.document.close()
  const safeName = snapshot.business.slug === "depicenter" ? "depicenter" : "cibao-spa-laser"
  const date = new Date().toISOString().slice(0, 10)
  popup.document.title = `lista-piezas-poliza-${safeName}-${date}`
  popup.onload = () => setTimeout(() => popup.print(), 400)
}
