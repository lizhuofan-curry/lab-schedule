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

export function TaskMarkdownEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [preview, setPreview] = useState(false);
  return <div className="task-markdown-editor">
    <span className="task-field-label">任务要求</span>
    <div className="task-markdown-toolbar">
      <div role="group" aria-label="任务要求编辑模式">
        <button type="button" aria-pressed={!preview} onClick={() => setPreview(false)}>编辑</button>
        <button type="button" aria-pressed={preview} onClick={() => setPreview(true)}>预览</button>
      </div>
    </div>
    <textarea aria-label="任务要求" value={value} onChange={(e) => onChange(e.target.value)}
      maxLength={20000} rows={8} required hidden={preview}
      onInvalid={() => setPreview(false)} placeholder="填写任务要求…" />
    {preview && <div className="task-markdown-editor-preview" aria-label="任务要求预览">
      {value.trim() ? <TaskMarkdown text={value} /> : <p className="task-muted">输入任务要求后，可在这里预览。</p>}
    </div>}
    <small>使用 Markdown 编写任务要求。{value.length}/20000</small>
  </div>;
}
