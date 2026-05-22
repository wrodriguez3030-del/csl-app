import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { CREDENTIALS_ACCESS_COOKIE } from "@/lib/credentials-access"

export const runtime = "nodejs"

export async function POST() {
  const jar = await cookies()
  jar.delete(CREDENTIALS_ACCESS_COOKIE)
  return NextResponse.json({ ok: true })
}
