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
      const s = `%${search.trim().replace(/[%,()]/g, '')}%`
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
  return String(name || 'file')
    .replace(/[^\w.\-가-힣]+/g, '_')
    .slice(-90)
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
/* 설정                                                               */
/* ------------------------------------------------------------------ */

export function getSettings() {
  return unwrap(supabase.from('settings').select('*').eq('id', 1).maybeSingle())
}

export function updateSettings(patch) {
  return unwrap(supabase.from('settings').update(patch).eq('id', 1).select().single())
}
