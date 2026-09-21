import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Icon from '../components/Icon'
import { InlineAlert, Field, Spinner } from '../components/ui'
import { useToast } from '../components/Toast'
import { useAuth } from '../auth/AuthContext'
import { callAdminFn, getSetupStatus } from '../lib/api'
import { APP_NAME, COMPANY_EN, DEFAULT_COMPANY } from '../lib/constants'

export default function Login() {
  const { signIn, user } = useAuth()
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
                {mode === 'setup' ? '최초 관리자 계정 만들기' : '로그인'}
              </h2>
              <p className="mt-1.5 text-sm text-ink-500">
                {mode === 'setup'
                  ? '이 시스템을 관리할 첫 번째 계정입니다. 이후 직원 계정은 관리자가 추가합니다.'
                  : '등록된 계정으로 로그인해 주세요.'}
              </p>

              {mode === 'setup' ? (
                <div className="mt-4">
                  <InlineAlert tone="warn">
                    입력한 정보는 안전하게 저장됩니다. 비밀번호는 6자 이상으로 정해 주세요.
                  </InlineAlert>
                </div>
              ) : null}

              <form
                className="mt-6 flex flex-col gap-4"
                onSubmit={mode === 'setup' ? handleSetup : handleLogin}
              >
                {mode === 'setup' ? (
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

                {mode === 'setup' ? (
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
                  {busy ? '처리 중…' : mode === 'setup' ? '계정 만들기' : '로그인'}
                </button>
              </form>

              {mode === 'setup' ? (
                <button
                  type="button"
                  onClick={() => {
                    setError('')
                    setMode('login')
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
