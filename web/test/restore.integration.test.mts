import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { loadEnvFile } from "node:process";
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  copyFile,
  rm,
} from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
loadEnvFile(".env");
const password = process.env.POSTGRES_PASSWORD;
if (!password) throw new Error("缺少本地测试数据库配置。");
const container = process.env.RESTORE_TEST_CONTAINER;
if (container && !/^[a-f0-9]{12,64}$/.test(container))
  throw new Error("恢复测试容器标识无效。");
const dockerPrefix = container
  ? ["exec", "-i", container]
  : ["compose", "exec", "-T", "db"];
const options = {
  host: "127.0.0.1",
  port: 5433,
  username: "schedule",
  password,
  max: 1,
  prepare: false,
  onnotice: () => {},
};
const admin = postgres({ ...options, database: "postgres" });
const owned = new Set<string>();
const stamp =
  new Date().toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "T") +
  "Z";
let root = "",
  legacyFolder = "",
  counter = 0;
const url = (database: string) =>
  `postgresql://schedule:${encodeURIComponent(password)}@127.0.0.1:5433/${database}`;
const redacted = (value: string) =>
  value.replace(/postgres(?:ql)?:\/\/\S+/g, "[redacted]");
function pg(
  command: string,
  database: string,
  input?: Buffer,
  flags: string[] = [],
) {
  const result = spawnSync(
    "docker",
    [
      ...dockerPrefix,
      command,
      "--username=schedule",
      `--dbname=${database}`,
      ...flags,
    ],
    { input, maxBuffer: 12 * 1024 * 1024 },
  );
  assert.equal(
    result.status,
    0,
    redacted(result.stderr?.toString() ?? "数据库验证失败"),
  );
  return result.stdout;
}
async function newDatabase() {
  const name = `schedule_restore_${stamp}_${Date.now()}${counter++}`;
  assert.match(name, /^schedule_restore_\d{8}T\d{6}Z_\d+$/);
  await admin.unsafe(`CREATE DATABASE "${name}"`);
  owned.add(name);
  return { name, sql: postgres({ ...options, database: name }) };
}
function prepare(database: string, legacy = false, archive?: Buffer) {
  return spawnSync(
    process.execPath,
    ["scripts/prepare-restore.mjs", legacy ? "--legacy" : "--files"],
    {
      env: {
        ...process.env,
        DATABASE_URL: url(database),
        RESTORE_DATABASE: database,
      },
      input: archive,
      encoding: "buffer",
      maxBuffer: 5 * 1024 * 1024,
    },
  );
}
before(async () => {
  await mkdir("test-results", { recursive: true });
  root = await mkdtemp(path.resolve("test-results/restore-test-"));
  legacyFolder = path.join(root, "legacy-migrations");
  await mkdir(path.join(legacyFolder, "meta"), { recursive: true });
  const journal = JSON.parse(
    await readFile("drizzle/meta/_journal.json", "utf8"),
  );
  journal.entries = journal.entries.filter((e: { idx: number }) => e.idx < 8);
  await writeFile(
    path.join(legacyFolder, "meta/_journal.json"),
    JSON.stringify(journal),
  );
  for (const e of journal.entries)
    await copyFile(
      `drizzle/${e.tag}.sql`,
      path.join(legacyFolder, `${e.tag}.sql`),
    );
});
after(async () => {
  for (const name of owned) {
    assert.match(name, /^schedule_restore_\d{8}T\d{6}Z_\d+$/);
    await admin.unsafe(`DROP DATABASE "${name}"`);
  }
  await admin.end();
  if (root) {
    const resolved = path.resolve(root);
    assert.ok(resolved.startsWith(path.resolve("test-results") + path.sep));
    await rm(resolved, { recursive: true, force: true });
  }
});
test("旧v1备份先在隔离库升级再恢复v2.1，账号课程小组保留且新业务结构完整", async () => {
  const source = await newDatabase(),
    staging = await newDatabase(),
    target = await newDatabase();
  try {
    await migrate(drizzle(source.sql), { migrationsFolder: legacyFolder });
    await source.sql`insert into "user"(id,name,email,username) values('restore-member','恢复成员','restore@members.local','restore-001')`;
    const [student] =
      await source.sql`insert into students(name,student_no,user_id) values('恢复成员','restore-001','restore-member') returning id`;
    const [semester] =
      await source.sql`insert into semesters(name,start_date,end_date,week_count,is_current) values('恢复学期','2026-09-01','2027-01-01',18,true) returning id`;
    const [group] =
      await source.sql`insert into groups(name,created_by_student_id) values('恢复小组',${student.id}) returning id`;
    await source.sql`insert into group_members(group_id,student_id,role) values(${group.id},${student.id},'leader')`;
    await source.sql`insert into courses(student_id,semester_id,name,weekday,start_period,end_period,weeks) values(${student.id},${semester.id},'恢复课程',1,1,2,array[1,3,5]::smallint[])`;
    const oldDump = pg("pg_dump", source.name, undefined, [
      "--format=custom",
      "--no-owner",
      "--no-privileges",
    ]);
    await migrate(drizzle(target.sql), { migrationsFolder: "drizzle" });
    pg("pg_restore", staging.name, oldDump, [
      "--no-owner",
      "--no-privileges",
      "--exit-on-error",
    ]);
    const prepared = prepare(staging.name, true);
    assert.equal(prepared.status, 0, redacted(prepared.stderr.toString()));
    assert.match(prepared.stdout.toString(), /RESTORE_STAGING_MIGRATED=1/);
    const fullDump = pg("pg_dump", staging.name, undefined, [
      "--format=custom",
      "--no-owner",
      "--no-privileges",
    ]);
    pg("pg_restore", target.name, fullDump, [
      "--clean",
      "--if-exists",
      "--no-owner",
      "--no-privileges",
      "--exit-on-error",
    ]);
    const [counts] =
      await target.sql`select (select count(*) from "user")::int as users,(select count(*) from students)::int as students,(select count(*) from courses)::int as courses,(select count(*) from groups)::int as groups,(select count(*) from member_work_records)::int as work,(select count(*) from collab_tasks)::int as tasks`;
    assert.deepEqual(counts, {
      users: 1,
      students: 1,
      courses: 1,
      groups: 1,
      work: 0,
      tasks: 0,
    });
    const [course] = await target.sql`select name,weeks from courses`;
    assert.equal(course.name, "恢复课程");
    assert.deepEqual(course.weeks, [1, 3, 5]);
    const rejected = prepare(target.name, true);
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr.toString(), /必须提供.*整套备份/);
  } finally {
    await Promise.all([source.sql.end(), staging.sql.end(), target.sql.end()]);
  }
});
test("恢复预检识别损坏归档与非法路径，失败发生在停应用及覆盖数据库之前", async () => {
  for (const file of ["scripts/backup-db.sh", "scripts/restore-db.sh"]) {
    const syntax = spawnSync("docker", [...dockerPrefix, "sh", "-n"], {
      input: (await readFile(file, "utf8")).replace(/\r/g, ""),
      encoding: "utf8",
    });
    assert.equal(syntax.status, 0, syntax.stderr);
  }
  const script = (await readFile("scripts/restore-db.sh", "utf8")).replace(
    /\r/g,
    "",
  );
  const preflight = script.slice(
    script.indexOf('  case "$(basename "$CHECKSUM_FILE")"'),
    script.indexOf("  RESTORE_FILES=1"),
  );
  assert.ok(preflight.includes("ARCHIVE_PATHS=$(tar -tf"));
  const harness = `set -eu\nroot=$(mktemp -d)\ntrap 'rm -f "$root/schedule-test.dump" "$root/schedule-test.files.tar" "$root/schedule-test.sha256" "$root/bad" "$root/00000000-0000-4000-8000-000000000001"; rmdir "$root"' EXIT\ncd "$root"\nprintf db > schedule-test.dump\nBACKUP_FILE="$root/schedule-test.dump"\nFILES_FILE="$root/schedule-test.files.tar"\nCHECKSUM_FILE="$root/schedule-test.sha256"\n`;
  for (const [setup, expected] of [
    ["printf invalid > schedule-test.files.tar", /归档已损坏/],
    ["printf bad > bad; tar -cf schedule-test.files.tar bad", /非法路径/],
    [
      "ln -s /etc/passwd 00000000-0000-4000-8000-000000000001; tar -cf schedule-test.files.tar ./00000000-0000-4000-8000-000000000001",
      /不允许链接/,
    ],
  ] as const) {
    const result = spawnSync("docker", [...dockerPrefix, "sh"], {
      input: `${harness}${setup}\nsha256sum schedule-test.dump schedule-test.files.tar > schedule-test.sha256\n${preflight}\necho DATABASE_MUTATION_REACHED\n`,
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, expected);
    assert.doesNotMatch(result.stdout, /DATABASE_MUTATION_REACHED/);
  }
  const valid = spawnSync("docker", [...dockerPrefix, "sh"], {
    input: `${harness}printf valid > 00000000-0000-4000-8000-000000000001\ntar -cf schedule-test.files.tar ./00000000-0000-4000-8000-000000000001\nsha256sum schedule-test.dump schedule-test.files.tar > schedule-test.sha256\n${preflight}\necho VALID_ARCHIVE_ACCEPTED\n`,
    encoding: "utf8",
  });
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, /VALID_ARCHIVE_ACCEPTED/);
});

