import { supabase, FUNCTIONS_URL, SUPABASE_ANON_KEY } from './supabase'

const PAGE = 1000

async function unwrap(promise) {
  const { data, error } = await promise
  if (error) throw new Error(error.message || '요청 처리 중 오류가 발생했습니다.')
  return data
}

function fail(message, status) {
  const err = new Error(message)
  err.status = status
  return err
}

/* ------------------------------------------------------------------ */
/* 인증 보조 (엣지 함수)                                                */
/* ------------------------------------------------------------------ */

export async function callAdminFn(payload) {
  const {
    data: { session },
  } = await supabase.auth.getSession()

  let res
  try {
    res = await fetch(`${FUNCTIONS_URL}/admin-users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: JSON.stringify(payload),
    })
  } catch {
    throw fail('서버에 연결할 수 없습니다. 네트워크를 확인해 주세요.')
  }

  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw fail(body?.error || `요청을 처리하지 못했습니다. (${res.status})`, res.status)
  return body
}

export async function getSetupStatus() {
  return callAdminFn({ action: 'status' })
}

/* ------------------------------------------------------------------ */
/* 프로필                                                              */
/* ------------------------------------------------------------------ */

export function getProfile(id) {
  return unwrap(supabase.from('profiles').select('*').eq('id', id).maybeSingle())
}

export function listProfiles() {
  return unwrap(supabase.from('profiles').select('*').order('created_at', { ascending: true }))
}

export function updateProfile(id, patch) {
  return unwrap(supabase.from('profiles').update(patch).eq('id', id).select().single())
}

/* ------------------------------------------------------------------ */
/* 프로젝트                                                            */
/* ------------------------------------------------------------------ */

export function listProjects() {
  return unwrap(supabase.from('projects').select('*').order('created_at', { ascending: true }))
}

export function createProject(payload) {
  return unwrap(supabase.from('projects').insert(payload).select().single())
}

export function updateProject(id, patch) {
  return unwrap(supabase.from('projects').update(patch).eq('id', id).select().single())
}

export function deleteProject(id) {
  return unwrap(supabase.from('projects').delete().eq('id', id))
}

/** 계약금액 분리 컬럼(contract_supply/vat)이 있는지 확인 (마이그레이션 여부 감지용) */
export async function projectContractSplitAvailable() {
  const { error } = await supabase.from('projects').select('contract_supply').limit(1)
  if (!error) return true
  const msg = String(error?.message || '')
  return !/column .* does not exist|42703|schema cache/i.test(msg)
}

/* ------------------------------------------------------------------ */
/* 수금 (프로젝트별 입금 내역)                                           */
/* ------------------------------------------------------------------ */

export function listCollections() {
  return unwrap(
    supabase
      .from('collections')
      .select('*')
      .order('collected_on', { ascending: false })
      .order('created_at', { ascending: false }),
  )
}

export function createCollection(payload, userId) {
  return unwrap(
    supabase.from('collections').insert({ ...payload, created_by: userId }).select().single(),
  )
}

export function deleteCollection(id) {
  return unwrap(supabase.from('collections').delete().eq('id', id))
}

/* ------------------------------------------------------------------ */
/* 급여명세서 (월별 breakdown. migration_payroll_slips.sql 1회 실행 후 사용) */
/* ------------------------------------------------------------------ */

export function listSlips(ym) {
  let q = supabase.from('payroll_slips').select('*').order('person', { ascending: true })
  if (ym) q = q.eq('ym', ym)
  return unwrap(q)
}

export function upsertSlip(payload, userId) {
  const row = { ...payload, created_by: userId, updated_at: new Date().toISOString() }
  return unwrap(supabase.from('payroll_slips').upsert(row, { onConflict: 'entry_id' }).select().single())
}

/* ------------------------------------------------------------------ */
/* 자금관리 (계좌·대출·카드 마스터 + 잔고 스냅샷. 관리자 전용)              */
/* ------------------------------------------------------------------ */

const FUND_TABLES = ['fund_accounts', 'fund_loans', 'fund_cards', 'fund_snapshots']

function fundTable(table) {
  if (!FUND_TABLES.includes(table)) throw new Error('허용되지 않은 테이블입니다.')
  return table
}

export function listFundRows(table) {
  const orderKey = table === 'fund_snapshots' ? 'snap_date' : 'sort_order'
  return unwrap(
    supabase
      .from(fundTable(table))
      .select('*')
      .order(orderKey, { ascending: table === 'fund_snapshots' ? false : true }),
  )
}

export function saveFundRow(table, row, userId) {
  const clean = { ...row, updated_at: new Date().toISOString() }
  delete clean.id
  delete clean.created_at
  if (row.id) {
    return unwrap(supabase.from(fundTable(table)).update(clean).eq('id', row.id).select().single())
  }
  return unwrap(
    supabase.from(fundTable(table)).insert({ ...clean, created_by: userId }).select().single(),
  )
}

export function deleteFundRow(table, id) {
  return unwrap(supabase.from(fundTable(table)).delete().eq('id', id))
}

export function upsertSnapshot(snapDate, balances, memo, userId) {
  const row = {
    snap_date: snapDate,
    balances,
    memo: memo || '',
    created_by: userId,
    updated_at: new Date().toISOString(),
  }
  return unwrap(supabase.from('fund_snapshots').upsert(row, { onConflict: 'snap_date' }).select().single())
}

/* ------------------------------------------------------------------ */
/* 장부 (매출 / 매입 / 운영비 / 지출결의)                                */
/* ------------------------------------------------------------------ */

export async function listEntries({
  from,
  to,
  types,
  projectId,
  source,
  search,
  maxRows = 20000,
} = {}) {
  const rows = []
  let start = 0

  while (rows.length < maxRows) {
    let q = supabase
      .from('entries')
      .select('*')
      .order('entry_date', { ascending: false })
      .order('created_at', { ascending: false })
      .range(start, start + PAGE - 1)

    if (from) q = q.gte('entry_date', from)
    if (to) q = q.lte('entry_date', to)
    if (types && types.length) q = q.in('entry_type', types)
    if (projectId) q = q.eq('project_id', projectId)
    if (source) q = q.eq('source', source)
    if (search && search.trim()) {
      // 괄호·공백 등은 와일드카드로 바꿔 검색 (예: 현대자동차(주)본사 → DB의 괄호 포함 표기와 매칭)
      const s = `%${search.trim().replace(/[\s%,()]+/g, '%')}%`
      q = q.or(
        `counterparty.ilike.${s},description.ilike.${s},category.ilike.${s},doc_no.ilike.${s},memo.ilike.${s}`,
      )
    }

    const { data, error } = await q
    if (error) throw new Error(error.message)
    rows.push(...(data || []))
    if (!data || data.length < PAGE) break
    start += PAGE
  }

  return rows.slice(0, maxRows)
}

/** generated column(total_amount)은 저장 대상에서 제외 */
export function sanitizeEntry(payload) {
  const clean = { ...payload }
  delete clean.total_amount
  delete clean.id
  delete clean.created_at
  delete clean.updated_at
  return clean
}

export function createEntry(payload, userId) {
  // RLS가 created_by = 로그인 계정을 강제하므로 항상 로그인 계정으로 기록합니다.
  const row = sanitizeEntry({ ...payload, created_by: userId })
  return unwrap(supabase.from('entries').insert(row).select().single())
}

export function createEntries(rows) {
  if (!rows || !rows.length) return Promise.resolve([])
  // PostgREST 일괄 insert 는 모든 객체의 키가 동일해야 하므로 키를 통일합니다.
  // 값이 전부 비어 있는 키는 아예 보내지 않아 DB 기본값(예: created_by = auth.uid())이 적용되게 합니다.
  const cleaned = rows.map(sanitizeEntry)
  const allKeys = [...new Set(cleaned.flatMap((row) => Object.keys(row)))]
  const keys = allKeys.filter((key) =>
    cleaned.some((row) => row[key] !== undefined && row[key] !== null),
  )
  const normalized = cleaned.map((row) => {
    const out = {}
    for (const key of keys) out[key] = row[key] === undefined ? null : row[key]
    return out
  })
  return unwrap(supabase.from('entries').insert(normalized).select())
}

export function updateEntry(id, patch) {
  return unwrap(supabase.from('entries').update(sanitizeEntry(patch)).eq('id', id).select().single())
}

export function deleteEntry(id) {
  return unwrap(supabase.from('entries').delete().eq('id', id))
}

/* ------------------------------------------------------------------ */
/* 첨부파일                                                            */
/* ------------------------------------------------------------------ */

export function listAttachments(entryIds) {
  if (!entryIds || !entryIds.length) return Promise.resolve([])
  return unwrap(supabase.from('attachments').select('*').in('entry_id', entryIds))
}

export function listAllAttachments() {
  return unwrap(
    supabase.from('attachments').select('*').order('created_at', { ascending: false }).limit(5000),
  )
}

function safeFileName(name) {
  // 스토리지 키는 ASCII만 허용("Invalid key" 방지). 원본 한글 이름은 DB file_name에 따로 보관됩니다.
  const raw = String(name || 'file')
  const dot = raw.lastIndexOf('.')
  const ext = dot > 0 ? raw.slice(dot + 1).replace(/[^A-Za-z0-9]/g, '').slice(0, 10) : ''
  const stem =
    (dot > 0 ? raw.slice(0, dot) : raw)
      .replace(/[^A-Za-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 60) || 'file'
  return ext ? `${stem}.${ext}` : stem
}

export async function uploadAttachment(entryId, file, userId) {
  const path = `${userId}/${entryId}/${Date.now()}_${safeFileName(file.name)}`
  const { error } = await supabase.storage.from('receipts').upload(path, file, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  })
  if (error) throw new Error(`파일 업로드 실패: ${error.message}`)

  return unwrap(
    supabase
      .from('attachments')
      .insert({
        entry_id: entryId,
        file_path: path,
        file_name: file.name,
        mime_type: file.type || '',
        size_bytes: file.size || 0,
        uploaded_by: userId,
      })
      .select()
      .single(),
  )
}

export async function deleteAttachment(attachment) {
  await supabase.storage.from('receipts').remove([attachment.file_path])
  return unwrap(supabase.from('attachments').delete().eq('id', attachment.id))
}

export async function getAttachmentUrl(filePath, expiresIn = 3600) {
  const { data, error } = await supabase.storage.from('receipts').createSignedUrl(filePath, expiresIn)
  if (error) throw new Error(error.message)
  return data?.signedUrl
}

/* ------------------------------------------------------------------ */
/* 거래처                                                              */
/* ------------------------------------------------------------------ */

/** counterparties 테이블이 있는지 확인 (마이그레이션 여부 감지용) */
export async function partnersTableExists() {
  const { error } = await supabase.from('counterparties').select('id').limit(1)
  if (!error) return { available: true, missing: false }
  const message = String(error.message || '')
  const missing = error.code === '42P01' || /could not find the table|schema cache/i.test(message)
  return { available: false, missing }
}

export function listPartners() {
  return unwrap(supabase.from('counterparties').select('*').order('name', { ascending: true }))
}

function sanitizePartner(payload) {
  const clean = { ...payload }
  delete clean.id
  delete clean.created_at
  delete clean.updated_at
  return clean
}

export function createPartner(payload, userId) {
  const row = sanitizePartner({ ...payload, created_by: userId })
  return unwrap(supabase.from('counterparties').insert(row).select().single())
}

export function updatePartner(id, patch) {
  return unwrap(supabase.from('counterparties').update(sanitizePartner(patch)).eq('id', id).select().single())
}

export async function deletePartner(partner) {
  const docs = await listPartnerDocs([partner.id]).catch(() => [])
  const paths = (docs || []).map((d) => d.file_path).filter(Boolean)
  if (paths.length) {
    await supabase.storage.from('partner-docs').remove(paths).catch(() => {})
  }
  return unwrap(supabase.from('counterparties').delete().eq('id', partner.id))
}

/* ------------------------------------------------------------------ */
/* 거래처 서류 (사업자등록증 · 통장사본)                                  */
/* ------------------------------------------------------------------ */

const PARTNER_BUCKET = 'partner-docs'
const PARTNER_MAX_FILE = 20 * 1024 * 1024

export const PARTNER_DOC_TYPES = {
  biz: '사업자등록증',
  bank: '통장사본',
  other: '기타 서류',
}

export function listPartnerDocs(partnerIds) {
  if (!partnerIds || !partnerIds.length) return Promise.resolve([])
  return unwrap(
    supabase.from('partner_attachments').select('*').in('partner_id', partnerIds).order('created_at', { ascending: true }),
  )
}

export async function uploadPartnerDoc(partnerId, docType, file, userId) {
  if (!file) throw new Error('파일을 선택해 주세요.')
  if (file.size > PARTNER_MAX_FILE) throw new Error('파일은 20MB 이하만 올릴 수 있습니다.')
  const path = `${partnerId}/${Date.now()}_${safeFileName(file.name)}`
  const { error } = await supabase.storage.from(PARTNER_BUCKET).upload(path, file, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  })
  if (error) throw new Error(`파일 업로드 실패: ${error.message}`)

  return unwrap(
    supabase
      .from('partner_attachments')
      .insert({
        partner_id: partnerId,
        file_path: path,
        file_name: file.name,
        mime_type: file.type || '',
        size_bytes: file.size || 0,
        doc_type: docType || 'other',
        uploaded_by: userId,
      })
      .select()
      .single(),
  )
}

export async function deletePartnerDoc(doc) {
  if (!doc.file_path) {
    // 드라이브 연결 서류는 DB 행만 삭제
    return unwrap(supabase.from('partner_attachments').delete().eq('id', doc.id))
  }
  await supabase.storage.from(PARTNER_BUCKET).remove([doc.file_path]).catch(() => {})
  return unwrap(supabase.from('partner_attachments').delete().eq('id', doc.id))
}

/** 드라이브 공유 링크로 서류 연결 (파일을 올리지 않고 링크만 저장) */
export async function linkExternalDoc(partnerId, docType, name, url, userId) {
  const cleanUrl = String(url || '').trim()
  if (!cleanUrl) throw new Error('드라이브 링크를 입력해 주세요.')
  if (!/^https:\/\/(drive|docs)\.google\.com\//.test(cleanUrl)) {
    throw new Error('구글 드라이브 공유 링크가 아닙니다.')
  }
  const label = String(name || '').trim() || '드라이브 서류'
  return unwrap(
    supabase
      .from('partner_attachments')
      .insert({
        partner_id: partnerId,
        file_path: '',
        file_name: label,
        mime_type: '',
        size_bytes: 0,
        doc_type: docType || 'other',
        external_url: cleanUrl,
        uploaded_by: userId,
      })
      .select()
      .single(),
  )
}

export async function getPartnerDocUrl(filePath, expiresIn = 3600) {
  const { data, error } = await supabase.storage.from(PARTNER_BUCKET).createSignedUrl(filePath, expiresIn)
  if (error) throw new Error(error.message)
  return data?.signedUrl
}

/* ------------------------------------------------------------------ */
/* 휴무대장 (연차·대휴·동계휴가·보건휴가·경조사)                              */
/* ------------------------------------------------------------------ */

export function listLeaveEntries() {
  return unwrap(
    supabase
      .from('leave_entries')
      .select('*')
      .order('entry_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(5000),
  )
}

export function createLeaveEntry(payload, userId) {
  const row = { ...payload, created_by: userId }
  delete row.id
  delete row.created_at
  return unwrap(supabase.from('leave_entries').insert(row).select().single())
}

export function updateLeaveEntry(id, patch) {
  const row = { ...patch }
  delete row.id
  delete row.created_at
  return unwrap(supabase.from('leave_entries').update(row).eq('id', id).select().single())
}

export function deleteLeaveEntry(id) {
  return unwrap(supabase.from('leave_entries').delete().eq('id', id))
}

/* ------------------------------------------------------------------ */
/* 설정                                                               */
/* ------------------------------------------------------------------ */

export function getSettings() {
  return unwrap(supabase.from('settings').select('*').eq('id', 1).maybeSingle())
}

export function updateSettings(patch) {
  return unwrap(supabase.from('settings').update(patch).eq('id', 1).select().single())
}
