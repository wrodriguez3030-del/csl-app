/**
 * Setup TOTP secret + QR para el menú Credenciales del sistema CSL.
 *
 *  - Genera un secret base32 fresco (20 bytes / 160 bits).
 *  - Lo guarda en C:\csl-app-datos-privados\CREDENTIALS_TOTP_SECRET.txt
 *    (fuera del repo, fuera de OneDrive).
 *  - Genera un QR PNG en
 *    C:\csl-app-datos-privados\credentials-authenticator-qr.png
 *    con formato otpauth://totp listo para escanear con Google/Microsoft
 *    Authenticator, Authy, 1Password.
 *  - Actualiza .env.local del proyecto (sustituye la línea si ya existe).
 *  - NO imprime el secret completo en stdout. Solo prefix + longitud.
 *  - NO toca Vercel — ese paso lo dispara otro comando aparte.
 *
 * Uso:
 *   node scripts/setup-credentials-totp.js
 */

const fs = require("fs")
const path = require("path")
const crypto = require("crypto")
const QRCode = require("qrcode")

const PRIVATE_DIR = "C:\\csl-app-datos-privados"
const SECRET_PATH = path.join(PRIVATE_DIR, "CREDENTIALS_TOTP_SECRET.txt")
const QR_PATH = path.join(PRIVATE_DIR, "credentials-authenticator-qr.png")
const ENV_LOCAL = "C:\\csl-app\\.env.local"

const ISSUER = "CSL App"
const LABEL = "Credenciales CSL"

function base32(buf) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
  let bits = "", out = ""
  for (const b of buf) bits += b.toString(2).padStart(8, "0")
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5)
    if (chunk.length === 5) out += alphabet[parseInt(chunk, 2)]
  }
  return out
}

function maskSecret(s) {
  if (!s || s.length < 8) return "****"
  return s.slice(0, 3) + "*".repeat(s.length - 6) + s.slice(-3)
}

async function main() {
  const secret = base32(crypto.randomBytes(20))

  fs.mkdirSync(PRIVATE_DIR, { recursive: true })

  // Secret en archivo separado, sin contenido extra (para pipe a vercel env add).
  fs.writeFileSync(SECRET_PATH, secret, { mode: 0o600 })

  // otpauth URI estándar (issuer + label, algorithm SHA1 default, 6 dígitos, periodo 30s).
  const issuerEnc = encodeURIComponent(ISSUER)
  const labelEnc = encodeURIComponent(LABEL)
  const uri =
    `otpauth://totp/${issuerEnc}:${labelEnc}` +
    `?secret=${secret}&issuer=${issuerEnc}&algorithm=SHA1&digits=6&period=30`

  await QRCode.toFile(QR_PATH, uri, {
    width: 480,
    margin: 2,
    errorCorrectionLevel: "M",
    color: { dark: "#0B3442", light: "#FFFFFF" },
  })

  // Update .env.local sin tocar otros vars.
  let envContent = ""
  if (fs.existsSync(ENV_LOCAL)) envContent = fs.readFileSync(ENV_LOCAL, "utf8")
  const line = `CREDENTIALS_TOTP_SECRET=${secret}`
  if (/^CREDENTIALS_TOTP_SECRET=.*$/m.test(envContent)) {
    envContent = envContent.replace(/^CREDENTIALS_TOTP_SECRET=.*$/m, line)
  } else {
    if (envContent && !envContent.endsWith("\n")) envContent += "\n"
    envContent += line + "\n"
  }
  fs.writeFileSync(ENV_LOCAL, envContent)

  // Output (sin secret completo)
  console.log("Secret generated   :", maskSecret(secret), "(length=" + secret.length + ")")
  console.log("Secret file        :", SECRET_PATH, "(mode 0600)")
  console.log("QR PNG             :", QR_PATH, "(480px, otpauth issuer=" + ISSUER + ")")
  console.log(".env.local         : updated (CREDENTIALS_TOTP_SECRET line replaced or appended)")
  console.log("Vercel Production  : NOT modified by this script — siguiente paso manual o CLI")
}

main().catch((err) => {
  console.error("ERROR:", err.message)
  process.exit(1)
})