test("隔离恢复预检验证附件内容，损坏或缺失拒绝，正确归档通过", async () => {
  const staging = await newDatabase();
  const folder = path.join(root, "attachments");
  await mkdir(folder, { recursive: true });
  const id = randomUUID(), content = Buffer.from("恢复附件内容\n");
  await writeFile(path.join(folder, id), content);
  const archive = spawnSync("tar", ["-cf", "-", "-C", folder, "."], { maxBuffer: 1024 * 1024 });
  assert.equal(archive.status, 0, archive.stderr.toString());
  try {
    await migrate(drizzle(staging.sql), { migrationsFolder: "drizzle" });
    const [student] = await staging.sql`insert into students(name,student_no) values('附件恢复成员','restore-files') returning id`;
    await staging.sql`insert into task_files(id,creator_id,name,size,sha256) values(${id},${student.id},'说明.txt',${content.length},${"0".repeat(64)})`;
    const mismatch = prepare(staging.name, false, archive.stdout);
    assert.notEqual(mismatch.status, 0);
    assert.match(mismatch.stderr.toString(), /SHA-256校验失败/);
    await staging.sql`update task_files set sha256=${createHash("sha256").update(content).digest("hex")} where id=${id}`;
    const valid = prepare(staging.name, false, archive.stdout);
    assert.equal(valid.status, 0, redacted(valid.stderr.toString()));
    assert.match(valid.stdout.toString(), /TASK_FILES_VERIFIED=1/);
    assert.match(valid.stdout.toString(), /RESTORE_STAGING_MIGRATED=1/);
    // An interrupted deletion may have no bytes; it is neither downloadable nor
    // bindable and must not prevent the rest of a consistent backup restoring.
    await staging.sql`insert into task_files(id,creator_id,name,size,sha256,deleting_at) values(${randomUUID()},${student.id},'待清理.txt',3,${"0".repeat(64)},now())`;
    const pending = prepare(staging.name, false, archive.stdout);
    assert.equal(pending.status, 0, redacted(pending.stderr.toString()));
    assert.match(pending.stdout.toString(), /TASK_FILES_VERIFIED=1/);
    const missing = prepare(staging.name, false, Buffer.from("invalid tar"));
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr.toString(), /无法提取/);
  } finally {
    await staging.sql.end();
  }
});

