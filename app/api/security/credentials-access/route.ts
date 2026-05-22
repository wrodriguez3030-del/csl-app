import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import {
  CREDENTIALS_ACCESS_COOKIE,
  verifyAccessCookieValue,
} from "@/lib/credentials-access"

export const runtime = "nodejs"
// No cachear nunca — la expiración cambia segundo a segundo.
export const dynamic = "force-dynamic"

export async function GET() {
  const jar = await cookies()
  const cookieValue = jar.get(CREDENTIALS_ACCESS_COOKIE)?.value
  const { active, expiresAt } = verifyAccessCookieValue(cookieValue)
  return NextResponse.json(
    { active, expiresAt: active ? expiresAt : undefined },
    {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    },
  )
}
