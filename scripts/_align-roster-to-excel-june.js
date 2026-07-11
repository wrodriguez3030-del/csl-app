/**
 * Alinea el roster de colaboradores al cuadro oficial "SISTEMA INCENTIVOS .xlsx"
 * (Junio). Solo UPDATEs reversibles vía UI (ningún DELETE):
 *  - LOS JARDINES: JOELY y BENITA fuera del láser (cobran solo sus categorías).
 *  - VILLA OLGA: EIDYLEE y DAYHANA fuera del láser; DAYHANA productos a RD$50/u.
 *  - RAFAEL VIDAL: KARLA ACTIVA (el cuadro la paga); ASHLEY INACTIVA en RV
 *    (el cuadro de junio la paga en LOS JARDINES, no en RV).
 *  - RAFAEL VIDAL: alta de ISAURY (sin láser, productos RD$50/u) — aparece en
 *    ventas como prestadora de faciales/productos.
 */
const fs = require("fs"), path = require("path")
const env = path.join(__dirname, "../.env.local")
if (fs.existsSync(env)) for (const ln of fs.readFileSync(env, "utf8").split(/\r?\n/)) {
  const m = ln.match(/^([A-Z0-9_]+)=(.*)$/i)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "")
}
const { createClient } = require("@supabase/supabase-js")
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

;(async () => {
  const { data: biz } = await sb.from("businesses").select("id").eq("slug", "csl").single()
  const business_id = biz.id
  const upd = async (branch, name, patch, label) => {
    const { data, error } = await sb.from("sales_commission_collaborators")
      .update({ ...patch, updated_by: "align-excel-june", updated_at: new Date().toISOString() })
      .eq("business_id", business_id).eq("branch", branch).eq("name", name).is("deleted_at", null).select("id")
    console.log(`${error ? "✗" : data && data.length ? "✓" : "→ (no encontrado)"} ${branch} · ${name}: ${label}${error ? " — " + error.message : ""}`)
  }

  await upd("LOS JARDINES", "JOELY", { services: [] }, "fuera del láser (faciales/tatuajes)")
  await upd("LOS JARDINES", "BENITA", { services: [] }, "fuera del láser (faciales/masajes)")
  await upd("VILLA OLGA", "EIDYLEE", { services: [] }, "fuera del láser (faciales)")
  await upd("VILLA OLGA", "DAYHANA", { services: [], product_unit_amount: 50 }, "fuera del láser + productos RD$50/u")
  await upd("RAFAEL VIDAL", "KARLA", { active: true, notes: "Activada según cuadro oficial Junio (cobra láser lineal)" }, "ACTIVA (el cuadro la paga)")
  await upd("RAFAEL VIDAL", "ASHLEY", { active: false, notes: "Cuadro Junio: cobra láser en LOS JARDINES, no en RV. Reactivar si cambia." }, "INACTIVA en RV")

  // Alta de ISAURY (RV, sin láser, productos a RD$50/u) si no existe.
  const { data: isaury } = await sb.from("sales_commission_collaborators").select("id")
    .eq("business_id", business_id).eq("branch", "RAFAEL VIDAL").eq("name", "ISAURY").is("deleted_at", null).maybeSingle()
  if (isaury) {
    await upd("RAFAEL VIDAL", "ISAURY", { services: [], product_unit_amount: 50 }, "ya existía: sin láser + RD$50/u")
  } else {
    const { error } = await sb.from("sales_commission_collaborators").insert({
      business_id, branch: "RAFAEL VIDAL", name: "ISAURY", services: [],
      active: true, cleaning_contribution: 0, product_unit_amount: 50,
      notes: "Cuadro oficial: faciales/productos (50 P/P), sin láser, sin aporte limpieza",
      created_by: "align-excel-june",
    })
    console.log(`${error ? "✗" : "✓"} RAFAEL VIDAL · ISAURY: alta (sin láser, RD$50/u)${error ? " — " + error.message : ""}`)
  }

  // Verificación: elegibles láser por sucursal (deben ser RV=8, LJ=7, VO=4).
  const { data: all } = await sb.from("sales_commission_collaborators")
    .select("branch,name,active,services").eq("business_id", business_id).is("deleted_at", null)
  for (const b of ["RAFAEL VIDAL", "LOS JARDINES", "VILLA OLGA"]) {
    const el = (all || []).filter((c) => c.branch === b && c.active && (c.services || []).includes("DEPILACION_LASER"))
    console.log(`\n${b}: ${el.length} elegibles láser → ${el.map((c) => c.name).sort().join(", ")}`)
  }
})()
