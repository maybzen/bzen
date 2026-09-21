import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import Icon from './Icon'

const ToastContext = createContext(null)

export function useToast() {
  return useContext(ToastContext)
}

const STYLES = {
  success: { bar: 'bg-gain', icon: 'check', iconBg: 'bg-emerald-50 text-emerald-600' },
  error: { bar: 'bg-loss', icon: 'alert', iconBg: 'bg-rose-50 text-rose-600' },
  info: { bar: 'bg-brand-500', icon: 'info', iconBg: 'bg-brand-50 text-brand-600' },
}

export function ToastProvider({ children }) {
  const [items, setItems] = useState([])

  const remove = useCallback((id) => {
    setItems((prev) => prev.filter((i) => i.id !== id))
  }, [])

  const push = useCallback(
    (message, type = 'info') => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      setItems((prev) => [...prev.slice(-4), { id, message: String(message), type }])
      window.setTimeout(() => remove(id), 4200)
    },
    [remove],
  )

  const value = useMemo(
    () => ({
      toast: push,
      success: (m) => push(m, 'success'),
      error: (m) => push(m, 'error'),
      info: (m) => push(m, 'info'),
    }),
    [push],
  )

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[80] flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:right-6 sm:left-auto sm:items-end">
        {items.map((item) => {
          const style = STYLES[item.type] || STYLES.info
          return (
            <div
              key={item.id}
              className="pointer-events-auto flex w-full max-w-sm animate-fade-in items-start gap-3 overflow-hidden rounded-xl border border-ink-200 bg-white p-3.5 shadow-pop"
            >
              <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${style.iconBg}`}>
                <Icon name={style.icon} size={16} strokeWidth={2} />
              </span>
              <p className="flex-1 whitespace-pre-line pt-0.5 text-sm leading-relaxed text-ink-800">
                {item.message}
              </p>
              <button
                type="button"
                onClick={() => remove(item.id)}
                className="rounded-md p-1 text-ink-400 transition hover:bg-ink-100 hover:text-ink-700"
                aria-label="닫기"
              >
                <Icon name="close" size={15} />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}
