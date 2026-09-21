import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  // 배포 시 .env.production 값을 확인하세요.
  console.error(
    '[BZen] Supabase 설정이 없습니다. VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 를 확인해 주세요.',
  )
}

export const FUNCTIONS_URL = `${url || ''}/functions/v1`
export const SUPABASE_ANON_KEY = anonKey

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
})

export default supabase
