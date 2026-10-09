import postgres from "postgres";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
if (!process.env.DATABASE_URL)
  throw new Error("缺少数据库配置，请配置后重试。");
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
const root = path.resolve(process.env.TASK_UPLOAD_DIR || "data/task-files");
try {
  const tables = await sql`select to_regclass('public.task_files') as name`;
  if (!tables[0].name) {
    console.log("TASK_FILES_VERIFIED=0 (v2迁移前)");
  } else {
    // Interrupted cleanup may have removed the bytes already. These rows cannot
    // be bound or downloaded and retain their quota until the owner retries.
    const [columns] = await sql`select exists(select 1 from information_schema.columns where table_schema='public' and table_name='task_files' and column_name='deleting_at') as deleting`;
    const files = columns.deleting
      ? await sql`select id,size,sha256 from task_files where deleting_at is null`
      : await sql`select id,size,sha256 from task_files`;
    for (const file of files) {
      if (!/^[a-f0-9-]{36}$/i.test(file.id))
        throw new Error("附件标识无效，请检查数据库备份。");
      const target = path.join(root, file.id);
      const info = await stat(target);
      if (info.size !== file.size)
        throw new Error(`附件大小校验失败：${file.id}`);
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(target)) hash.update(chunk);
      if (hash.digest("hex") !== file.sha256)
        throw new Error(`附件完整性校验失败：${file.id}`);
    }
    console.log(`TASK_FILES_VERIFIED=${files.length}`);
  }
} finally {
  await sql.end();
}
