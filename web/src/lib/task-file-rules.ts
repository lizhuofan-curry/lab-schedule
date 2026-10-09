export const MAX_TASK_FILE_BYTES = 10 * 1024 * 1024;
export const TASK_FILE_ACCEPT =
  ".pdf,.txt,.md,.markdown,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv";
export function taskFilePreviewType(name: string): string | null {
  const types: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", txt: "text/plain; charset=utf-8", md: "text/plain; charset=utf-8", markdown: "text/plain; charset=utf-8" };
  return types[name.split(".").pop()?.toLowerCase() ?? ""] ?? null;
}
export function validateTaskFile(name: string, bytes: Uint8Array) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (!TASK_FILE_ACCEPT.split(",").includes(`.${ext}`))
    throw new Error(
      "不支持该文件类型，请使用PDF、文本、图片、Office或CSV文件。",
    );
  if (!bytes.length || bytes.length > MAX_TASK_FILE_BYTES)
    throw new Error("文件须非空且不超过10MB，请压缩文件或改用链接。");
  const starts = (...numbers: number[]) =>
    numbers.every((n, i) => bytes[i] === n);
  let valid = true;
  if (ext === "pdf") valid = starts(37, 80, 68, 70, 45);
  else if (ext === "png") valid = starts(137, 80, 78, 71, 13, 10, 26, 10);
  else if (["jpg", "jpeg"].includes(ext)) valid = starts(255, 216, 255);
  else if (["doc", "xls", "ppt"].includes(ext))
    valid = starts(208, 207, 17, 224, 161, 177, 26, 225);
  else if (["docx", "xlsx", "pptx"].includes(ext)) {
    const content = new TextDecoder("latin1").decode(bytes);
    valid =
      starts(80, 75, 3, 4) &&
      content.includes("[Content_Types].xml") &&
      content.includes(
        ext === "docx" ? "word/" : ext === "xlsx" ? "xl/" : "ppt/",
      );
  } else {
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      valid = !text.includes("\0");
    } catch {
      valid = false;
    }
  }
  if (!valid) throw new Error("文件内容与格式不符，请重新导出文件后上传。");
}
