// Valida /api/public/punch end-to-end contra producción con fixtures de prueba.
// Crea device + QR temporales (ZZZ_TEST), prueba resolve/punch/errores y LIMPIA.
const fs = require("fs"), crypto = require("crypto")
for (const ln of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) { const m = ln.match(/^([A-Z0-9_]+)=(.*)$/i); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "") }
const U = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim(), K = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim()
const H = { apikey: K, Authorization: `Bearer ${K}`, "Content-Type": "application/json" }
const APP = "https://csl-app-eta.vercel.app"
const sha = v => crypto.createHash("sha256").update(v, "utf8").digest("hex")
const get = async p => (await fetch(U + p, { headers: H })).json()
const post = (p, b, prefer = "return=representation") => fetch(U + p, { method: "POST", headers: { ...H, Prefer: prefer }, body: JSON.stringify(b) })
const del = p => fetch(U + p, { method: "DELETE", headers: H })
const kiosk = async b => { const r = await fetch(APP + "/api/public/punch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }); return { http: r.status, body: await r.json() } }

;(async () => {
  const biz = (await get("/rest/v1/businesses?select=id,slug")).find(b => b.slug === "csl")
  const DTOK = "CSLDEV:test_" + crypto.randomBytes(8).toString("hex")
  const QTOK = "CSLQR:test_" + crypto.randomBytes(8).toString("hex")
  // fixtures
  const dRes = await (await post("/rest/v1/hr_punch_devices", { business_id: biz.id, sucursal: "ZZZ_TEST_KIOSK", device_name: "TEST", device_token_hash: sha(DTOK), active: true })).json()
  await (await post("/rest/v1/hr_employee_qr_tokens", { business_id: biz.id, employee_id: "ZZZ_TEST_EMP", token: QTOK, token_hash: sha(QTOK), active: true })).json()
  const devId = dRes[0]?.id
  try {
    console.log("1) resolve OK:        ", JSON.stringify(await kiosk({ mode: "resolve", device_token: DTOK, qr_token: QTOK })))
    console.log("2) sin device:        ", JSON.stringify(await kiosk({ mode: "resolve", device_token: "", qr_token: QTOK })))
    console.log("3) device invalido:   ", JSON.stringify(await kiosk({ mode: "resolve", device_token: "CSLDEV:nope", qr_token: QTOK })))
    console.log("4) qr invalido:       ", JSON.stringify(await kiosk({ mode: "resolve", device_token: DTOK, qr_token: "CSLQR:nope" })))
    console.log("5) punch entrada:     ", JSON.stringify(await kiosk({ mode: "punch", device_token: DTOK, qr_token: QTOK, punch_type: "entrada" })))
    console.log("6) entrada duplicada: ", JSON.stringify(await kiosk({ mode: "punch", device_token: DTOK, qr_token: QTOK, punch_type: "entrada" })))
  } finally {
    // LIMPIEZA de fixtures de prueba (solo lo que este script creó)
    await del(`/rest/v1/hr_punches?business_id=eq.${biz.id}&employee_id=eq.ZZZ_TEST_EMP`)
    await del(`/rest/v1/hr_employee_qr_tokens?business_id=eq.${biz.id}&employee_id=eq.ZZZ_TEST_EMP`)
    if (devId) await del(`/rest/v1/hr_punch_devices?id=eq.${devId}`)
    console.log("\nFixtures de prueba eliminados (device/qr/punches ZZZ_TEST).")
  }
})().catch(e => { console.error("ERROR:", e.message); process.exit(1) })
