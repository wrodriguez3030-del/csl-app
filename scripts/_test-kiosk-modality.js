/**
 * Prueba e2e del enforcement de hr_punch_modality_config en el kiosko QR
 * (/api/public/punch) contra server local + db-cls.
 *
 * Crea dispositivo + QR + empleado sintéticos en una sucursal de prueba SIN
 * geocerca, y verifica:
 *   1. Config por defecto (global allow_qr=t) → ponche entrada aprobado con modality="qr".
 *   2. Config por EMPLEADO con allow_qr=false → modality_off (no registra).
 *   3. allow_qr=true pero allow_kiosk=false → modality_off.
 *   4. Config inactiva (active=false) → vuelve a funcionar (cae al global).
 * Limpia todo al final.
 *
 * Uso: node scripts/_test-kiosk-modality.js [baseUrl]  (default http://localhost:3971)
 */
const fs = require("fs"), path = require("path"), crypto = require("crypto")
const env = path.join(__dirname, "../.env.local")
if (fs.existsSync(env)) for (const ln of fs.readFileSync(env, "utf8").split(/\r?\n/)) {
  const m = ln.match(/^([A-Z0-9_]+)=(.*)$/i)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "")
}
const URL_ = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim()
const SRK = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim()
const BASE = process.argv[2] || "http://localhost:3971"
const H = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json", Prefer: "return=representation" }
const CSL = "66b0cf3e-4cd7-4cfb-a7cf-0674b77fc4e6"
const sha = (v) => crypto.createHash("sha256").update(v, "utf8").digest("hex")

const rest = async (method, p, body) => {
  const r = await fetch(URL_ + p, { method, headers: H, body: body ? JSON.stringify(body) : undefined })
  const txt = await r.text()
  if (!r.ok) throw new Error(`${method} ${p}: ${r.status} ${txt}`)
  return txt ? JSON.parse(txt) : null
}
const punch = async (deviceToken, qrToken, punchType) =>
  fetch(`${BASE}/api/public/punch`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "punch", device_token: deviceToken, qr_token: qrToken, punch_type: punchType }),
  }).then(r => r.json())

let pass = 0, fail = 0
const check = (name, ok, extra = "") => { if (ok) { pass++; console.log(`  PASS  ${name}`) } else { fail++; console.log(`  FAIL  ${name} ${extra}`) } }

;(async () => {
  const SUC = "TEST SUC KIOSKO"
  const EMP = `TEST-EMP-KIOSK-${Date.now()}`
  const devToken = crypto.randomUUID()
  const qrToken = crypto.randomUUID()
  let devId = null, cfgId = null
  try {
    const [dev] = await rest("POST", "/rest/v1/hr_punch_devices", {
      business_id: CSL, sucursal: SUC, device_token_hash: sha(devToken), active: true, device_name: "TEST KIOSK (borrar)",
    })
    devId = dev.id
    await rest("POST", "/rest/v1/hr_employee_qr_tokens", {
      business_id: CSL, employee_id: EMP, token: qrToken, token_hash: sha(qrToken), active: true,
    })

    // 1) Config global default (allow_qr=t) → aprobado
    const p1 = await punch(devToken, qrToken, "entrada")
    check("default: entrada aprobada por kiosko", p1?.ok === true && p1?.status === "approved", JSON.stringify(p1))
    const [row1] = await rest("GET", `/rest/v1/hr_punches?business_id=eq.${CSL}&employee_id=eq.${EMP}&select=modality,source,status&order=punched_at.desc&limit=1`)
    check("registro: modality='qr' y source='qr_kiosk'", row1?.modality === "qr" && row1?.source === "qr_kiosk", JSON.stringify(row1))

    // 2) Config por empleado con allow_qr=false → modality_off
    const [cfg] = await rest("POST", "/rest/v1/hr_punch_modality_config", {
      business_id: CSL, employee_id: EMP, allow_qr: false, allow_kiosk: true, active: true,
    })
    cfgId = cfg.id
    const p2 = await punch(devToken, qrToken, "salida")
    check("allow_qr=false: kiosko bloqueado (modality_off)", p2?.ok !== true && p2?.code === "modality_off", JSON.stringify(p2))

    // 3) allow_qr=true, allow_kiosk=false → modality_off
    await rest("PATCH", `/rest/v1/hr_punch_modality_config?id=eq.${cfgId}`, { allow_qr: true, allow_kiosk: false })
    const p3 = await punch(devToken, qrToken, "salida")
    check("allow_kiosk=false: kiosko bloqueado (modality_off)", p3?.ok !== true && p3?.code === "modality_off", JSON.stringify(p3))

    // 4) Config desactivada → cae al global y vuelve a funcionar
    await rest("PATCH", `/rest/v1/hr_punch_modality_config?id=eq.${cfgId}`, { active: false })
    const p4 = await punch(devToken, qrToken, "salida")
    check("config inactiva: vuelve al global y aprueba salida", p4?.ok === true && p4?.status === "approved", JSON.stringify(p4))

    console.log(`\nRESULTADO: ${pass} PASS, ${fail} FAIL`)
    process.exitCode = fail ? 1 : 0
  } finally {
    await rest("DELETE", `/rest/v1/hr_punches?business_id=eq.${CSL}&employee_id=eq.${EMP}`).catch(() => {})
    if (cfgId) await rest("DELETE", `/rest/v1/hr_punch_modality_config?id=eq.${cfgId}`).catch(() => {})
    await rest("DELETE", `/rest/v1/hr_employee_qr_tokens?business_id=eq.${CSL}&employee_id=eq.${EMP}`).catch(() => {})
    if (devId) await rest("DELETE", `/rest/v1/hr_punch_devices?id=eq.${devId}`).catch(() => {})
    await rest("DELETE", `/rest/v1/hr_audit_logs?business_id=eq.${CSL}&entity_id=eq.${EMP}`).catch(() => {})
    console.log("Limpieza de datos de prueba completada.")
  }
})().catch(e => { console.error("ERROR:", e.message); process.exit(1) })
