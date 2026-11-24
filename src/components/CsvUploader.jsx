/**
 * CsvUploader.jsx
 *
 * Renders a file upload area for a single file (click or drag & drop).
 * Calls onLoad(contents, fileName) — text by default, ArrayBuffer when
 * readAs="arrayBuffer" (used for PDFs).
 */

import { useRef, useState } from 'react'
import Icon from './Icon.jsx'

export default function CsvUploader({ label, description, onLoad, hasData, fileName, accept = '.csv', readAs = 'text', disabled = false }) {
  const inputRef = useRef(null)
  const [drag, setDrag] = useState(false)

  function readFile(file) {
    if (!file) return
    const reader = new FileReader()
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
