/** Comprueba que la puerta niega Y que deja rastro. No toca datos de nadie. */
import { readFileSync } from "node:fs"
for (const l of readFileSync(".env.local", "utf8").split("\n")) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim()
}
const { runWithBusinessContext } = await import("../lib/server/business-context.ts")
const { enforceActionPermission, modoEstricto } = await import("../lib/server/permission-gate.ts")

const usuario = { id: "00000000-0000-0000-0000-000000000000", email: "prueba-puerta@local", ip: "127.0.0.1", userAgent: "prueba-puerta" }
const sinPermisos = { businessId: "66b0cf3e-4cd7-4cfb-a7cf-0674b77fc4e6", isAdmin: false, isSuperadmin: false, permissions: [] }
const admin = { ...sinPermisos, isAdmin: true }

console.log("modo:", modoEstricto() ? "estricto" : "sombra")
await runWithBusinessContext(sinPermisos, async () => {
  await enforceActionPermission("createHrPayrollRun", usuario)
  await enforceActionPermission("getRowsPaged", usuario, "credenciales")
  await enforceActionPermission("accionQueNoExiste", usuario)
})
await runWithBusinessContext(admin, async () => {
  await enforceActionPermission("saveHrLoan", usuario)   // caja fuerte: is_admin NO pasa
  await enforceActionPermission("saveEquipo", usuario)   // corriente: is_admin sí pasa
})
console.log("ejecutado")
