/**
 * Generador del PDF de Cuadre Semanal — usa window.print() sobre HTML
 * formal, mismo patrón que el PDF público de Ficha Dermatológica.
 *
 * No devuelve un Blob — abre un popup, escribe HTML y dispara print.
 * El usuario elige "Guardar como PDF" desde el diálogo del navegador.
 */

import type { AlertaNivel } from "@/lib/pulse-audit"
import { fmtFechaLocal } from "@/lib/pulse-audit"
import { getBusinessBranding, type BusinessBranding } from "@/lib/business"

export interface CuadreEquipoRow {
  equipoId: string
  sucursal: string
  cabina: string
  lecturaInicial: number
  lecturaFinal: number
  disparosLaser: number
  disparosOperador: number
  diferencia: number
  porcentaje: number
  alerta: AlertaNivel
  observaciones?: string
}

export interface CuadreSnapshot {
  semanaInicio: string
  semanaFin: string
  sucursalFiltro: string
  generadoEn: string
  generadoPor?: string
  archivos: Array<{ filename: string; rows?: number }>
  fotosCount: number
  equipos: CuadreEquipoRow[]
  /** Branding del tenant activo. Si falta, cae a CSL. */
  branding?: BusinessBranding
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function alertColor(a: AlertaNivel): string {
  return a === "OK" ? "#059669" : a === "Advertencia" ? "#d97706" : "#dc2626"
}

export function buildCuadrePdfHtml(snapshot: CuadreSnapshot): string {
  const branding = snapshot.branding ?? getBusinessBranding(null)
  const totLaser = snapshot.equipos.reduce((s, r) => s + r.disparosLaser, 0)
  const totOperador = snapshot.equipos.reduce((s, r) => s + r.disparosOperador, 0)
  const totDif = totOperador - totLaser
  const okN = snapshot.equipos.filter((r) => r.alerta === "OK").length
  const warnN = snapshot.equipos.filter((r) => r.alerta === "Advertencia").length
  const critN = snapshot.equipos.filter((r) => r.alerta === "Critico").length
  const peor = [...snapshot.equipos].sort((a, b) => Math.abs(b.diferencia) - Math.abs(a.diferencia))[0]

  const rows = snapshot.equipos.map((r) => `
    <tr>
      <td><b>${escapeHtml(r.equipoId)}</b></td>
      <td>${escapeHtml(r.sucursal)}</td>
      <td>${escapeHtml(r.cabina || "—")}</td>
      <td class="num">${r.lecturaInicial.toLocaleString("es-DO")}</td>
      <td class="num">${r.lecturaFinal.toLocaleString("es-DO")}</td>
      <td class="num"><b>${r.disparosLaser.toLocaleString("es-DO")}</b></td>
      <td class="num">${r.disparosOperador.toLocaleString("es-DO")}</td>
      <td class="num" style="color: ${r.diferencia === 0 ? "#475569" : r.diferencia > 0 ? "#dc2626" : "#0369a1"}">${r.diferencia > 0 ? "+" : ""}${r.diferencia.toLocaleString("es-DO")}</td>
      <td class="num">${r.porcentaje.toFixed(1)}%</td>
      <td><span class="badge" style="background: ${alertColor(r.alerta)}; color: white">${escapeHtml(r.alerta)}</span></td>
    </tr>`).join("")

  return `<!doctype html><html><head><meta charset="utf-8" />
<title>Cuadre semanal ${escapeHtml(snapshot.semanaInicio)} → ${escapeHtml(snapshot.semanaFin)}</title>
<style>
  @page { size: letter landscape; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111827; font-size: 11px; margin: 0; }
  .header { border-bottom: 3px solid #00897b; padding-bottom: 10px; margin-bottom: 14px; display: flex; justify-content: space-between; align-items: center; }
  .logo { font-size: 18px; font-weight: 800; color: #00897b; letter-spacing: .02em; }
  h1 { font-size: 15px; margin: 0; }
  .meta { color: #475569; font-size: 10px; }
  h2 { font-size: 11.5px; background: #00897b; color: white; padding: 5px 8px; margin: 12px 0 6px; text-transform: uppercase; letter-spacing: .03em; border-radius: 4px; }
  .summary { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; margin-bottom: 10px; }
  .stat { border: 1px solid #d7dee8; border-radius: 6px; padding: 8px; text-align: center; }
  .stat .v { font-size: 18px; font-weight: 800; }
  .stat .l { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: .12em; color: #64748b; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 5px 6px; border: 1px solid #e2e8f0; font-size: 10.5px; }
  th { background: #f8fafc; text-align: left; font-weight: 700; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .badge { padding: 2px 6px; border-radius: 999px; font-size: 9px; font-weight: 800; letter-spacing: .04em; }
  .footer { margin-top: 14px; padding-top: 8px; border-top: 1px solid #e5e7eb; color: #64748b; font-size: 9px; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head><body>

<div class="header">
  <div>
    <div class="logo">${escapeHtml(branding.name).toUpperCase()}</div>
    <h1>Cuadre semanal de disparos láser</h1>
    <div class="meta">Semana: <b>${escapeHtml(fmtFechaLocal(snapshot.semanaInicio))} → ${escapeHtml(fmtFechaLocal(snapshot.semanaFin))}</b> · Sucursal: <b>${escapeHtml(snapshot.sucursalFiltro)}</b></div>
  </div>
  <div class="meta" style="text-align: right">
    <div>Generado: ${escapeHtml(snapshot.generadoEn)}</div>
    ${snapshot.generadoPor ? `<div>Por: ${escapeHtml(snapshot.generadoPor)}</div>` : ""}
  </div>
</div>

<h2>Resumen ejecutivo</h2>
<div class="summary">
  <div class="stat"><div class="v">${snapshot.equipos.length}</div><div class="l">Equipos</div></div>
  <div class="stat"><div class="v">${totLaser.toLocaleString("es-DO")}</div><div class="l">Disp. láser</div></div>
  <div class="stat"><div class="v">${totOperador.toLocaleString("es-DO")}</div><div class="l">Disp. operador</div></div>
  <div class="stat"><div class="v" style="color: ${totDif === 0 ? "#475569" : totDif > 0 ? "#dc2626" : "#0369a1"}">${totDif > 0 ? "+" : ""}${totDif.toLocaleString("es-DO")}</div><div class="l">Diferencia total</div></div>
  <div class="stat"><div class="v" style="color: #059669">${okN}</div><div class="l">OK</div></div>
  <div class="stat"><div class="v" style="color: #dc2626">${critN}</div><div class="l">Críticos</div></div>
</div>

<h2>Detalle por equipo</h2>
<table>
  <thead><tr>
    <th>Equipo</th><th>Sucursal</th><th>Cabina</th>
    <th class="num">Lect. inicial</th><th class="num">Lect. final</th>
    <th class="num">Disp. láser</th><th class="num">Disp. operador</th>
    <th class="num">Diferencia</th><th class="num">%</th>
    <th>Estado</th>
  </tr></thead>
  <tbody>${rows || `<tr><td colspan="10" style="text-align:center;padding:14px">Sin equipos en el cuadre.</td></tr>`}</tbody>
</table>

${critN > 0 || warnN > 0 ? `
<h2>Alertas</h2>
<div class="meta" style="font-size: 11px">
  <b>${warnN}</b> equipo(s) con advertencia y <b>${critN}</b> crítico(s).${peor ? ` Mayor diferencia: <b>${escapeHtml(peor.equipoId)}</b> (${peor.diferencia > 0 ? "+" : ""}${peor.diferencia.toLocaleString("es-DO")}, ${peor.porcentaje.toFixed(1)}%).` : ""}
</div>
` : ""}

<div class="footer">
  ${escapeHtml(branding.footerText)} · Cuadre semanal de PulseControl · Generado el ${escapeHtml(snapshot.generadoEn)} ·
  Archivos AgendaPro: ${snapshot.archivos.length} · Fotos: ${snapshot.fotosCount}
</div>

</body></html>`
}

/** Abre popup y dispara el diálogo de impresión. */
export function printCuadre(snapshot: CuadreSnapshot): void {
  const html = buildCuadrePdfHtml(snapshot)
  const popup = window.open("", "_blank", "width=1100,height=900")
  if (!popup) return
  popup.document.write(html)
  popup.document.close()
  popup.onload = () => setTimeout(() => popup.print(), 400)
}
