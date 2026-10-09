import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const database = process.env.RESTORE_DATABASE;
if (!database || !/^schedule_restore_\d{8}T\d{6}Z_\d+$/.test(database))
  throw new Error("临时恢复库名称无效，已停止恢复。");
if (!process.env.DATABASE_URL) throw new Error("缺少数据库配置，已停止恢复。");
let url;
try {
  url = new URL(process.env.DATABASE_URL);
} catch {
  throw new Error("数据库配置格式无效，已停止恢复。");
}
url.pathname = `/${database}`;
const env = { ...process.env, DATABASE_URL: url.href };
const sql = postgres(url.href, { max: 1, prepare: false, onnotice: () => {} });
let root;
try {
  const [tables] =
    await sql`select to_regclass('public.collab_tasks') as tasks,to_regclass('public.task_files') as files`;
  if (process.argv.includes("--legacy") && (tables.tasks || tables.files))
    throw new Error(
      "该备份包含v2任务数据，必须提供数据库、附件和校验清单整套备份。",
    );
  await migrate(drizzle(sql), { migrationsFolder: "drizzle" });
  if (process.argv.includes("--files")) {
    root = await mkdtemp(path.join(tmpdir(), "schedule-restore-files-"));
    const extracted = spawnSync("tar", ["-xf", "-", "-C", root], {
      stdio: ["inherit", "ignore", "pipe"],
    });
    if (extracted.status !== 0)
      throw new Error("附件归档无法提取，正式数据库未修改，请检查备份。");
    const verified = spawnSync(
      process.execPath,
      ["scripts/verify-task-files.mjs"],
      {
        env: { ...env, TASK_UPLOAD_DIR: root },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    if (verified.status !== 0)
      throw new Error(
        "备份中的附件关联、大小或SHA-256校验失败，正式数据库未修改。",
      );
    process.stdout.write(verified.stdout);
  }
  console.log("RESTORE_STAGING_MIGRATED=1");
} catch (error) {
  console.error(
    error instanceof Error && !/postgres(?:ql)?:\/\//i.test(error.message)
      ? error.message
      : "临时恢复预检失败，请检查数据库备份和迁移文件。",
  );
  process.exitCode = 1;
} finally {
  await sql.end();
  if (root) await rm(root, { recursive: true, force: true });
}
