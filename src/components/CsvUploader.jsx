/**
 * CsvUploader.jsx
 *
 * Renders a file upload area for a single file (click or drag & drop).
 * Calls onLoad(contents, fileName) — text by default, ArrayBuffer when
 * readAs="arrayBuffer" (used for PDFs).
 */

import { useRef, useState } from 'react'
import Icon from './Icon.jsx'

export default function CsvUploader({
  label,
  description,
  onLoad,
  onReject,
  hasData,
  fileName,
  accept = '.csv',
  readAs = 'text',
  maxBytes = 1024 * 1024,
  disabled = false,
}) {
  const inputRef = useRef(null)
  const [drag, setDrag] = useState(false)

  function readFile(file) {
    if (!file) return
    const problem = checkFile(file, { accept, maxBytes })
    if (problem) {
      onReject?.(problem, file.name)
      return
    }
    const reader = new FileReader()
    reader.onerror = () => onReject?.(`Could not read ${file.name}. Please try again.`, file.name)
    reader.onload = (evt) => onLoad(evt.target.result, file.name)
    if (readAs === 'arrayBuffer') reader.readAsArrayBuffer(file)
    else reader.readAsText(file)
  }

  function handleFile(e) {
    readFile(e.target.files[0])
    // Reset input so the same file can be re-uploaded
    e.target.value = ''
  }

  return (
    <button
      aria-label={`${hasData ? 'Replace' : 'Upload'} ${label}`}
      type="button"
      className={`dropzone${hasData ? ' loaded' : ''}${drag ? ' drag' : ''}`}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault()
        setDrag(true)
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDrag(false)
        readFile(e.dataTransfer.files[0])
      }}
      disabled={disabled}
    >
      <input ref={inputRef} type="file" accept={accept} style={{ display: 'none' }} onChange={handleFile} tabIndex={-1} />
      <span className="dropzone-icon">
        <Icon name={hasData ? 'check' : 'upload'} />
      </span>
      <span>
        <div className="dropzone-title">{label}</div>
        <div className="dropzone-sub">{hasData ? fileName : description}</div>
      </span>
      <span className="dropzone-action">{hasData ? 'Replace' : 'Browse'}</span>
    </button>
  )
}

/**
 * Rejects files by extension and size before reading them into memory.
 * Drag & drop bypasses the input's `accept` filter, so it is checked here too.
 */
export function checkFile(file, { accept, maxBytes }) {
  const allowed = accept.split(',').map((a) => a.trim().toLowerCase()).filter((a) => a.startsWith('.'))
  const name = file.name.toLowerCase()
  if (allowed.length && !allowed.some((ext) => name.endsWith(ext))) {
    return `${file.name} isn't a supported file. Please upload a ${allowed.join(' or ')} file.`
  }
  if (file.size === 0) return `${file.name} is empty.`
  if (file.size > maxBytes) {
    return `${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is ${(maxBytes / 1024 / 1024).toFixed(0)} MB.`
  }
  return null
}
