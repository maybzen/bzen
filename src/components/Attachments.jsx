import { useState } from 'react'
import Icon from './Icon'
import { Modal, Spinner } from './ui'
import { getAttachmentUrl } from '../lib/api'
import { formatDateTime, formatFileSize } from '../lib/format'
import { useToast } from './Toast'

function isImage(mime, name) {
  if (mime && mime.startsWith('image/')) return true
  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name || '')
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
  const [loading, setLoading] = useState(false)
  const toast = useToast()

  const open = async () => {
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

  return (
    <li className="flex items-center gap-3 rounded-lg border border-ink-200 px-3 py-2.5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ink-100 text-ink-500">
        <Icon name={isImage(file.mime_type, file.file_name) ? 'image' : 'file'} size={17} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-ink-800">{file.file_name}</span>
        <span className="block text-xs text-ink-500">
          {formatFileSize(file.size_bytes)} · {formatDateTime(file.created_at)}
        </span>
      </span>
      <button type="button" onClick={open} className="btn-ghost px-2.5 py-1.5 text-xs" disabled={loading}>
        {loading ? <Spinner size={13} /> : <Icon name="download" size={14} />}
        열기
      </button>
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
