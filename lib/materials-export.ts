/**
 * Exportes del consolidado de Requisición de Materiales: Excel (HTML→.xls) y
 * PDF (HTML→window.print()). Cliente, sin dependencias de servidor.
 */
import type { ConsolidatedRow } from "./materials-client"
import { fmtNum } from "./materials-client"

const esc = (v: unknown) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")

interface ExportOpts {
  rows: ConsolidatedRow[]
  branches: string[]
  businessName: string
  filtros?: string
}

/** Agrupa filas por proveedor preservando el orden. */
function groupBySupplier(rows: ConsolidatedRow[]): [string, ConsolidatedRow[]][] {
  const groups: Record<string, ConsolidatedRow[]> = {}
  const order: string[] = []
  for (const r of rows) {
    if (!groups[r.supplierGroup]) {
      groups[r.supplierGroup] = []
      order.push(r.supplierGroup)
    }
    groups[r.supplierGroup].push(r)
  }
  return order.map((s) => [s, groups[s]])
}

function tableHtml(opts: ExportOpts): string {
  const { rows, branches } = opts
  const head = `
    <tr>
      <th style="text-align:left">Material</th>
      ${branches.map((b) => `<th>${esc(b)}</th>`).join("")}
      <th>Total</th>
      <th>Aprobado</th>
      <th style="text-align:left">Observación</th>
    </tr>`
  const body = groupBySupplier(rows)
    .map(([supplier, items]) => {
      const groupRow = `<tr class="grp"><td colspan="${branches.length + 4}"><b>${esc(supplier)}</b></td></tr>`
      const itemRows = items
        .map(
          (r) => `
        <tr>
          <td style="text-align:left">${esc(r.materialName)}</td>
          ${branches.map((b) => `<td>${fmtNum(r.byBranch[b] || 0)}</td>`).join("")}
          <td><b>${fmtNum(r.total)}</b></td>
          <td>${fmtNum(r.approved)}</td>
          <td></td>
        </tr>`,
        )
        .join("")
      return groupRow + itemRows
    })
    .join("")
  return `<table><thead>${head}</thead><tbody>${body}</tbody></table>`
}

export function exportConsolidadoExcel(opts: ExportOpts): void {
  const date = new Date().toISOString().slice(0, 10)
  const html = `<!doctype html><html><head><meta charset="utf-8">
    <style>
      table{border-collapse:collapse} th,td{border:1px solid #999;padding:4px 8px;text-align:center;font-family:Arial}
      th{background:#0891b2;color:#fff} .grp td{background:#e2e8f0}
    </style></head><body>
    <h2>REQUISICIÓN DE MATERIALES — ${esc(opts.businessName)}</h2>
    ${opts.filtros ? `<p>${esc(opts.filtros)}</p>` : ""}
    ${tableHtml(opts)}
    </body></html>`
  const blob = new Blob(["﻿" + html], { type: "application/vnd.ms-excel;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `Requisicion_Materiales_${String(opts.businessName).replace(/[^a-z0-9]+/gi, "_")}_${date}.xls`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function printConsolidadoPdf(opts: ExportOpts): void {
  const generado = new Date().toLocaleString("es-DO", { dateStyle: "long", timeStyle: "short" })
  const html = `<!doctype html><html><head><meta charset="utf-8">
    <title>requisicion-materiales</title>
    <style>
      @page{ size: letter portrait; margin: 12mm; }
      @media print{ -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      body{ font-family: Arial, sans-serif; color:#0f172a; }
      h1{ font-size:18px; margin:0 0 2px; }
      .meta{ font-size:11px; color:#475569; margin-bottom:10px; }
      table{ width:100%; border-collapse:collapse; font-size:11px; }
      th,td{ border:1px solid #cbd5e1; padding:4px 6px; text-align:center; }
      th{ background:#0891b2; color:#fff; }
      td.l, th.l{ text-align:left; }
      tr.grp td{ background:#e2e8f0; font-weight:bold; text-align:left; }
    </style></head><body>
    <h1>REQUISICIÓN DE MATERIALES</h1>
    <div class="meta">${esc(opts.businessName)} · Generado: ${esc(generado)}${opts.filtros ? " · " + esc(opts.filtros) : ""}</div>
    ${tableHtml(opts).replace("<th style=\"text-align:left\">Material</th>", "<th class=\"l\">Material</th>")}
    </body></html>`
  const popup = window.open("", "_blank", "width=1100,height=900")
  if (!popup) return
  popup.document.write(html)
  popup.document.close()
  popup.onload = () => setTimeout(() => popup.print(), 400)
}
