"use client";

import { useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function TaskMarkdown({ text }: { text: string }) {
  return <div className="task-markdown"><Markdown remarkPlugins={[remarkGfm]} skipHtml
    urlTransform={(url) => /^(https?:\/\/|mailto:|\/[^/]|#)/i.test(url) ? url : ""}
    components={{
      a: ({ href, children }) => href ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>,
      img: ({ alt }) => <span className="task-muted">{alt || "图片"}（请作为任务资料上传后查看）</span>,
      table: ({ children }) => <div className="task-markdown-table"><table>{children}</table></div>,
    }}>{text}</Markdown></div>;
}

export function TaskMarkdownEditor({
  value,
  onChange,
  label = "共同要求",
  fieldLabel = label,
  required = true,
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  fieldLabel?: string;
  required?: boolean;
}) {
  const [preview, setPreview] = useState(false);
  return <div className="task-markdown-editor">
    <span className="task-field-label">{fieldLabel}</span>
    <div className="task-markdown-toolbar">
      <div role="group" aria-label={`${label}编辑模式`}>
        <button type="button" aria-pressed={!preview} onClick={() => setPreview(false)}>编辑</button>
        <button type="button" aria-pressed={preview} onClick={() => setPreview(true)}>预览</button>
      </div>
    </div>
    <textarea aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}
      maxLength={20000} rows={required ? 8 : 3} required={required} hidden={preview}
      onInvalid={() => setPreview(false)} placeholder={required ? "填写共同要求…" : "填写分工…"} />
    {preview && <div className="task-markdown-editor-preview" role="region" aria-label={`${label}预览`}>
      {value.trim() ? <TaskMarkdown text={value} /> : <p className="task-muted">输入内容后即可预览。</p>}
    </div>}
    <small>支持 Markdown。{value.length}/20000</small>
  </div>;
}
