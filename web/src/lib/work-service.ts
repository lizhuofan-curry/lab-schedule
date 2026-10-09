import "server-only";
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  lte,
  or,
  sql,
  type SQLWrapper,
} from "drizzle-orm";
import { db } from "@/db";
import {
  collabTasks,
  memberWorkRecords,
  students,
  taskParticipants,
  taskRounds,
  taskSubmissions,
} from "@/db/schema";
import type { CurrentMember } from "./server-auth";
import { TaskError, syncActiveTasks } from "./task-service";
import { lockTaskGraph, type TaskTx } from "./task-lock";
import { taskSubject } from "./task-rules";
import { RECENT_WORK_MS, workCompletionTime } from "./work-rules";
import {
  workCursorSchema,
  type workCreateSchema,
  type workUpdateSchema,
} from "./work-schema";
import type { z } from "zod";

const PAGE_SIZE = 50;
type Cursor = z.infer<typeof workCursorSchema>;
type Work = typeof memberWorkRecords.$inferSelect;
function cursorValue(raw?: string): Cursor | undefined {
  if (!raw) return undefined;
  try {
    if (raw.length > 240 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error();
    return workCursorSchema.parse(
      JSON.parse(Buffer.from(raw, "base64url").toString("utf8")),
    );
  } catch {
    throw new TaskError(
      "INVALID_CURSOR",
      "分页信息无效，请刷新成员页面后重试。",
    );
  }
}
function nextCursor(at: string, id: number) {
  return Buffer.from(JSON.stringify({ at, id })).toString("base64url");
}
function before(updated: SQLWrapper, id: SQLWrapper, cursor?: Cursor) {
  return cursor
    ? sql`(${updated}, ${id}) < (${cursor.at}::timestamptz, ${cursor.id})`
    : undefined;
}
async function actorValid(tx: TaskTx, actor: CurrentMember) {
  const [row] = await tx
    .select({ id: students.id })
    .from(students)
    .where(
      and(
        eq(students.id, actor.studentId),
        eq(students.userId, actor.userId),
        eq(students.enabled, true),
      ),
    )
    .for("share");
  if (!row)
    throw new TaskError(
      "UNAUTHORIZED",
      "账号不可用，请重新登录或联系项目维护者。",
      401,
    );
}
async function studentValid(tx: TaskTx, studentId: number) {
  const [row] = await tx
    .select({ id: students.id })
    .from(students)
    .where(and(eq(students.id, studentId), eq(students.enabled, true)));
  if (!row)
    throw new TaskError(
      "STUDENT_NOT_FOUND",
      "成员不存在或已停用，请重新选择成员。",
      404,
    );
}
async function ownRecord(
  tx: TaskTx,
  id: number,
  actor: CurrentMember,
  lock = false,
) {
  const query = tx
    .select()
    .from(memberWorkRecords)
    .where(eq(memberWorkRecords.id, id));
  const [record] = await (lock ? query.for("update") : query);
  if (!record)
    throw new TaskError(
      "WORK_NOT_FOUND",
      "工作记录已删除，请刷新后查看。",
      404,
    );
  if (record.studentId !== actor.studentId)
    throw new TaskError("FORBIDDEN_OWNER", "只能管理自己的工作记录。", 403);
  return record;
}
function checkRevision(record: Work, revision: number) {
  if (record.revision !== revision)
    throw new TaskError(
      "STALE_REVISION",
      "记录已发生变化，请刷新后重新编辑或删除。",
      409,
    );
}
export async function listMemberWork(
  studentId: number,
  actor: CurrentMember,
  scope: "recent" | "all" = "recent",
  rawCursor?: string,
  now = new Date(),
) {
  if (scope === "all" && studentId !== actor.studentId)
    throw new TaskError(
      "FORBIDDEN_OWNER",
      "只能查看本人全部工作记录；查看其他成员请使用近期范围。",
      403,
    );
  const cursor = cursorValue(rawCursor);
  return db.transaction(async (tx) => {
    await actorValid(tx, actor);
    await studentValid(tx, studentId);
    const rows = await tx
      .select()
      .from(memberWorkRecords)
      .where(
        and(
          eq(memberWorkRecords.studentId, studentId),
          scope === "recent"
            ? or(
                inArray(memberWorkRecords.status, ["active", "paused"]),
                and(
                  eq(memberWorkRecords.status, "completed"),
                  gte(
                    memberWorkRecords.completedAt,
                    new Date(now.getTime() - RECENT_WORK_MS),
                  ),
                  lte(memberWorkRecords.completedAt, now),
                ),
              )
            : undefined,
          before(memberWorkRecords.updatedAt, memberWorkRecords.id, cursor),
        ),
      )
      .orderBy(desc(memberWorkRecords.updatedAt), desc(memberWorkRecords.id))
      .limit(PAGE_SIZE + 1);
    const records = rows.slice(0, PAGE_SIZE);
    const last = records.at(-1);
    return {
      records,
      scope,
      asOf: now.toISOString(),
      nextCursor:
        rows.length > PAGE_SIZE && last
          ? nextCursor(last.updatedAt.toISOString(), last.id)
          : null,
    };
  });
}
export async function getOwnWork(id: number, actor: CurrentMember) {
  return db.transaction(async (tx) => {
    await actorValid(tx, actor);
    return ownRecord(tx, id, actor);
  });
}
export async function createWork(
  input: z.infer<typeof workCreateSchema>,
  actor: CurrentMember,
) {
  return db.transaction(async (tx) => {
    await actorValid(tx, actor);
    const now = new Date();
    const [record] = await tx
      .insert(memberWorkRecords)
      .values({
        ...input,
        studentId: actor.studentId,
        completedAt: workCompletionTime(null, input.status, now),
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return record;
  });
}
export async function updateWork(
  id: number,
  input: z.infer<typeof workUpdateSchema>,
  actor: CurrentMember,
) {
  return db.transaction(async (tx) => {
    await actorValid(tx, actor);
    const record = await ownRecord(tx, id, actor, true);
    checkRevision(record, input.expectedRevision);
    const now = new Date();
    const [updated] = await tx
      .update(memberWorkRecords)
      .set({
        title: input.title,
        description: input.description,
        status: input.status,
        completedAt: workCompletionTime(record, input.status, now),
        updatedAt: now,
        revision: record.revision + 1,
      })
      .where(eq(memberWorkRecords.id, id))
      .returning();
    return updated;
  });
}
export async function deleteWork(
  id: number,
  revision: number,
  actor: CurrentMember,
) {
  return db.transaction(async (tx) => {
    await actorValid(tx, actor);
    const record = await ownRecord(tx, id, actor, true);
    checkRevision(record, revision);
    await tx.delete(memberWorkRecords).where(eq(memberWorkRecords.id, id));
    return { id };
  });
}
export async function listMemberTasks(
  studentId: number,
  actor: CurrentMember,
  rawCursor?: string,
  now = new Date(),
) {
  const cursor = cursorValue(rawCursor);
  return db.transaction(async (tx) => {
    await lockTaskGraph(tx);
    await actorValid(tx, actor);
    await studentValid(tx, studentId);
    await syncActiveTasks(tx);
    const rows = await tx
      .select({
        id: collabTasks.id,
        title: taskRounds.title,
        publisher: students.name,
        status: collabTasks.status,
        delivery: collabTasks.delivery,
        deadline: taskRounds.deadline,
        completedAt: taskRounds.endedAt,
        roundId: taskRounds.id,
        round: taskRounds.number,
        generation: taskParticipants.generation,
        cursorAt: sql<string>`to_char(${collabTasks.updatedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      })
      .from(collabTasks)
      .innerJoin(
        taskRounds,
        and(
          eq(taskRounds.taskId, collabTasks.id),
          eq(taskRounds.number, collabTasks.currentRound),
        ),
      )
      .innerJoin(
        taskParticipants,
        and(
          eq(taskParticipants.roundId, taskRounds.id),
          eq(taskParticipants.studentId, studentId),
          eq(taskParticipants.active, true),
        ),
      )
      .innerJoin(students, eq(students.id, collabTasks.publisherId))
      .where(
        and(
          or(
            eq(collabTasks.status, "active"),
            and(
              eq(collabTasks.status, "completed"),
              gte(taskRounds.endedAt, new Date(now.getTime() - RECENT_WORK_MS)),
              lte(taskRounds.endedAt, now),
            ),
          ),
          before(collabTasks.updatedAt, collabTasks.id, cursor),
        ),
      )
      .orderBy(desc(collabTasks.updatedAt), desc(collabTasks.id))
      .limit(PAGE_SIZE + 1);
    const page = rows.slice(0, PAGE_SIZE);
    const submissions = page.length
      ? await tx
          .select({
            roundId: taskSubmissions.roundId,
            subjectKey: taskSubmissions.subjectKey,
            status: taskSubmissions.status,
          })
          .from(taskSubmissions)
          .where(
            inArray(
              taskSubmissions.roundId,
              page.map((r) => r.roundId),
            ),
          )
          .orderBy(desc(taskSubmissions.version))
      : [];
    const latest = new Map<string, (typeof submissions)[number]["status"]>();
    for (const s of submissions) {
      const key = `${s.roundId}:${s.subjectKey}`;
      if (!latest.has(key)) latest.set(key, s.status);
    }
    const tasks = page.map((r) => ({
      id: r.id,
      title: r.title,
      publisher: r.publisher,
      delivery: r.delivery,
      status:
        r.status === "completed" ? ("completed" as const) : ("active" as const),
      deadline: r.deadline,
      completedAt: r.status === "completed" ? r.completedAt : null,
      round: r.round,
      ownStatus:
        latest.get(
          `${r.roundId}:${taskSubject(r.delivery, studentId, r.generation)}`,
        ) ?? ("not_submitted" as const),
    }));
    const last = page.at(-1);
    return {
      tasks,
      asOf: now.toISOString(),
      nextCursor:
        rows.length > PAGE_SIZE && last
          ? nextCursor(last.cursorAt, last.id)
          : null,
    };
  });
}