test("恢复重启：启动失败、健康失败或超时非零退出，原本停止的应用不启动", async () => {
  const script = (await readFile("scripts/restore-db.sh", "utf8")).replace(/\r/g, "");
  const restart = script.slice(script.indexOf("restart_app() {"), script.indexOf("RESTORE_STARTED=0"));
  for (const [mode, running, success, message] of [
    ["start-failed", "container", false, /启动失败/],
    ["unhealthy", "container", false, /健康检查失败/],
    ["starting", "container", false, /健康检查超时/],
    ["stopped", "container", false, /健康检查失败/],
    ["healthy", "container", true, /HEALTH_VERIFIED/],
    ["start-failed", "", true, /HEALTH_VERIFIED/],
  ] as const) {
    const mock = `set -eu\nAPP_WAS_RUNNING='${running}'\nMODE='${mode}'\ndocker() {\n case "$*" in\n 'compose start app') echo APP_START_CALLED >&2; if [ "$MODE" = start-failed ]; then return 17; fi ;;\n 'compose ps -q app') echo container ;;\n inspect*) echo "$MODE" ;;\n *) return 99 ;;\n esac\n}\nsleep() { :; }\n`;
    const result = spawnSync("docker", [...dockerPrefix, "sh"], { input: `${mock}${restart}\nrestart_app\necho HEALTH_VERIFIED\n`, encoding: "utf8" });
    if (success) assert.equal(result.status, 0, result.stderr);
    else { assert.notEqual(result.status, 0); assert.doesNotMatch(result.stdout, /HEALTH_VERIFIED/); }
    assert.match(result.stdout + result.stderr, message);
    if (!running) assert.doesNotMatch(result.stderr, /APP_START_CALLED/);
  }
});

test("恢复异常退出保留原错误码并区分数据失败和恢复后启动失败", async () => {
  const script = (await readFile("scripts/restore-db.sh", "utf8")).replace(/\r/g, "");
  const functions = script.slice(script.indexOf("restart_app() {"), script.indexOf("trap restore_exit EXIT"));
  for (const [ready, started, stopped, code, expected] of [
    [0, 1, 1, 23, /恢复未完成，应用保持停止/],
    [1, 1, 1, 17, /数据库和附件已恢复，但后续启动或清理失败/],
    [0, 0, 1, 1, /应用启动失败/],
    [0, 0, 1, 23, /应用启动失败/],
    [0, 0, 0, 23, /^$/],
  ] as const) {
    const result = spawnSync("docker", [...dockerPrefix, "sh"], {
      input: `set -eu\nAPP_WAS_RUNNING=container\nSTAGING_CREATED=0\nPREPARED_DUMP=/nonexistent-isolated-test-dump\ndocker() { if [ "$*" = 'compose start app' ]; then return 17; fi; return 99; }\n${functions}\nRESTORE_DATA_READY=${ready}\nRESTORE_STARTED=${started}\nAPP_STOPPED=${stopped}\ntrap restore_exit EXIT\nexit ${code}\n`, encoding: "utf8",
    });
    assert.equal(result.status, code, result.stderr);
    assert.match(result.stderr, expected);
    assert.doesNotMatch(result.stdout, /恢复完成/);
  }
});
