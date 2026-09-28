import { useEffect, useState } from 'react'
import Icon from './Icon'
import { Modal, Spinner } from './ui'
import { getAttachmentUrl } from '../lib/api'
import { formatDateTime, formatFileSize } from '../lib/format'
import { useToast } from './Toast'

function isImage(mime, name) {
  if (mime && mime.startsWith('image/')) return true
  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name || '')
}

function isPdf(mime, name) {
  if (mime === 'application/pdf') return true
  return /\.pdf$/i.test(name || '')
}

/** 목록에서 증빙 개수를 보여주는 셀 */
export function AttachmentCell({ attachments = [], onOpen }) {
  if (!attachments.length) return <span className="text-xs text-ink-300">—</span>
  return (
    <button
      type="button"
      onClick={() => onOpen(attachments)}
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-semibold text-brand-700 transition hover:bg-brand-50"
    >
      <Icon name="paperclip" size={14} />
      {attachments.length}
    </button>
  )
}

function PreviewItem({ file }) {
  const [url, setUrl] = useState('')
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const toast = useToast()
  const showThumb = isImage(file.mime_type, file.file_name)
  const previewable = showThumb || isPdf(file.mime_type, file.file_name)

  /* 이미지는 미리보기 썸네일을 미리 불러옵니다 */
  useEffect(() => {
    if (!showThumb || !file.file_path) return
    let alive = true
    getAttachmentUrl(file.file_path)
      .then((signed) => {
        if (alive) setUrl(signed)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [showThumb, file.file_path])

  const openTab = async () => {
    if (url) {
      window.open(url, '_blank', 'noopener')
      return
    }
    setLoading(true)
    try {
      const signed = await getAttachmentUrl(file.file_path)
      setUrl(signed)
      window.open(signed, '_blank', 'noopener')
    } catch (e) {
      toast.error(e.message)
    } finally {
      setLoading(false)
    }
  }

  const toggle = async () => {
    if (open) {
      setOpen(false)
      return
    }
    if (!url) {
      setLoading(true)
      try {
        const signed = await getAttachmentUrl(file.file_path)
        setUrl(signed)
      } catch (e) {
        toast.error(e.message)
        return
      } finally {
        setLoading(false)
      }
    }
    setOpen(true)
  }

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-ink-200 px-3 py-2.5">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={toggle}
          className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-ink-100 text-ink-500"
          title="미리보기"
        >
          {showThumb && url ? (
            <img src={url} alt={file.file_name} className="h-full w-full object-cover" />
          ) : (
            <Icon name={showThumb ? 'image' : 'file'} size={17} />
          )}
        </button>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-ink-800">{file.file_name}</span>
          <span className="block text-xs text-ink-500">
            {formatFileSize(file.size_bytes)} · {formatDateTime(file.created_at)}
          </span>
        </span>
        {previewable ? (
          <button type="button" onClick={toggle} className="btn-ghost px-2.5 py-1.5 text-xs" disabled={loading}>
            {loading && !open ? <Spinner size={13} /> : <Icon name="image" size={14} />}
            {open ? '닫기' : '보기'}
          </button>
        ) : null}
        <button type="button" onClick={openTab} className="btn-ghost px-2.5 py-1.5 text-xs" disabled={loading}>
          {loading && open ? <Spinner size={13} /> : <Icon name="download" size={14} />}
          열기
        </button>
      </div>
      {open && url ? (
        <div className="border-t border-ink-100 pt-2">
          {showThumb ? (
            <img src={url} alt={file.file_name} className="mx-auto max-h-96 rounded-lg border border-ink-200" />
          ) : (
            <iframe title={file.file_name} src={url} className="h-96 w-full rounded-lg border border-ink-200 bg-white" />
          )}
        </div>
      ) : null}
    </li>
  )
}

/** 증빙 파일 목록 모달 */
export function AttachmentModal({ open, onClose, attachments, title = '증빙 파일' }) {
  return (
    <Modal open={open} onClose={onClose} title={title} size="md">
      {attachments?.length ? (
        <ul className="flex flex-col gap-2">
          {attachments.map((file) => (
            <PreviewItem key={file.id} file={file} />
          ))}
        </ul>
      ) : (
        <p className="py-8 text-center text-sm text-ink-400">첨부된 파일이 없습니다.</p>
      )}
    </Modal>
  )
}
