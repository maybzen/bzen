import { useEffect, useState } from 'react'
import Icon from './Icon'
import { Field, InlineAlert, Modal, Spinner } from './ui'
import { useToast } from './Toast'
import {
  PARTNER_DOC_TYPES,
  createPartner,
  deletePartnerDoc,
  getPartnerDocUrl,
  listPartnerDocs,
  updatePartner,
  uploadPartnerDoc,
} from '../lib/api'
import { formatDateTime, formatFileSize } from '../lib/format'

const EMPTY = {
  name: '',
  contact_person: '',
  job_title: '',
  email: '',
  phone_main: '',
  phone: '',
  memo: '',
}

const DOC_ORDER = ['biz', 'bank', 'other']

function isImage(mime, name) {
  if (mime && mime.startsWith('image/')) return true
  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name || '')
}

function isPdf(mime, name) {
  if (mime === 'application/pdf') return true
  return /\.pdf$/i.test(name || '')
}

function DocPreview({ doc }) {
  const [url, setUrl] = useState('')
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const toast = useToast()

  // 드라이브 연결 서류: 외부 링크로 열기 (드라이브는 인라인 미리보기 차단)
  if (doc.external_url) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-ink-200 px-3 py-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ink-100 text-ink-500">
          <Icon name={isImage(doc.mime_type, doc.file_name) ? 'image' : 'file'} size={17} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-ink-800">{doc.file_name}</span>
          <span className="mt-0.5 block text-xs text-ink-500">
            <span className="chip bg-ink-100 text-ink-600">드라이브 연결</span>
          </span>
        </span>
        <button
          type="button"
          onClick={() => window.open(doc.external_url, '_blank', 'noopener')}
          className="btn-ghost px-2.5 py-1.5 text-xs"
        >
          <Icon name="download" size={14} />
          열기
        </button>
      </div>
    )
  }

  const ensureUrl = async () => {
    if (url) return url
    setLoading(true)
    try {
      const signed = await getPartnerDocUrl(doc.file_path)
      setUrl(signed)
      return signed
    } catch (e) {
      toast.error(e.message)
      return ''
    } finally {
      setLoading(false)
    }
  }

  const toggle = async () => {
    if (open) {
      setOpen(false)
      return
    }
    const signed = await ensureUrl()
    if (signed) setOpen(true)
  }

  const openTab = async () => {
    const signed = await ensureUrl()
    if (signed) window.open(signed, '_blank', 'noopener')
  }

  return (
    <div className="rounded-lg border border-ink-200">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ink-100 text-ink-500">
          <Icon name={isImage(doc.mime_type, doc.file_name) ? 'image' : 'file'} size={17} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-ink-800">{doc.file_name}</span>
          <span className="block text-xs text-ink-500">
            {formatFileSize(doc.size_bytes)} · {formatDateTime(doc.created_at)}
          </span>
        </span>
        <button
          type="button"
          onClick={toggle}
          className="btn-ghost px-2.5 py-1.5 text-xs"
          disabled={loading}
        >
          {loading ? <Spinner size={13} /> : <Icon name="image" size={14} />}
          {open ? '닫기' : '보기'}
        </button>
        <button type="button" onClick={openTab} className="btn-ghost px-2.5 py-1.5 text-xs" disabled={loading}>
          <Icon name="download" size={14} />
          열기
        </button>
      </div>
      {open && url ? (
        <div className="border-t border-ink-100 bg-ink-50/60 p-3">
          {isImage(doc.mime_type, doc.file_name) ? (
            <img src={url} alt={doc.file_name} className="mx-auto max-h-96 rounded-lg border border-ink-200" />
          ) : isPdf(doc.mime_type, doc.file_name) ? (
            <iframe title={doc.file_name} src={url} className="h-96 w-full rounded-lg border border-ink-200 bg-white" />
          ) : (
            <p className="py-4 text-center text-xs text-ink-500">
              이 형식은 미리보기를 지원하지 않습니다. 열기 버튼으로 확인해 주세요.
            </p>
          )}
        </div>
      ) : null}
    </div>
  )
}

