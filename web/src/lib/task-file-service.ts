import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, statfs, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CurrentMember } from "./server-auth";
import { fileRecord, saveFileRecord, markFileDeletion, finishFileDeletion, TaskError } from "./task-service";
import { validateTaskFile, taskFilePreviewType } from "./task-file-rules";

// Runtime uploads are private volume data, never bundled with application files.
function root() {
  return path.resolve(
    /* turbopackIgnore: true */ process.env.TASK_UPLOAD_DIR ||
      "data/task-files",
  );
}
function filePath(id: string) {
  if (!/^[a-f0-9-]{36}$/i.test(id))
    throw new TaskError("FILE_NOT_FOUND", "文件不存在，请返回任务详情。", 404);
  return path.join(/* turbopackIgnore: true */ root(), id);
}
function quota(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new TaskError(
      "STORAGE_FULL",
      "文件存储配置无效，请联系项目维护者。",
      507,
    );
  return value;
}
export async function uploadTaskFile(file: File, actor: CurrentMember) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const name = path
    .basename(file.name.replaceAll("\\", "/"))
    .replace(/[\x00-\x1f\x7f]/g, "")
    .slice(0, 180);
  try {
    validateTaskFile(name, bytes);
  } catch (error) {
    throw new TaskError("INVALID_FILE", (error as Error).message);
  }
  const id = randomUUID();
  const target = filePath(id);
  const userQuota = quota("TASK_USER_QUOTA_BYTES", 200 * 1024 * 1024);
  const totalQuota = quota("TASK_TOTAL_QUOTA_BYTES", 2 * 1024 * 1024 * 1024);
  await mkdir(root(), { recursive: true, mode: 0o700 });
  const fs = await statfs(root());
  if (Number(fs.bavail) * Number(fs.bsize) < bytes.length + 256 * 1024 * 1024)
    throw new TaskError(
      "STORAGE_FULL",
      "磁盘空间不足，请改用链接提交或联系项目维护者。",
      507,
    );
  await writeFile(target, bytes, { flag: "wx", mode: 0o600 });
  try {
    await saveFileRecord(
      {
        id,
        creatorId: actor.studentId,
        name,
        size: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      },
      userQuota,
      totalQuota,
    );
  } catch (error) {
    await unlink(target).catch(() => {});
    throw error;
  }
  return { id, name, size: bytes.length };
}
export async function deleteTaskFile(id: string, actor: CurrentMember) {
  const target = filePath(id);
  await markFileDeletion(id, actor);
  try {
    await unlink(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      throw new TaskError("FILE_DELETE_FAILED", "文件清理失败，额度尚未释放；请在未提交附件列表重试，持续失败请联系项目维护者。", 503);
  }
  await finishFileDeletion(id, actor);
}
export async function downloadTaskFile(id: string, actor: CurrentMember, preview = false) {
  const file = await fileRecord(id, actor);
  let bytes: Buffer;
  try {
    bytes = await readFile(/* turbopackIgnore: true */ filePath(id));
  } catch {
    throw new TaskError(
      "FILE_NOT_FOUND",
      "文件暂不可用，请联系发布者或项目维护者检查备份。",
      404,
    );
  }
  if (
    bytes.length !== file.size ||
    createHash("sha256").update(bytes).digest("hex") !== file.sha256
  )
    throw new TaskError(
      "FILE_CORRUPTED",
      "文件校验失败，请联系项目维护者恢复备份。",
      500,
    );
  const mime = preview ? taskFilePreviewType(file.name) : "application/octet-stream";
  if (!mime) throw new TaskError("FILE_PREVIEW_UNSUPPORTED", "该格式暂不支持站内预览，请下载后查看。", 422);
  if (preview && mime.startsWith("text/") && bytes.length > 256 * 1024)
    throw new TaskError("FILE_PREVIEW_TOO_LARGE", "文本较长，无法完整预览，请下载后查看。", 422);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": mime,
      "content-disposition": `${preview ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "content-length": String(file.size),
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
    },
  });
}
