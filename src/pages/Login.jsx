import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Icon from '../components/Icon'
import { InlineAlert, Field, Spinner } from '../components/ui'
import { useToast } from '../components/Toast'
import { useAuth } from '../auth/AuthContext'
import { callAdminFn, getSetupStatus } from '../lib/api'
import { APP_NAME, COMPANY_EN, DEFAULT_COMPANY } from '../lib/constants'

export default function Login() {
  const { signIn, signUp, user } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()

  const [checking, setChecking] = useState(true)
  const [needsSetup, setNeedsSetup] = useState(false)
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [fullName, setFullName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [signupSent, setSignupSent] = useState(false)

  useEffect(() => {
    let alive = true
    getSetupStatus()
      .then((res) => {
        if (!alive) return
        setNeedsSetup(Boolean(res?.needs_setup))
        setMode(res?.needs_setup ? 'setup' : 'login')
      })
      .catch(() => {
        if (alive) setMode('login')
      })
      .finally(() => {
        if (alive) setChecking(false)
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (user) navigate('/dashboard', { replace: true })
  }, [user, navigate])

  const handleLogin = async (e) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await signIn(email, password)
      navigate('/dashboard', { replace: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const handleSignup = async (e) => {
    e.preventDefault()
    setError('')
    if (!fullName.trim()) return setError('이름을 입력해 주세요.')
    if (password.length < 6) return setError('비밀번호는 6자 이상이어야 합니다.')
    if (password !== confirm) return setError('비밀번호가 서로 다릅니다.')

    setBusy(true)
    try {
      const hasSession = await signUp(email, password, fullName)
      if (hasSession) {
        // 바로 로그인됨 → 비활성 직원이므로 승인 대기 화면으로 이동
        toast.info('가입되었습니다. 관리자 승인 후 사용할 수 있습니다.')
        navigate('/dashboard', { replace: true })
      } else {
        // 이메일 인증이 켜진 경우
        setSignupSent(true)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const switchMode = (next) => {
    setError('')
    setSignupSent(false)
    setMode(next)
  }

  const handleSetup = async (e) => {
    e.preventDefault()
    setError('')
    if (password.length < 6) return setError('비밀번호는 6자 이상이어야 합니다.')
    if (password !== confirm) return setError('비밀번호가 서로 다릅니다.')
    if (!fullName.trim()) return setError('이름을 입력해 주세요.')

    setBusy(true)
    try {
      await callAdminFn({ action: 'bootstrap', email, password, full_name: fullName })
      await signIn(email, password)
      toast.success('관리자 계정이 만들어졌습니다.')
      navigate('/dashboard', { replace: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen bg-ink-100">
      {/* 브랜드 패널 */}
      <div className="relative hidden w-[46%] flex-col justify-between overflow-hidden bg-ink-900 px-12 py-12 lg:flex">
        <div
          className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full opacity-30 blur-3xl"
          style={{ background: 'radial-gradient(circle, #3663f6 0%, transparent 70%)' }}
        />
        <div
          className="pointer-events-none absolute -bottom-32 -left-16 h-96 w-96 rounded-full opacity-20 blur-3xl"
          style={{ background: 'radial-gradient(circle, #0f9d58 0%, transparent 70%)' }}
        />

        <div className="relative flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-800 text-sm font-black text-white">
            BZ
          </span>
          <span className="leading-tight">
            <span className="block text-sm font-bold text-white">{DEFAULT_COMPANY}</span>
            <span className="block text-[11px] tracking-wide text-ink-400">{COMPANY_EN}</span>
          </span>
        </div>

        <div className="relative">
          <h1 className="text-3xl font-extrabold leading-snug text-white">
            회사의 숫자를
            <br />
            한 곳에서 봅니다.
          </h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-ink-400">
            매출 · 매입 · 운영비 · 프로젝트 손익 · 지출결의까지.
            <br />
            임원진은 요약을 보고, 담당자는 바로 입력합니다.
          </p>

          <ul className="mt-8 flex flex-col gap-3 text-sm text-ink-300">
            {['월별 손익 한눈에 보기', '프로젝트별 수익 자동 집계', '증빙 파일까지 함께 보관'].map((item) => (
              <li key={item} className="flex items-center gap-2.5">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/10 text-emerald-400">
                  <Icon name="check" size={12} strokeWidth={2.6} />
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-ink-500">
          © {new Date().getFullYear()} {DEFAULT_COMPANY}. 내부용 시스템.
        </p>
      </div>

      {/* 폼 패널 */}
      <div className="flex flex-1 items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-sm">
          <div className="mb-7 flex items-center gap-3 lg:hidden">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-800 text-xs font-black text-white">
              BZ
            </span>
            <span className="leading-tight">
              <span className="block text-sm font-bold text-ink-900">{DEFAULT_COMPANY}</span>
              <span className="block text-[11px] text-ink-500">{APP_NAME}</span>
            </span>
          </div>

          {checking ? (
            <div className="flex items-center gap-2.5 py-16 text-sm text-ink-500">
              <Spinner size={18} />
              확인 중…
            </div>
          ) : (
            <>
              <h2 className="text-xl font-extrabold tracking-tight text-ink-900">
                {mode === 'setup' ? '최초 관리자 계정 만들기' : mode === 'signup' ? '직원 가입' : '로그인'}
              </h2>
              <p className="mt-1.5 text-sm text-ink-500">
                {mode === 'setup'
                  ? '이 시스템을 관리할 첫 번째 계정입니다. 이후 직원 계정은 관리자가 추가합니다.'
                  : mode === 'signup'
                    ? '가입하면 직원 계정으로 등록되고, 관리자 승인 후 사용할 수 있습니다.'
                    : '등록된 계정으로 로그인해 주세요.'}
              </p>

              {mode === 'setup' ? (
                <div className="mt-4">
                  <InlineAlert tone="warn">
                    입력한 정보는 안전하게 저장됩니다. 비밀번호는 6자 이상으로 정해 주세요.
                    직원 계정은 로그인 화면에서 직접 가입하며, 승인 전까지 사용할 수 없습니다.
                  </InlineAlert>
                </div>
              ) : null}

              {signupSent ? (
                <div className="mt-4">
                  <InlineAlert tone="info">
                    가입 메일을 보냈습니다. 메일에서 인증을 완료한 뒤 로그인하면, 관리자 승인 대기 화면이
                    나타납니다. 승인되면 관리자가 알려줍니다.
                  </InlineAlert>
                </div>
              ) : null}

              <form
                className="mt-6 flex flex-col gap-4"
                onSubmit={mode === 'setup' ? handleSetup : mode === 'signup' ? handleSignup : handleLogin}
              >
                {mode !== 'login' ? (
                  <Field label="이름" required>
                    <input
                      className="input"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="예: 홍길동"
                      autoComplete="name"
                      required
                    />
                  </Field>
                ) : null}

                <Field label="이메일" required>
                  <input
                    type="email"
                    className="input"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@company.co.kr"
                    autoComplete="username"
                    required
                  />
                </Field>

                <Field label="비밀번호" required>
                  <input
                    type="password"
                    className="input"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete={mode === 'setup' ? 'new-password' : 'current-password'}
                    required
                  />
                </Field>

                {mode !== 'login' ? (
                  <Field label="비밀번호 확인" required>
                    <input
                      type="password"
                      className="input"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      placeholder="••••••••"
                      autoComplete="new-password"
                      required
                    />
                  </Field>
                ) : null}

                {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}

                <button type="submit" className="btn-primary mt-1 py-3" disabled={busy}>
                  {busy ? <Spinner size={16} /> : <Icon name="lock" size={16} />}
                  {busy ? '처리 중…' : mode === 'setup' ? '계정 만들기' : mode === 'signup' ? '가입하기' : '로그인'}
                </button>
              </form>

              {mode === 'login' ? (
                <button
                  type="button"
                  onClick={() => switchMode('signup')}
                  className="mt-4 w-full text-center text-xs font-medium text-ink-500 transition hover:text-ink-800"
                >
                  계정이 없으신가요? 직원 가입하기
                </button>
              ) : null}

              {mode === 'signup' ? (
                <button
                  type="button"
                  onClick={() => switchMode('login')}
                  className="mt-4 w-full text-center text-xs font-medium text-ink-500 transition hover:text-ink-800"
                >
                  이미 계정이 있습니다 → 로그인
                </button>
              ) : null}

              {mode === 'setup' ? (
                <button
                  type="button"
                  onClick={() => {
                    switchMode('login')
                  }}
                  className="mt-4 w-full text-center text-xs font-medium text-ink-500 transition hover:text-ink-800"
                >
                  이미 계정이 있습니다 → 로그인
                </button>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
