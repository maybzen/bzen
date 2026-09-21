import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { getProfile } from '../lib/api'

const AuthContext = createContext(null)

export function useAuth() {
  return useContext(AuthContext)
}

function translateAuthError(message) {
  const m = String(message || '')
  if (/invalid login credentials/i.test(m)) return '이메일 또는 비밀번호가 올바르지 않습니다.'
  if (/email not confirmed/i.test(m)) return '이메일 인증이 완료되지 않았습니다.'
  if (/rate limit|too many/i.test(m)) return '시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.'
  if (/user already registered/i.test(m)) return '이미 등록된 이메일입니다.'
  if (/password should be at least/i.test(m)) return '비밀번호가 너무 짧습니다.'
  if (/invalid email/i.test(m)) return '이메일 형식이 올바르지 않습니다.'
  return m || '로그인에 실패했습니다.'
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  const loadProfile = useCallback(async (user) => {
    if (!user) {
      setProfile(null)
      return null
    }
    try {
      const data = await getProfile(user.id)
      if (data) {
        setProfile(data)
        return data
      }
      setProfile({
        id: user.id,
        email: user.email,
        full_name: '',
        role: 'staff',
        department: '',
        phone: '',
        active: false,
      })
      return null
    } catch {
      setProfile({
        id: user.id,
        email: user.email,
        full_name: '',
        role: 'staff',
        department: '',
        phone: '',
        active: false,
      })
      return null
    }
  }, [])

  useEffect(() => {
    let mounted = true

    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return
      setSession(data.session ?? null)
      if (data.session?.user) await loadProfile(data.session.user)
      if (mounted) setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, next) => {
      if (!mounted) return
      setSession(next ?? null)
      if (next?.user) await loadProfile(next.user)
      else setProfile(null)
    })

    return () => {
      mounted = false
      sub?.subscription?.unsubscribe()
    }
  }, [loadProfile])

  const signIn = useCallback(async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({
      email: String(email || '').trim(),
      password: String(password || ''),
    })
    if (error) throw new Error(translateAuthError(error.message))
    return true
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setProfile(null)
    setSession(null)
  }, [])

  const refreshProfile = useCallback(async () => {
    const {
      data: { session: current },
    } = await supabase.auth.getSession()
    if (current?.user) return loadProfile(current.user)
    return null
  }, [loadProfile])

  const value = useMemo(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      loading,
      isAdmin: profile?.role === 'admin' && profile?.active === true,
      isActive: profile?.active === true,
      displayName: profile?.full_name || profile?.email || '',
      signIn,
      signOut,
      refreshProfile,
      setProfile,
    }),
    [session, profile, loading, signIn, signOut, refreshProfile],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