export default function PartnerFormModal({ open, onClose, onSaved, initial, readOnly = false, userId }) {
  const toast = useToast()
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [docs, setDocs] = useState([])
  const [docsLoading, setDocsLoading] = useState(false)
  const [uploading, setUploading] = useState('')

  const partnerId = initial?.id || null

  useEffect(() => {
    if (!open) return
    setError('')
    if (initial) {
      setForm({
        name: initial.name || '',
        contact_person: initial.contact_person || '',
        job_title: initial.job_title || '',
        email: initial.email || '',
        phone_main: initial.phone_main || '',
        phone: initial.phone || '',
        memo: initial.memo || '',
      })
    } else {
      setForm(EMPTY)
    }
  }, [open, initial])

  useEffect(() => {
    if (!open || !partnerId) {
      setDocs([])
      return
    }
    setDocsLoading(true)
    listPartnerDocs([partnerId])
      .then((rows) => setDocs(rows || []))
      .catch((e) => toast.error(e.message))
      .finally(() => setDocsLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, partnerId])

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) return setError('거래처명을 입력해 주세요.')

    setSaving(true)
    setError('')
    try {
      const payload = {
        name: form.name.trim(),
        contact_person: form.contact_person.trim(),
        job_title: form.job_title.trim(),
        email: form.email.trim(),
        phone_main: form.phone_main.trim(),
        phone: form.phone.trim(),
        memo: form.memo.trim(),
      }
      if (partnerId) {
        await updatePartner(partnerId, payload)
        toast.success('거래처가 수정되었습니다.')
      } else {
        await createPartner({ ...payload, created_by: userId })
        toast.success('거래처가 등록되었습니다.')
      }
      onSaved?.()
      onClose?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleUpload = async (docType, file) => {
    if (!file || !partnerId) return
    setUploading(docType)
    try {
      const saved = await uploadPartnerDoc(partnerId, docType, file, userId)
      setDocs((d) => [...d, saved])
      toast.success('서류가 등록되었습니다.')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setUploading('')
    }
  }

  const handleDeleteDoc = async (doc) => {
    if (!window.confirm(`"${doc.file_name}" 서류를 삭제하시겠습니까?`)) return
    try {
      await deletePartnerDoc(doc)
      setDocs((d) => d.filter((x) => x.id !== doc.id))
      toast.success('서류가 삭제되었습니다.')
    } catch (err) {
      toast.error(err.message)
    }
  }

  const docsByType = (type) => docs.filter((d) => (d.doc_type || 'other') === type)

  return (
    <Modal
      open={open}
      onClose={saving || uploading ? undefined : onClose}
      title={readOnly ? '거래처 상세' : partnerId ? '거래처 수정' : '거래처 등록'}
      subtitle="담당자 정보와 사업자등록증·통장사본을 함께 관리합니다."
      size="lg"
      footer={
        readOnly ? (
          <button type="button" className="btn-ghost" onClick={onClose}>
            닫기
          </button>
        ) : (
          <>
            <button type="button" className="btn-ghost" onClick={onClose} disabled={saving}>
              취소
            </button>
            <button type="submit" form="partner-form" className="btn-primary" disabled={saving}>
              {saving ? <Spinner size={15} /> : null}
              {saving ? '저장 중…' : '저장'}
            </button>
          </>
        )
      }
    >
      <form id="partner-form" onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {error ? (
          <div className="sm:col-span-2">
            <InlineAlert tone="error">{error}</InlineAlert>
          </div>
        ) : null}

        <Field label="거래처명" required className="sm:col-span-2">
          <input
            className="input"
            value={form.name}
            onChange={set('name')}
            placeholder="예: ○○ 주식회사"
            disabled={readOnly}
          />
        </Field>

        <Field label="담당자">
          <input
            className="input"
            value={form.contact_person}
            onChange={set('contact_person')}
            placeholder="예: 김비젠"
            disabled={readOnly}
          />
        </Field>

        <Field label="직함">
          <input
            className="input"
            value={form.job_title}
            onChange={set('job_title')}
            placeholder="예: 경리 과장"
            disabled={readOnly}
          />
        </Field>

        <Field label="이메일">
          <input
            type="email"
            className="input"
            value={form.email}
            onChange={set('email')}
            placeholder="예: acct@example.com"
            disabled={readOnly}
          />
        </Field>

        <Field label="대표번호">
          <input
            className="input"
            value={form.phone_main}
            onChange={set('phone_main')}
            placeholder="예: 02-0000-0000"
            disabled={readOnly}
          />
        </Field>

        <Field label="전화번호" className="sm:col-span-2">
          <input
            className="input"
            value={form.phone}
            onChange={set('phone')}
            placeholder="예: 010-0000-0000"
            disabled={readOnly}
          />
        </Field>

        <Field label="메모" className="sm:col-span-2">
          <textarea
            className="input min-h-[64px] resize-y"
            value={form.memo}
            onChange={set('memo')}
            disabled={readOnly}
          />
        </Field>
      </form>

      {/* 서류 */}
      <div className="mt-5 border-t border-ink-100 pt-4">
        <h3 className="text-sm font-bold text-ink-900">서류</h3>
        <p className="mt-0.5 text-xs text-ink-500">
          직접 올린 서류는 다운로드 없이 바로 미리볼 수 있고, 드라이브 연결 서류는 열기로 확인합니다.
        </p>

        {!partnerId ? (
          <InlineAlert tone="info">
            기본 정보를 먼저 저장하면 서류를 등록할 수 있습니다.
          </InlineAlert>
        ) : docsLoading ? (
          <p className="py-4 text-center text-xs text-ink-400">서류를 불러오는 중…</p>
        ) : (
          <div className="mt-3 flex flex-col gap-4">
            {DOC_ORDER.map((type) => (
              <section key={type}>
                <div className="mb-1.5 flex items-center justify-between">
                  <h4 className="text-xs font-bold text-ink-700">{PARTNER_DOC_TYPES[type]}</h4>
                  {!readOnly ? (
                    <label className="btn-ghost cursor-pointer px-2.5 py-1.5 text-xs">
                      {uploading === type ? <Spinner size={13} /> : <Icon name="upload" size={14} />}
                      올리기
                      <input
                        type="file"
                        accept="image/*,.pdf"
                        className="hidden"
                        disabled={Boolean(uploading)}
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          e.target.value = ''
                          if (file) handleUpload(type, file)
                        }}
                      />
                    </label>
                  ) : null}
                </div>
                {docsByType(type).length ? (
                  <div className="flex flex-col gap-2">
                    {docsByType(type).map((doc) => (
                      <div key={doc.id} className="flex flex-col gap-2">
                        <DocPreview doc={doc} />
                        {!readOnly ? (
                          <button
                            type="button"
                            onClick={() => handleDeleteDoc(doc)}
                            className="self-end text-xs font-semibold text-loss hover:underline"
                          >
                            서류 삭제
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="rounded-lg bg-ink-50 px-3 py-2.5 text-xs text-ink-400">
                    등록된 {PARTNER_DOC_TYPES[type]}이(가) 없습니다.
                  </p>
                )}
              </section>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}
