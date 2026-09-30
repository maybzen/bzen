import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from './Icon'
import { Field, InlineAlert, Modal, Spinner } from './ui'
import { useToast } from './Toast'
import { ENTRY_META, PARTNER_GROUPS, suggestPartnerGroup } from '../lib/constants'
import {
  PARTNER_DOC_TYPES,
  contactsTableExists,
  createPartner,
  createPartnerContact,
  deletePartnerContact,
  deletePartnerDoc,
  getPartnerDocUrl,
  linkExternalDoc,
  listPartnerContacts,
  listPartnerDocs,
  updatePartner,
  updatePartnerContact,
  uploadPartnerDoc,
} from '../lib/api'
import { formatDateHuman, formatDateTime, formatFileSize, formatKRW, normalizeVendorName } from '../lib/format'
import { isStaffVisible, staffIdsFromProfiles } from '../lib/permissions'

const EMPTY = {
  name: '',
  group_name: '',
  status: '정상',
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
  const [showEmbed, setShowEmbed] = useState(false)
  const [loading, setLoading] = useState(false)
  const toast = useToast()

  // 드라이브 연결 서류
  if (doc.external_url) {
    const fileId = String(doc.external_url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/)?.[1] || '')
    return (
      <div className="rounded-lg border border-ink-200">
        <div className="flex items-center gap-3 px-3 py-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ink-100 text-ink-500">
            <Icon name={isImage(doc.mime_type, doc.file_name) ? 'image' : 'file'} size={17} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-ink-800">{doc.file_name}</span>
            <span className="mt-0.5 block text-xs text-ink-500">
              <span className="chip bg-ink-100 text-ink-600">드라이브 연결</span>
            </span>
          </span>
          {fileId ? (
            <button
              type="button"
              onClick={() => setShowEmbed((v) => !v)}
              className="btn-ghost px-2.5 py-1.5 text-xs"
            >
              <Icon name="image" size={14} />
              {showEmbed ? '닫기' : '보기'}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => window.open(doc.external_url, '_blank', 'noopener')}
            className="btn-ghost px-2.5 py-1.5 text-xs"
          >
            <Icon name="download" size={14} />
            열기
          </button>
        </div>
        {showEmbed && fileId ? (
          <div className="border-t border-ink-100 bg-ink-50/60 p-3">
            <iframe
              title={doc.file_name}
              src={`https://drive.google.com/file/d/${fileId}/preview`}
              className="h-96 w-full rounded-lg border border-ink-200 bg-white"
            />
          </div>
        ) : null}
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

export default function PartnerFormModal({ open, onClose, onSaved, initial, readOnly = false, userId, ledger = null, isAdmin = false, profiles = [], linkProps = null, existingNames = [] }) {
  const toast = useToast()
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [docs, setDocs] = useState([])
  const [docsLoading, setDocsLoading] = useState(false)
  const [uploading, setUploading] = useState('')
  const [linkQuery, setLinkQuery] = useState('')
  /* 추가 담당자 목록 (migration_partner_contacts.sql 실행 후 사용) */
  const [contacts, setContacts] = useState([])
  const [contactsSupported, setContactsSupported] = useState(null)
  const [contactsLoading, setContactsLoading] = useState(false)
  const [newContact, setNewContact] = useState({ name: '', job_title: '', email: '', phone: '' })
  const [editingContactId, setEditingContactId] = useState(null)
  const [editingContact, setEditingContact] = useState({ name: '', job_title: '', email: '', phone: '' })
  const [contactBusy, setContactBusy] = useState(false)

  const linkProjectsShown = useMemo(() => {
    const q = linkQuery.trim().toLowerCase()
    const list = linkProps?.projects || []
    if (!q) return list
    return list.filter((p) => String(p.name || '').toLowerCase().includes(q))
  }, [linkProps, linkQuery])

  const partnerId = initial?.id || null

  useEffect(() => {
    if (!open) return
    setError('')
    setLinkQuery('')
    if (initial) {
      setForm({
        name: initial.name || '',
        group_name: initial.group_name || '',
        status: initial.status || '정상',
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
      setContacts([])
      setContactsSupported(null)
      return
    }
    setDocsLoading(true)
    listPartnerDocs([partnerId])
      .then((rows) => setDocs(rows || []))
      .catch((e) => toast.error(e.message))
      .finally(() => setDocsLoading(false))
    setContactsLoading(true)
    contactsTableExists()
      .then(({ available }) => {
        setContactsSupported(available)
        if (!available) {
          setContacts([])
          return
        }
        return listPartnerContacts([partnerId]).then((rows) => setContacts(rows || []))
      })
      .catch(() => setContactsSupported(false))
      .finally(() => setContactsLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, partnerId])

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const groupSuggest = useMemo(
    () => (readOnly ? null : suggestPartnerGroup(form.name, `${form.memo} ${form.group_name}`)),
    [readOnly, form.name, form.memo, form.group_name],
  )

  /* 유사 거래처 경고: 법인격 표기 무시 + 포함 관계 + 자모 바이그램 유사도 */
  const similarPartners = useMemo(() => {
    if (readOnly) return []
    const target = normalizeVendorName(form.name)
    if (!target || target.length < 2) return []
    const bigrams = (s) => {
      const set = new Set()
      for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2))
      return set
    }
    const targetBi = bigrams(target)
    const out = []
    for (const p of existingNames || []) {
      if (partnerId && p.id === partnerId) continue
      const name = String(p.name || '').trim()
      const n = normalizeVendorName(name)
      if (!n) continue
      let kind = ''
      if (n === target) kind = '동일'
      else if (n.includes(target) || target.includes(n)) kind = '유사'
      else {
        const nb = bigrams(n)
        let inter = 0
        for (const b of nb) if (targetBi.has(b)) inter += 1
        const sim = targetBi.size + nb.size ? (2 * inter) / (targetBi.size + nb.size) : 0
        if (sim >= 0.55 && Math.min(n.length, target.length) >= 2) kind = '유사'
      }
      if (kind) out.push({ id: p.id, name, kind })
    }
    return out
      .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, 'ko') : a.kind === '동일' ? -1 : 1))
      .slice(0, 5)
  }, [readOnly, form.name, existingNames, partnerId])

  const submit = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) return setError('거래처명을 입력해 주세요.')
    if (!partnerId && similarPartners.some((p) => p.kind === '동일')) {
      return setError(`이미 등록된 거래처입니다 (${similarPartners.find((p) => p.kind === '동일').name}). 기존 항목을 수정해 주세요.`)
    }

    setSaving(true)
    setError('')
    try {
      const payload = {
        name: form.name.trim(),
        group_name: form.group_name.trim() || '기타',
        status: form.status === '폐업' ? '폐업' : '정상',
        contact_person: form.contact_person.trim(),
        job_title: form.job_title.trim(),
        email: form.email.trim(),
        phone_main: form.phone_main.trim(),
        phone: form.phone.trim(),
        memo: form.memo.trim(),
      }
      if (partnerId) {
        const saved = await updatePartner(partnerId, payload)
        toast.success('거래처가 수정되었습니다.')
        onSaved?.(saved)
      } else {
        const saved = await createPartner({ ...payload, created_by: userId })
        toast.success('거래처가 등록되었습니다.')
        onSaved?.(saved)
      }
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

  /* 추가 담당자 추가·수정·삭제 */
  const handleAddContact = async () => {
    if (!newContact.name.trim() || !partnerId) return
    setContactBusy(true)
    try {
      const saved = await createPartnerContact(
        partnerId,
        {
          name: newContact.name.trim(),
          job_title: newContact.job_title.trim(),
          email: newContact.email.trim(),
          phone: newContact.phone.trim(),
          sort_order: contacts.length,
        },
        userId,
      )
      setContacts((c) => [...c, saved])
      setNewContact({ name: '', job_title: '', email: '', phone: '' })
      toast.success('담당자가 추가되었습니다.')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setContactBusy(false)
    }
  }

  const startEditContact = (c) => {
    setEditingContactId(c.id)
    setEditingContact({
      name: c.name || '',
      job_title: c.job_title || '',
      email: c.email || '',
      phone: c.phone || '',
    })
  }

  const handleSaveContact = async () => {
    if (!editingContactId || !editingContact.name.trim()) return
    setContactBusy(true)
    try {
      const saved = await updatePartnerContact(editingContactId, {
        name: editingContact.name.trim(),
        job_title: editingContact.job_title.trim(),
        email: editingContact.email.trim(),
        phone: editingContact.phone.trim(),
      })
      setContacts((list) => list.map((c) => (c.id === editingContactId ? { ...c, ...saved } : c)))
      setEditingContactId(null)
      toast.success('담당자가 수정되었습니다.')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setContactBusy(false)
    }
  }

  const handleDeleteContact = async (c) => {
    if (!window.confirm(`"${c.name}" 담당자를 삭제하시겠습니까?`)) return
    try {
      await deletePartnerContact(c.id)
      setContacts((list) => list.filter((x) => x.id !== c.id))
      toast.success('담당자가 삭제되었습니다.')
    } catch (err) {
      toast.error(err.message)
    }
  }

  /* 거래내역: 법인격 표기 차이 무시하고 이름으로 매칭합니다.
     직원은 사원 작성분만 봅니다 (관리자 작성분 제외). */
  const ledgerInfo = useMemo(() => {
    if (!ledger || !partnerId) return null
    const target = normalizeVendorName(initial?.name)
    if (!target) return null
    const same = (v) => normalizeVendorName(v) === target
    const staffIds = staffIdsFromProfiles(profiles)
    const matched = (ledger.entries || []).filter(
      (e) => same(e.counterparty) && (isAdmin || isStaffVisible(e, staffIds)),
    )
    const cols = (ledger.collections || []).filter((c) => same(c.counterparty))
    let sale = 0
    let purchase = 0
    for (const e of matched) {
      if (e.entry_type === 'sale') sale += Number(e.total_amount || 0)
      else if (e.entry_type === 'purchase' || e.entry_type === 'opex') purchase += Number(e.total_amount || 0)
    }
    const collected = cols.reduce((a, c) => a + Number(c.amount || 0), 0)
    const recent = [
      ...matched.map((e) => ({
        key: `e-${e.id}`,
        date: e.entry_date,
        label: e.entry_type === 'sale' ? '매출' : e.entry_type === 'purchase' ? '매입' : '운영비',
        text: e.description || e.category || '',
        amount: Number(e.total_amount || 0),
        to:
          e.source === 'expense_report'
            ? `/expense-reports?search=${encodeURIComponent(e.counterparty || '')}&period=all`
            : `/${e.entry_type === 'sale' ? 'sales' : e.entry_type === 'purchase' ? 'purchases' : 'expenses'}?search=${encodeURIComponent(e.counterparty || '')}&period=all`,
      })),
      ...cols.map((c) => ({
        key: `c-${c.id}`,
        date: c.collected_on,
        label: '수금',
        text: c.memo || '',
        amount: Number(c.amount || 0),
        to: `/collections?vendor=${encodeURIComponent(c.counterparty || '')}`,
      })),
    ]
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
      .slice(0, 8)
    return { sale, purchase, collected, count: matched.length + cols.length, recent }
  }, [ledger, partnerId, initial?.name, isAdmin, profiles])

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
          {similarPartners.length ? (
            <div
              className={`mt-1.5 rounded-lg border px-2.5 py-2 text-xs leading-relaxed ${
                similarPartners.some((p) => p.kind === '동일')
                  ? 'border-rose-200 bg-rose-50/60 text-rose-800'
                  : 'border-amber-200 bg-amber-50/60 text-amber-800'
              }`}
            >
              <p className="font-bold">
                {similarPartners.some((p) => p.kind === '동일')
                  ? '이미 등록된 거래처입니다. 새로 만들지 말고 기존 항목을 수정하세요.'
                  : '비슷한 거래처가 있습니다. 중복 등록 전에 확인하세요.'}
              </p>
              <ul className="mt-1 flex flex-col gap-0.5">
                {similarPartners.map((p) => (
                  <li key={p.id} className="flex items-center gap-1.5">
                    <span className="font-bold">[{p.kind}]</span>
                    <span className="truncate">{p.name}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Field>

        <Field label="구분" hint="협력사 그룹별로 묶어 봅니다.">
          <input
            className="input"
            list="partner-group-list"
            value={form.group_name}
            onChange={set('group_name')}
            placeholder="예: 음향·조명·영상"
            disabled={readOnly}
          />
          <datalist id="partner-group-list">
            {PARTNER_GROUPS.map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
          {groupSuggest && groupSuggest !== form.group_name ? (
            <p className="mt-1.5 text-xs text-ink-500">
              추천: <strong className="text-ink-700">{groupSuggest}</strong>{' '}
              <button
                type="button"
                className="font-bold text-brand-700 hover:underline"
                onClick={() => setForm((f) => ({ ...f, group_name: groupSuggest }))}
              >
                적용
              </button>
            </p>
          ) : null}
        </Field>

        <Field label="영업상태">
          <select className="input" value={form.status} onChange={set('status')} disabled={readOnly}>
            <option value="정상">정상</option>
            <option value="폐업">폐업</option>
          </select>
        </Field>

        <Field label="담당자" hint="대표 담당자 1명. 다른 직원들은 아래 목록에 추가하세요.">
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

      {/* 추가 담당자 목록 */}
      {partnerId ? (
        <div className="mt-5 border-t border-ink-100 pt-4">
          <h3 className="text-sm font-bold text-ink-900">담당자 목록</h3>
          <p className="mt-0.5 text-xs text-ink-500">
            대표 담당자 외에 이 거래처의 다른 직원들을 추가합니다.
          </p>
          {contactsSupported === false ? (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-800">
              담당자 목록을 쓰려면 Supabase SQL Editor에서
              <span className="font-bold"> supabase/migration_partner_contacts.sql</span>을 1회 실행해 주세요.
            </p>
          ) : contactsLoading ? (
            <p className="py-3 text-center text-xs text-ink-400">담당자를 불러오는 중…</p>
          ) : (
            <div className="mt-2.5 flex flex-col gap-2">
              {contacts.map((c) =>
                editingContactId === c.id ? (
                  <div key={c.id} className="grid grid-cols-2 gap-2 rounded-lg border border-brand-200 bg-brand-50/40 p-2.5">
                    <input
                      className="input py-1.5 text-xs"
                      value={editingContact.name}
                      onChange={(e) => setEditingContact((f) => ({ ...f, name: e.target.value }))}
                      placeholder="이름"
                      disabled={readOnly}
                    />
                    <input
                      className="input py-1.5 text-xs"
                      value={editingContact.job_title}
                      onChange={(e) => setEditingContact((f) => ({ ...f, job_title: e.target.value }))}
                      placeholder="직함"
                      disabled={readOnly}
                    />
                    <input
                      className="input py-1.5 text-xs"
                      value={editingContact.email}
                      onChange={(e) => setEditingContact((f) => ({ ...f, email: e.target.value }))}
                      placeholder="이메일"
                      disabled={readOnly}
                    />
                    <input
                      className="input py-1.5 text-xs"
                      value={editingContact.phone}
                      onChange={(e) => setEditingContact((f) => ({ ...f, phone: e.target.value }))}
                      placeholder="전화번호"
                      disabled={readOnly}
                    />
                    {!readOnly ? (
                      <div className="col-span-2 flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingContactId(null)}
                          disabled={contactBusy}
                          className="text-xs font-semibold text-ink-500 hover:underline"
                        >
                          취소
                        </button>
                        <button
                          type="button"
                          onClick={handleSaveContact}
                          disabled={contactBusy}
                          className="text-xs font-bold text-brand-700 hover:underline disabled:opacity-50"
                        >
                          {contactBusy ? '저장 중…' : '저장'}
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div key={c.id} className="flex items-center gap-2.5 rounded-lg border border-ink-200 px-3 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold text-ink-800">
                        {c.name}
                        {c.job_title ? <span className="ml-1.5 font-medium text-ink-500">{c.job_title}</span> : null}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-ink-500">
                        {[c.email, c.phone].filter(Boolean).join(' · ') || '연락처 없음'}
                      </span>
                    </span>
                    {!readOnly ? (
                      <>
                        <button
                          type="button"
                          onClick={() => startEditContact(c)}
                          className="shrink-0 text-xs font-semibold text-ink-500 hover:underline"
                        >
                          수정
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteContact(c)}
                          className="shrink-0 text-xs font-semibold text-loss hover:underline"
                        >
                          삭제
                        </button>
                      </>
                    ) : null}
                  </div>
                ),
              )}
              {!readOnly && contactsSupported ? (
                <div className="grid grid-cols-2 gap-2 rounded-lg border border-dashed border-ink-300 p-2.5">
                  <input
                    className="input py-1.5 text-xs"
                    value={newContact.name}
                    onChange={(e) => setNewContact((f) => ({ ...f, name: e.target.value }))}
                    placeholder="이름 (필수)"
                  />
                  <input
                    className="input py-1.5 text-xs"
                    value={newContact.job_title}
                    onChange={(e) => setNewContact((f) => ({ ...f, job_title: e.target.value }))}
                    placeholder="직함"
                  />
                  <input
                    className="input py-1.5 text-xs"
                    value={newContact.email}
                    onChange={(e) => setNewContact((f) => ({ ...f, email: e.target.value }))}
                    placeholder="이메일"
                  />
                  <input
                    className="input py-1.5 text-xs"
                    value={newContact.phone}
                    onChange={(e) => setNewContact((f) => ({ ...f, phone: e.target.value }))}
                    placeholder="전화번호"
                  />
                  <div className="col-span-2 flex justify-end">
                    <button
                      type="button"
                      onClick={handleAddContact}
                      disabled={contactBusy || !newContact.name.trim()}
                      className="text-xs font-bold text-brand-700 hover:underline disabled:opacity-50"
                    >
                      {contactBusy ? '추가 중…' : '+ 담당자 추가'}
                    </button>
                  </div>
                </div>
              ) : null}
              {!readOnly && !contacts.length && contactsSupported ? (
                <p className="rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-400">
                  등록된 추가 담당자가 없습니다.
                </p>
              ) : null}
            </div>
          )}
        </div>
      ) : null}

      {/* 거래내역 */}
      {ledgerInfo ? (
        <div className="mt-5 border-t border-ink-100 pt-4">
          <h3 className="text-sm font-bold text-ink-900">거래내역</h3>
          <p className="mt-0.5 text-xs text-ink-500">
            장부·수금에 남은 이름으로 묶어 보여줍니다. 수금 잔금 관리용입니다.
          </p>
          {ledgerInfo.count ? (
            <>
              <dl className="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-ink-50/80 p-3 text-center">
                <div>
                  <dt className="text-[11px] font-semibold text-ink-500">매출(합계)</dt>
                  <dd className="mt-0.5 font-num text-sm font-bold tabular-nums text-ink-900">
                    {formatKRW(ledgerInfo.sale)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-semibold text-ink-500">매입·비용(합계)</dt>
                  <dd className="mt-0.5 font-num text-sm font-bold tabular-nums text-ink-900">
                    {formatKRW(ledgerInfo.purchase)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-semibold text-ink-500">수금</dt>
                  <dd className="mt-0.5 font-num text-sm font-bold tabular-nums text-emerald-700">
                    {formatKRW(ledgerInfo.collected)}
                  </dd>
                </div>
              </dl>
              <ul className="mt-2 flex flex-col divide-y divide-ink-100">
                {ledgerInfo.recent.map((r) => (
                  <li key={r.key} className="flex items-center gap-2 py-2 text-xs">
                    <span className="w-20 shrink-0 font-semibold text-ink-500">{formatDateHuman(r.date)}</span>
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold ${
                        r.label === '수금'
                          ? 'bg-emerald-50 text-emerald-700'
                          : r.label === '매출'
                            ? 'bg-brand-50 text-brand-700'
                            : 'bg-ink-100 text-ink-600'
                      }`}
                    >
                      {r.label}
                    </span>
                    <Link
                      to={r.to}
                      className="min-w-0 flex-1 truncate text-ink-700 hover:text-brand-700 hover:underline"
                    >
                      {r.text || '(내용 없음)'}
                    </Link>
                    <span className="shrink-0 font-num font-bold tabular-nums text-ink-900">
                      {formatKRW(r.amount)}원
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="mt-3 rounded-lg bg-ink-50 px-3 py-2.5 text-xs text-ink-400">
              이 이름으로 잡힌 장부·수금 내역이 없습니다.
            </p>
          )}
        </div>
      ) : null}

      {/* 연결된 프로젝트 */}
      {linkProps && partnerId ? (
        <div className="mt-5 border-t border-ink-100 pt-4">
          <h3 className="text-sm font-bold text-ink-900">연결된 프로젝트</h3>
          <p className="mt-0.5 text-xs text-ink-500">
            체크하면 연결됩니다. 한 거래처가 여러 행사에 겹쳐도 각각 체크하면 됩니다.
          </p>
          <div className="relative mt-2.5">
            <Icon
              name="search"
              size={14}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400"
            />
            <input
              className="input py-1.5 pl-8 text-xs"
              placeholder="프로젝트 검색"
              value={linkQuery}
              onChange={(e) => setLinkQuery(e.target.value)}
            />
          </div>
          {linkProjectsShown.length ? (
            <div className="mt-2.5 flex max-h-64 flex-col gap-1.5 overflow-auto">
              {linkProjectsShown.map((p) => {
                const linked = linkProps.linkedIds.has(p.id)
                const busy = linkProps.busyId === `${p.id}:${partnerId}`
                return (
                  <label
                    key={p.id}
                    className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-ink-200 px-3 py-2 text-sm transition hover:bg-ink-50/60"
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 shrink-0 accent-brand-600"
                      checked={linked}
                      disabled={busy}
                      onChange={() => linkProps.onToggle(p.id, linked)}
                    />
                    <span className="min-w-0 flex-1 truncate font-semibold text-ink-800">{p.name}</span>
                    {busy ? <span className="text-xs text-ink-400">저장 중…</span> : null}
                  </label>
                )
              })}
            </div>
          ) : (
            <p className="mt-2 rounded-lg bg-ink-50 px-3 py-2.5 text-xs text-ink-400">
              등록된 프로젝트가 없습니다.
            </p>
          )}
        </div>
      ) : null}

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
                </div>
                {docsByType(type).length ? (
                  <div className="flex flex-col gap-2">
                    {docsByType(type).map((doc) => (
                      <div key={doc.id} className="flex flex-col gap-2">
                        <DocPreview doc={doc} />
                        <button
                          type="button"
                          onClick={() => handleDeleteDoc(doc)}
                          className="self-end text-xs font-semibold text-loss hover:underline"
                        >
                          서류 삭제
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="rounded-lg bg-ink-50 px-3 py-2.5 text-xs text-ink-400">
                    등록된 {PARTNER_DOC_TYPES[type]}이(가) 없습니다.
                  </p>
                )}
                <DriveLinkForm
                  docType={type}
                  partnerId={partnerId}
                  userId={userId}
                  onLinked={(doc) => setDocs((d) => [...d, doc])}
                />
              </section>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}

function DriveLinkForm({ docType, partnerId, userId, onLinked }) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 text-xs font-semibold text-brand-700 hover:underline"
      >
        + 드라이브 공유 링크로 연결
      </button>
    )
  }

  const submit = async () => {
    setBusy(true)
    try {
      const saved = await linkExternalDoc(partnerId, docType, name, link, userId)
      onLinked?.(saved)
      setName('')
      setLink('')
      setOpen(false)
      toast.success('드라이브 서류가 연결되었습니다.')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-2 rounded-lg border border-dashed border-ink-300 p-3">
      <p className="text-xs font-semibold text-ink-700">
        드라이브에서 파일 우클릭 → 공유 → 링크 복사 후 붙여넣기
      </p>
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <input
          className="input py-1.5 text-xs"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="표시 이름 (예: 사업자등록증.jpg)"
        />
        <input
          className="input py-1.5 text-xs"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="https://drive.google.com/..."
        />
      </div>
      <div className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={busy}
          className="text-xs font-semibold text-ink-500 hover:underline"
        >
          취소
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="text-xs font-bold text-brand-700 hover:underline disabled:opacity-50"
        >
          {busy ? '연결 중…' : '연결'}
        </button>
      </div>
    </div>
  )
}
