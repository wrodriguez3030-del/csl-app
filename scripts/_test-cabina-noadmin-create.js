/**
 * TEST e2e — un usuario NO-admin puede crear una cabina vía /api/csl.
 *
 * Regresión del bug "Crear cabina no hace nada": el botón vive en el editor de
 * Equipos (accesible a encargados/recepción) pero saveMaintenanceCabin exigía
 * requireAdmin → el request fallaba en el servidor y el error quedaba oculto
 * tras el modal. Este test crea un usuario throwaway NO-admin, inicia sesión y
 * verifica que POST saveMaintenanceCabin crea la cabina (status ok). Limpia todo.
 *
 * Requiere el dev server corriendo. Uso:
 *   API_BASE=http://localhost:3099 node scripts/_test-cabina-noadmin-create.js
 *
 * Solo Supabase local (db-cls). NO toca datos existentes: usa un usuario y una
 * cabina con sufijo __TEST__ que borra al final.
 */
const fs = require("fs")
for (const ln of fs.readFileSync(require("path").join(__dirname, "../.env.local"), "utf8").split(/\r?\n/)) {
  const m = ln.match(/^([A-Z0-9_]+)=(.*)$/i)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "")
}
const SB = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const API_BASE = process.env.API_BASE || "http://localhost:3099"
const CSL_BIZ = "66b0cf3e-4cd7-4cfb-a7cf-0674b77fc4e6" // Cibao Spa Laser

if (/supabase\.co/.test(SB)) { console.error("✗ ABORT: la URL es Supabase Cloud, no self-hosted"); process.exit(1) }

const svc = { apikey: SERVICE, Authorization: "Bearer " + SERVICE, "Content-Type": "application/json" }
const stamp = String(process.hrtime.bigint()).slice(-8)
const email = `test.cabina.${stamp}@diag.local`
const password = `Diag!${stamp}xZ`
let userId = null, cabinId = null, pass = true
const ok = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) pass = false }

async function jf(url, opts) {
  const r = await fetch(url, opts)
  const t = await r.text()
  let b = null; try { b = t ? JSON.parse(t) : null } catch { b = t }
  return { status: r.status, ok: r.ok, body: b }
}

;(async () => {
  console.log("API_BASE:", API_BASE, "| Supabase:", new URL(SB).host)
  try {
    // 1) crear usuario auth throwaway
    const cu = await jf(`${SB}/auth/v1/admin/users`, {
      method: "POST", headers: svc,
      body: JSON.stringify({ email, password, email_confirm: true }),
    })
    userId = cu.body && cu.body.id
    ok(!!userId, `usuario auth throwaway creado (${userId ? userId.slice(0, 8) : cu.status + " " + JSON.stringify(cu.body).slice(0,120)})`)
    if (!userId) throw new Error("no se pudo crear el usuario auth")

    // 2) perfil NO-admin, tenant CSL, con acceso al menú equipos
    const cp = await jf(`${SB}/rest/v1/csl_user_profiles`, {
      method: "POST", headers: { ...svc, Prefer: "return=representation" },
      body: JSON.stringify({
        user_id: userId, nombre: "TEST NOADMIN __TEST__", username: email,
        is_admin: false, is_superadmin: false, activo: true,
        business_id: CSL_BIZ, menus: ["equipos", "pulse-mantenimiento"],
      }),
    })
    ok(cp.status === 201, `perfil NO-admin creado (is_admin=false, tenant CSL)`)

    // 3) login (password grant) → access_token de un NO-admin real
    const lg = await jf(`${SB}/auth/v1/token?grant_type=password`, {
      method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    })
    const token = lg.body && lg.body.access_token
    ok(!!token, "login NO-admin OK (access_token)")
    if (!token) throw new Error("login falló: " + JSON.stringify(lg.body).slice(0, 160))

    // 4) POST real a /api/csl — el caso EXACTO reportado
    const name = `COSMIATRIA 2 __TEST__ ${stamp}`
    const res = await jf(`${API_BASE}/api/csl`, {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "saveMaintenanceCabin",
        name, branch: "Los Jardines", active: "true", notes: "test e2e",
        activeBusinessId: CSL_BIZ,
      }),
    })
    console.log("  → respuesta API:", res.status, JSON.stringify(res.body).slice(0, 220))
    ok(res.status === 200 && res.body && res.body.ok === true, "API respondió ok:true (NO-admin pudo crear)")
    cabinId = res.body && res.body.record && res.body.record.id
    ok(!!cabinId, "la API devolvió el record de la cabina creada")
    if (res.body && res.body.record) {
      ok(res.body.record.business_id === CSL_BIZ, "business_id correcto (CSL, no cruzó a Depicenter)")
      ok(res.body.record.branch === "Los Jardines", "sucursal correcta (Los Jardines)")
      ok((res.body.record.name || "").startsWith("COSMIATRIA 2"), "nombre en MAYÚSCULA guardado")
      ok(res.body.record.active === true, "estado activo correcto")
    }

    // 5) confirmar que quedó persistida en la DB local
    if (cabinId) {
      const chk = await jf(`${SB}/rest/v1/maintenance_cabins?id=eq.${cabinId}&select=id,name,branch,business_id,active`, { headers: svc })
      ok(Array.isArray(chk.body) && chk.body.length === 1, "cabina persistida en Supabase local (verificada por id)")
    }

    // 6) doble clic no duplica: segundo POST idéntico → reused
    const res2 = await jf(`${API_BASE}/api/csl`, {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "saveMaintenanceCabin", name, branch: "Los Jardines", active: "true", activeBusinessId: CSL_BIZ }),
    })
    ok(res2.body && res2.body.ok === true && res2.body.reused === true, "segundo POST idéntico → reused (sin duplicar)")
  } catch (e) {
    ok(false, "excepción: " + e.message)
  } finally {
    // limpieza total (borra SOLO lo que este test creó)
    if (cabinId) await jf(`${SB}/rest/v1/maintenance_cabins?id=eq.${cabinId}`, { method: "DELETE", headers: svc })
    if (userId) {
      await jf(`${SB}/rest/v1/csl_user_profiles?user_id=eq.${userId}`, { method: "DELETE", headers: svc })
      await jf(`${SB}/auth/v1/admin/users/${userId}`, { method: "DELETE", headers: svc })
    }
    console.log(pass ? "\n✅ TEST PASA" : "\n❌ TEST FALLA")
    process.exit(pass ? 0 : 1)
  }
})()
