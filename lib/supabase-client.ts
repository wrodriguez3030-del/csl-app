"use client"

import { createClient } from "@supabase/supabase-js"

const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim()
const supabaseAnonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim()

export const supabaseBrowser = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})
