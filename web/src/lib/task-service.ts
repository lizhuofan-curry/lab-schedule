import "server-only";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm";
import { db } from "@/db";
import {
  auditLogs,
  collabTasks,
  groupMembers,
  groups,
  students,
  taskEvents,
  taskFiles,
  taskNotifications,
  taskParticipants,
  taskRounds,
  taskSubmissions,
} from "@/db/schema";
import type { CurrentMember } from "./server-auth";
import type { TaskCommand, TaskCreate } from "./task-schema";
import { lockTaskGraph, type TaskTx } from "./task-lock";
import { taskIsComplete, taskSubject } from "./task-rules";

type Task = typeof collabTasks.$inferSelect;
type Round = typeof taskRounds.$inferSelect;
type PersonalAssignments = Round["personalAssignments"];
type Participant = typeof taskParticipants.$inferSelect;
export class TaskError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 422,
  ) {
    super(message);
  }
}
function fail(code: string, message: string, status = 422): never {
  throw new TaskError(code, message, status);
}
async function validActor(tx: TaskTx, actor: CurrentMember) {
  const [row] = await tx
    .select({ id: students.id })
    .from(students)
    .where(
      and(
        eq(students.id, actor.studentId),
        eq(students.userId, actor.userId),
        eq(students.enabled, true),
      ),
    );
  if (!row)
    fail("UNAUTHORIZED", "账号不可用，请重新登录或联系项目维护者。", 401);
}
async function current(tx: TaskTx, id: number) {
  const [task] = await tx
    .select()
    .from(collabTasks)
    .where(eq(collabTasks.id, id));
  if (!task) fail("TASK_NOT_FOUND", "任务不存在，请返回任务列表。", 404);
  const [round] = await tx
    .select()
    .from(taskRounds)
    .where(
      and(eq(taskRounds.taskId, id), eq(taskRounds.number, task.currentRound)),
    );
  if (!round) fail("TASK_NOT_FOUND", "任务轮次不存在，请联系项目维护者。", 404);
  return { task, round };
}
async function participants(tx: TaskTx, roundId: number) {
  return tx
    .select()
    .from(taskParticipants)
    .where(eq(taskParticipants.roundId, roundId))
    .orderBy(asc(taskParticipants.id));
}
async function notify(
  tx: TaskTx,
  task: Task,
  round: Round,
  recipients: number[],
  message: string,
  assignment = false,
) {
  const unique = [...new Set(recipients)];
  if (unique.length)
    await tx.insert(taskNotifications).values(
      unique.map((recipientId) => ({
        recipientId,
        taskId: task.id,
        roundId: round.id,
        title: round.title,
        message,
        assignment,
      })),
    );
}
async function retireAssignments(
  tx: TaskTx,
  roundId: number,
  recipients: number[],
) {
  if (!recipients.length) return;
  await tx
    .update(taskNotifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(taskNotifications.roundId, roundId),
        inArray(taskNotifications.recipientId, recipients),
        eq(taskNotifications.assignment, true),
        isNull(taskNotifications.readAt),
      ),
    );
}
async function event(
  tx: TaskTx,
  task: Task,
  round: Round,
  actor: CurrentMember | null,
  action: string,
  detail: Record<string, unknown> = {},
) {
  await tx.insert(taskEvents).values({
    taskId: task.id,
    roundId: round.id,
    actorId: actor?.studentId ?? null,
    action,
    detail,
  });
  await tx.insert(auditLogs).values({
    actorUserId: actor?.userId ?? null,
    action: `task.${action}`,
    entityType: "task",
    entityId: String(task.id),
    after: JSON.stringify({ roundId: round.id, ...detail }),
  });
}
async function bump(tx: TaskTx, task: Task) {
  const [updated] = await tx
    .update(collabTasks)
    .set({ revision: task.revision + 1, updatedAt: new Date() })
    .where(eq(collabTasks.id, task.id))
    .returning();
  return updated;
}
async function resolveTargets(
  tx: TaskTx,
  directIds: number[],
  groupIds: number[],
  strict: boolean,
) {
  const available = await tx
    .select({ id: students.id, name: students.name })
    .from(students)
    .where(and(eq(students.enabled, true), isNotNull(students.userId)));
  const availableIds = new Set(available.map((s) => s.id));
  if (strict && directIds.some((id) => !availableIds.has(id)))
    fail("INVALID_TARGET", "部分成员尚未注册或已停用，请重新选择。");
  const selectedGroups = groupIds.length
    ? await tx
        .select({ id: groups.id, name: groups.name })
        .from(groups)
        .where(inArray(groups.id, groupIds))
    : [];
  if (strict && selectedGroups.length !== groupIds.length)
    fail("INVALID_TARGET", "部分小组已解散，请重新选择。");
  const memberships = selectedGroups.length
    ? await tx
        .select({ studentId: groupMembers.studentId, name: students.name, enabled: students.enabled, userId: students.userId })
        .from(groupMembers)
        .innerJoin(students, eq(students.id, groupMembers.studentId))
        .where(
          inArray(
            groupMembers.groupId,
            selectedGroups.map((g) => g.id),
          ),
        )
    : [];
  const ids = new Set([...directIds, ...memberships.map((m) => m.studentId)]);
  return {
    members: available.filter((s) => ids.has(s.id)),
    excluded: [...new Map(memberships.filter((m) => !availableIds.has(m.studentId)).map((m) => [m.studentId, { id: m.studentId, name: m.name, reason: m.enabled ? "未注册" : "已停用" }])).values()],
    groupNames: Object.fromEntries(
      selectedGroups.map((g) => [String(g.id), g.name]),
    ),
  };
}
function resolvePersonalAssignments(
  selectedIds: ReadonlySet<number>,
  input?: PersonalAssignments,
  previous: PersonalAssignments = [],
) {
  if (input?.some(({ studentId }) => !selectedIds.has(studentId)))
    fail("INVALID_TARGET", "请先选择要填写个人分工的成员。");
  return input ?? previous.filter(({ studentId }) => selectedIds.has(studentId));
}
function assignmentSnapshot(
  assignments: PersonalAssignments,
  members: { id: number; name: string }[],
) {
  const names = new Map(members.map(({ id, name }) => [id, name]));
  return assignments.map((entry) => ({ ...entry, name: names.get(entry.studentId) }));
}
function changedAssignmentIds(before: PersonalAssignments, after: PersonalAssignments) {
  const oldText = new Map(before.map(({ studentId, description }) => [studentId, description]));
  const newText = new Map(after.map(({ studentId, description }) => [studentId, description]));
  return new Set(
    [...oldText.keys(), ...newText.keys()].filter((id) => oldText.get(id) !== newText.get(id)),
  );
}
async function adjustParticipants(
  tx: TaskTx,
  round: Round,
  before: Participant[],
  desired: { id: number; name: string }[],
) {
  const desiredIds = new Set(desired.map((s) => s.id));
  const previous = new Map(before.map((p) => [p.studentId, p]));
  const removed = before.filter(
    (p) => p.active && !desiredIds.has(p.studentId),
  );
  const added = desired.filter((s) => !previous.get(s.id)?.active);
  if (removed.length)
    await tx
      .update(taskParticipants)
      .set({ active: false, removedAt: new Date() })
      .where(inArray(taskParticipants.id, removed.map(({ id }) => id)));
  for (const s of added) {
    const existing = previous.get(s.id);
    if (existing)
      await tx
        .update(taskParticipants)
        .set({
          active: true,
          generation: existing.generation + 1,
          name: s.name,
          joinedAt: new Date(),
          removedAt: null,
        })
        .where(eq(taskParticipants.id, existing.id));
    else
      await tx
        .insert(taskParticipants)
        .values({ roundId: round.id, studentId: s.id, name: s.name });
  }
  return { added, removed };
}
async function reconcile(
  tx: TaskTx,
  task: Task,
  round: Round,
  actor: CurrentMember | null = null,
  selectedMembers?: { id: number; name: string }[],
) {
  if (task.status !== "active") return;
  const before = await participants(tx, round.id);
  const desired = selectedMembers ?? (
    task.kind === "assigned"
      ? (await resolveTargets(tx, round.directIds, round.groupIds, false))
          .members
      : (
          await tx
            .select({ id: students.id, name: students.name })
            .from(students)
            .where(and(eq(students.enabled, true), isNotNull(students.userId)))
        ).filter((s) => before.some((p) => p.active && p.studentId === s.id))
  );
  const { added, removed } = await adjustParticipants(tx, round, before, desired);
  if (removed.length || added.length) {
    const removedIds = new Set(removed.map((p) => p.studentId));
    const removedAssignments = round.personalAssignments.filter(({ studentId }) =>
      removedIds.has(studentId),
    );
    const directIds = task.kind === "announcement"
      ? round.directIds.filter((id) => !removedIds.has(id))
      : round.directIds;
    if (removedAssignments.length || directIds.length !== round.directIds.length)
      await tx.update(taskRounds)
        .set({
          directIds,
          personalAssignments: round.personalAssignments.filter(({ studentId }) =>
            !removedIds.has(studentId),
          ),
        })
        .where(eq(taskRounds.id, round.id));
    await retireAssignments(tx, round.id, [...removedIds]);
    const removedMembers = removed.map((p) => ({ id: p.studentId, name: p.name }));
    await event(tx, task, round, actor, "members", {
      added: added.map((s) => ({ id: s.id, name: s.name })),
      removed: removedMembers,
      ...(removedAssignments.length ? {
        before: { personalAssignments: assignmentSnapshot(removedAssignments, removedMembers) },
        after: { personalAssignments: [] },
      } : {}),
    });
    await notify(
      tx,
      task,
      round,
      added.map((s) => s.id),
      "你被指派到这项任务，请查看任务要求。",
      true,
    );
    await notify(
      tx,
      task,
      round,
      [...removedIds],
      "你已不再承担这项任务，历史成果保留。",
    );
    await notify(
      tx,
      task,
      round,
      [task.publisherId],
      "任务执行名单已更新，请查看当前成员。",
    );
    task = await bump(tx, task);
  }
  if (removed.length || added.length) await completeIfReady(tx, task, round);
}
async function completeIfReady(tx: TaskTx, task: Task, round: Round) {
  if (task.status !== "active") return;
  const active = (await participants(tx, round.id)).filter((p) => p.active);
  const versions = await tx
    .select()
    .from(taskSubmissions)
    .where(eq(taskSubmissions.roundId, round.id))
    .orderBy(desc(taskSubmissions.version));
  const latest = new Map<string, typeof taskSubmissions.$inferSelect>();
  for (const v of versions)
    if (!latest.has(v.subjectKey)) latest.set(v.subjectKey, v);
  const approved = new Set(
    [...latest.values()]
      .filter((v) => v.status === "approved")
      .map((v) => v.subjectKey),
  );
  if (
    taskIsComplete(
      task.kind,
      round.claimsOpen,
      task.delivery,
      active.map((p) => taskSubject(task.delivery, p.studentId, p.generation)),
      approved,
    )
  ) {
    await tx
      .update(collabTasks)
      .set({
        status: "completed",
        revision: task.revision + 1,
        updatedAt: new Date(),
      })
      .where(eq(collabTasks.id, task.id));
    await tx
      .update(taskRounds)
      .set({ outcome: "completed", endedAt: new Date() })
      .where(eq(taskRounds.id, round.id));
    await event(tx, task, round, null, "completed");
    await notify(
      tx,
      task,
      round,
      [task.publisherId, ...active.map((p) => p.studentId)],
      "本轮任务已完成，所有所需成果已通过验收。",
    );
  }
}
export async function syncActiveTasks(
  tx: TaskTx,
  actor: CurrentMember | null = null,
) {
  const active = await tx
    .select()
    .from(collabTasks)
    .where(eq(collabTasks.status, "active"))
    .orderBy(asc(collabTasks.id));
  for (const task of active) {
    const [round] = await tx
      .select()
      .from(taskRounds)
      .where(
        and(
          eq(taskRounds.taskId, task.id),
          eq(taskRounds.number, task.currentRound),
        ),
      );
    if (round) await reconcile(tx, task, round, actor);
  }
}
async function sync(id?: number) {
  await db.transaction(async (tx) => {
    await lockTaskGraph(tx);
    if (id) {
      const state = await current(tx, id);
      await reconcile(tx, state.task, state.round);
    } else await syncActiveTasks(tx);
  });
}
async function bindFiles(
  tx: TaskTx,
  ids: string[],
  actor: CurrentMember,
  taskId: number,
) {
  if (!ids.length) return;
  const files = await tx
    .select()
    .from(taskFiles)
    .where(inArray(taskFiles.id, ids));
  if (
    files.length !== ids.length ||
    files.some(
      (f) =>
        f.deletingAt !== null || (f.taskId !== taskId &&
        (f.taskId !== null || f.creatorId !== actor.studentId)),
    )
  )
    fail("INVALID_FILE", "附件不存在或不属于本次任务，请重新上传。");
  await tx.update(taskFiles).set({ taskId }).where(inArray(taskFiles.id, ids));
}
function roundRequirements(round: Round) {
  return {
    title: round.title,
    description: round.description,
    deadline: round.deadline,
    capacity: round.capacity,
    fileIds: round.fileIds,
    claimsOpen: round.claimsOpen,
  };
}
async function updateTask(
  tx: TaskTx,
  task: Task,
  round: Round,
  command: Extract<TaskCommand, { action: "update" }>,
  actor: CurrentMember,
) {
  const { kind, delivery, capacity, groupIds } = command;
  const kindChanged = task.kind !== kind;
  const settingsChanged = kindChanged || task.delivery !== delivery;
  if (kind === "announcement" && groupIds.length)
    fail("INVALID_TARGET", "公告任务只能选择个人，请移除目标小组。");
  if (kind === "assigned" && capacity !== null)
    fail("INVALID_TASK", "指定任务不能设置人数上限，请清空人数上限。");

  const existing = await participants(tx, round.id);
  const active = existing.filter((p) => p.active);
  const activeIds = new Set(active.map((p) => p.studentId));
  const previousDirectIds = new Set(round.directIds);
  const targets = await resolveTargets(tx, command.directIds, groupIds, false);
  const targetIds = new Set(targets.members.map(({ id }) => id));
  const preservingAssignedTargets = kind === "assigned" && !kindChanged;
  if (command.directIds.some((id) => !targetIds.has(id) && !(preservingAssignedTargets && previousDirectIds.has(id))))
    fail("INVALID_TARGET", "部分成员尚未注册或已停用，请重新选择。");
  if (groupIds.some((id) => !Object.hasOwn(targets.groupNames, id) && !(preservingAssignedTargets && round.groupIds.includes(id))))
    fail("INVALID_TARGET", "部分小组已解散，请重新选择。");
  if (kindChanged && kind === "assigned" && !targets.members.length)
    fail("INVALID_TARGET", "改为指定任务前，请选择可执行的成员或小组。");
  if (capacity !== null && targets.members.length > capacity)
    fail("CLAIM_FULL", "执行人数超过上限，请先调高上限。", 409);

  const selectedIds = new Set(command.directIds.filter((id) => targetIds.has(id)));
  const personalAssignments = resolvePersonalAssignments(selectedIds, command.personalAssignments, round.personalAssignments);
  const groupNames = Object.fromEntries(groupIds.map((id) => [String(id), targets.groupNames[id] ?? round.groupNames[id]]).filter(([, name]) => name !== undefined));
  const directIds = kind === "announcement" && !kindChanged
    // Active claimants appear in the selection while retaining their original source.
    ? command.directIds.filter((id) => previousDirectIds.has(id) || !activeIds.has(id))
    : command.directIds;
  const values = {
    kind, delivery, directIds, groupIds, groupNames, personalAssignments,
    title: command.title,
    description: command.description,
    deadline: command.deadline ? new Date(command.deadline) : null,
    capacity,
    fileIds: command.fileIds,
    claimsOpen: kind === "announcement" && (kindChanged || round.claimsOpen),
  };

  const firstSubmission = settingsChanged ? await tx.select({ id: taskSubmissions.id })
    .from(taskSubmissions).where(eq(taskSubmissions.roundId, round.id)).limit(1) : [];
  const startsNewRound = firstSubmission.length > 0;
  if (startsNewRound && !command.confirmNewRound)
    fail("CONFIRM_NEW_ROUND", "本轮已有成果。请确认开启新一轮后再保存变更。", 409);
  await bindFiles(tx, values.fileIds, actor, task.id);
  if (settingsChanged) {
    // Older application versions can leave snapshots empty. Record their configuration before changing it.
    await tx.update(taskRounds).set({
      kind: sql`coalesce(${taskRounds.kind}, ${task.kind})`,
      delivery: sql`coalesce(${taskRounds.delivery}, ${task.delivery})`,
    }).where(and(eq(taskRounds.taskId, task.id), or(isNull(taskRounds.kind), isNull(taskRounds.delivery))));
  }

  let updatedRound: Round;
  let newParticipants: { id: number; name: string }[];
  let removedParticipants: Participant[];
  if (startsNewRound) {
    await tx.update(taskRounds).set({ claimsOpen: false, endedAt: new Date(), outcome: "superseded" })
      .where(eq(taskRounds.id, round.id));
    [updatedRound] = await tx.insert(taskRounds)
      .values({ ...values, taskId: task.id, number: round.number + 1 }).returning();
    newParticipants = targets.members;
    removedParticipants = active.filter((p) => !targetIds.has(p.studentId));
    if (newParticipants.length)
      await tx.insert(taskParticipants).values(newParticipants.map(({ id, name }) => ({
        studentId: id, name, roundId: updatedRound.id,
      })));
    await event(tx, task, round, actor, "superseded", { nextRound: updatedRound.number });
  } else {
    [updatedRound] = await tx.update(taskRounds).set(values)
      .where(eq(taskRounds.id, round.id)).returning();
    const { added, removed } = await adjustParticipants(tx, updatedRound, existing, targets.members);
    newParticipants = added;
    removedParticipants = removed;
    await retireAssignments(tx, round.id, removed.map((p) => p.studentId));
  }
  const [updatedTask] = await tx.update(collabTasks).set({
    kind, delivery, currentRound: updatedRound.number, revision: task.revision + 1, updatedAt: new Date(),
  }).where(eq(collabTasks.id, task.id)).returning();

  const changedIds = changedAssignmentIds(round.personalAssignments, updatedRound.personalAssignments);
  const beforeMembers = active.map((p) => ({ id: p.studentId, name: p.name }));
  const before = roundRequirements(round);
  const after = roundRequirements(updatedRound);
  await event(tx, updatedTask, updatedRound, actor, "edited", {
    ...(startsNewRound ? { previousRound: round.number } : {}),
    before: {
      ...before, kind: task.kind, delivery: task.delivery, groupNames: round.groupNames, members: beforeMembers,
      ...(changedIds.size ? { personalAssignments: assignmentSnapshot(round.personalAssignments.filter(({ studentId }) => changedIds.has(studentId)), beforeMembers) } : {}),
    },
    after: {
      ...after, kind, delivery, groupNames, members: targets.members, excluded: targets.excluded,
      ...(changedIds.size ? { personalAssignments: assignmentSnapshot(personalAssignments.filter(({ studentId }) => changedIds.has(studentId)), targets.members) } : {}),
    },
  });
  await notify(tx, updatedTask, updatedRound, newParticipants.map(({ id }) => id), startsNewRound
    ? "发布者开启了新一轮，请查看本轮要求并重新提交成果。"
    : "你被加入任务，请查看任务要求。", true);
  await notify(tx, updatedTask, startsNewRound ? round : updatedRound, removedParticipants.map((p) => p.studentId), startsNewRound
    ? "任务已开启新一轮。你在原轮次的成果保留在历史中。"
    : "发布者将你移出了任务，已有成果保留为历史。");
  if (!startsNewRound) {
    const commonChanged = settingsChanged || JSON.stringify(before) !== JSON.stringify(after);
    await notify(tx, updatedTask, updatedRound, targets.members
      .filter(({ id }) => activeIds.has(id) && (commonChanged || changedIds.has(id))).map(({ id }) => id),
    commonChanged ? "发布者更新了任务要求，请查看变更记录。" : "发布者更新了你的个人分工，请查看任务详情。");
    await completeIfReady(tx, updatedTask, updatedRound);
  }
  return { id: task.id, memberCount: targets.members.length, excluded: targets.excluded };
}
export async function createTask(input: TaskCreate, actor: CurrentMember) {
  return db.transaction(async (tx) => {
    await lockTaskGraph(tx);
    await validActor(tx, actor);
    const targets = await resolveTargets(
      tx,
      input.directIds,
      input.groupIds,
      true,
    );
    if (input.kind === "assigned" && !targets.members.length)
      fail("INVALID_TARGET", "所选小组没有可执行的注册成员，请选择其他成员。");
    if (input.capacity !== null && input.directIds.length > input.capacity)
      fail("CLAIM_FULL", "当前成员超过人数上限，请先调高上限。", 409);
    const personalAssignments = resolvePersonalAssignments(
      new Set(input.directIds), input.personalAssignments,
    );
    const [task] = await tx
      .insert(collabTasks)
      .values({
        publisherId: actor.studentId,
        kind: input.kind,
        delivery: input.delivery,
      })
      .returning();
    await bindFiles(tx, input.fileIds, actor, task.id);
    const [round] = await tx
      .insert(taskRounds)
      .values({
        taskId: task.id,
        number: 1,
        kind: task.kind,
        delivery: task.delivery,
        title: input.title,
        description: input.description,
        personalAssignments,
        deadline: input.deadline ? new Date(input.deadline) : null,
        capacity: input.capacity,
        claimsOpen: input.kind === "announcement",
        directIds: input.directIds,
        groupIds: input.groupIds,
        groupNames: targets.groupNames,
        fileIds: input.fileIds,
      })
      .returning();
    if (input.kind === "announcement" && input.directIds.length) {
      await tx.insert(taskParticipants).values(
        targets.members.map((s) => ({
          roundId: round.id,
          studentId: s.id,
          name: s.name,
        })),
      );
      await notify(
        tx,
        task,
        round,
        targets.members.map((s) => s.id),
        "你被加入公告任务，请查看任务要求。",
        true,
      );
    } else await reconcile(tx, task, round, actor, targets.members);
    await event(tx, task, round, actor, "published", {
      title: round.title,
      description: round.description,
      ...(personalAssignments.length ? {
        personalAssignments: assignmentSnapshot(personalAssignments, targets.members),
      } : {}),
      fileIds: round.fileIds,
      excluded: targets.excluded,
      memberCount: targets.members.length,
    });
    return { id: task.id, memberCount: targets.members.length, excluded: targets.excluded };
  });
}
async function latestFor(tx: TaskTx, roundId: number, subjectKey: string) {
  const [latest] = await tx
    .select()
    .from(taskSubmissions)
    .where(
      and(
        eq(taskSubmissions.roundId, roundId),
        eq(taskSubmissions.subjectKey, subjectKey),
      ),
    )
    .orderBy(desc(taskSubmissions.version))
    .limit(1);
  return latest;
}
export async function commandTask(
  id: number,
  command: TaskCommand,
  actor: CurrentMember,
) {
  return db.transaction(async (tx) => {
    await lockTaskGraph(tx);
    await validActor(tx, actor);
    let targetReport: { memberCount: number; excluded: Awaited<ReturnType<typeof resolveTargets>>["excluded"] } | undefined;
    let { task, round } = await current(tx, id);
    await reconcile(tx, task, round, actor);
    ({ task, round } = await current(tx, id));
    const manage = !["claim", "submit"].includes(command.action);
    if (manage && task.publisherId !== actor.studentId)
      fail("FORBIDDEN_OWNER", "只有任务发布者可以执行此操作。", 403);
    if (
      "expectedRevision" in command &&
      task.revision !== command.expectedRevision
    )
      fail("STALE_REVISION", "任务已发生变化，请刷新后再操作。", 409);
    if (command.action === "reopen") {
      if (task.status === "active")
        fail("TASK_ACTIVE", "任务正在进行，无需重新开启。", 409);
      const sourceIds = task.kind === "assigned"
        ? round.directIds
        : (await participants(tx, round.id)).filter((p) => p.active).map((p) => p.studentId);
      const valid = await resolveTargets(
        tx,
        sourceIds,
        round.groupIds,
        false,
      );
      const validIds = new Set(valid.members.map((member) => member.id));
      const assignmentTargets = new Set(sourceIds);
      const directIds = task.kind === "assigned"
        ? round.directIds
        : round.directIds.filter((id) => validIds.has(id));
      const personalAssignments = round.personalAssignments.filter(({ studentId }) =>
        validIds.has(studentId) && assignmentTargets.has(studentId),
      );
      const [next] = await tx
        .insert(taskRounds)
        .values({
          taskId: id,
          number: task.currentRound + 1,
          kind: task.kind,
          delivery: task.delivery,
          title: round.title,
          description: round.description,
          personalAssignments,
          deadline: command.deadline ? new Date(command.deadline) : null,
          capacity: round.capacity,
          claimsOpen: task.kind === "announcement" && command.claimsOpen,
          directIds,
          groupIds: round.groupIds,
          groupNames: round.groupNames,
          fileIds: round.fileIds,
        })
        .returning();
      const [updated] = await tx
        .update(collabTasks)
        .set({
          status: "active",
          currentRound: next.number,
          revision: task.revision + 1,
          updatedAt: new Date(),
        })
        .where(eq(collabTasks.id, id))
        .returning();
      if (task.kind === "assigned") await reconcile(tx, updated, next, actor, valid.members);
      else {
        if (valid.members.length)
          await tx.insert(taskParticipants).values(
            valid.members.map((s) => ({
              roundId: next.id,
              studentId: s.id,
              name: s.name,
            })),
          );
        await notify(
          tx,
          updated,
          next,
          valid.members.map((s) => s.id),
          "任务重新开启，请为新一轮重新提交成果。",
          true,
        );
      }
      await event(tx, updated, next, actor, "reopened", {
        previousRound: round.number,
        ...(personalAssignments.length ? {
          personalAssignments: assignmentSnapshot(personalAssignments, valid.members),
        } : {}),
      });
      return { id };
    }
    // Retries of an already accepted submit request are safe even after completion.
    if (command.action === "submit") {
      const [duplicate] = await tx
        .select()
        .from(taskSubmissions)
        .innerJoin(taskRounds, eq(taskRounds.id, taskSubmissions.roundId))
        .where(
          and(
            eq(taskRounds.taskId, id),
            eq(taskSubmissions.roundId, command.roundId),
            eq(taskSubmissions.authorId, actor.studentId),
            eq(taskSubmissions.requestKey, command.requestKey),
          ),
        );
      if (duplicate) return { id, submissionId: duplicate.task_submissions.id };
    }
    if (task.status !== "active")
      fail("TASK_CLOSED", "本轮任务已结束，发布者重新开启后才能继续。", 409);
    if (command.action === "update")
      return updateTask(tx, task, round, command, actor);
    const active = (await participants(tx, round.id)).filter((p) => p.active);
    if (command.action === "claim") {
      if (task.kind !== "announcement" || !round.claimsOpen)
        fail("CLAIM_CLOSED", "任务不开放领取，请联系发布者。", 409);
      if (active.some((p) => p.studentId === actor.studentId)) return { id };
      if (round.capacity !== null && active.length >= round.capacity)
        fail("CLAIM_FULL", "任务名额已满，请选择其他任务。", 409);
      const existing = (await participants(tx, round.id)).find(
        (p) => p.studentId === actor.studentId,
      );
      if (existing)
        await tx
          .update(taskParticipants)
          .set({
            active: true,
            generation: existing.generation + 1,
            joinedAt: new Date(),
            removedAt: null,
          })
          .where(eq(taskParticipants.id, existing.id));
      else
        await tx.insert(taskParticipants).values({
          roundId: round.id,
          studentId: actor.studentId,
          name: actor.name,
        });
      await notify(
        tx,
        task,
        round,
        [task.publisherId],
        `${actor.name}领取了任务。`,
      );
      await event(tx, task, round, actor, "claimed", { name: actor.name });
    } else if (command.action === "edit") {
      if (task.kind === "assigned" && command.capacity !== null)
        fail("INVALID_TASK", "指定任务不能设置人数上限。");
      if (command.capacity !== null && command.capacity < active.length)
        fail("CLAIM_FULL", "人数上限不能低于当前人数。", 409);
      await bindFiles(tx, command.fileIds, actor, id);
      const [updated] = await tx
        .update(taskRounds)
        .set({
          title: command.title,
          description: command.description,
          deadline: command.deadline ? new Date(command.deadline) : null,
          capacity: command.capacity,
          fileIds: command.fileIds,
        })
        .where(eq(taskRounds.id, round.id))
        .returning();
      await event(tx, task, round, actor, "edited", {
        before: {
          title: round.title,
          description: round.description,
          deadline: round.deadline,
          capacity: round.capacity,
          fileIds: round.fileIds,
        },
        after: {
          title: updated.title,
          description: updated.description,
          deadline: updated.deadline,
          capacity: updated.capacity,
          fileIds: updated.fileIds,
        },
      });
      await notify(
        tx,
        task,
        updated,
        active.map((p) => p.studentId),
        "发布者更新了任务要求，请查看变更记录。",
      );
    } else if (command.action === "targets") {
      if (task.kind === "announcement" && command.groupIds.length)
        fail("INVALID_TARGET", "公告任务只能调整个人名单。");
      if (task.kind === "assigned" && command.capacity !== null)
        fail("INVALID_TASK", "指定任务不能设置人数上限。");
      const targets = await resolveTargets(
        tx,
        command.directIds,
        command.groupIds,
        true,
      );
      targetReport = { memberCount: targets.members.length, excluded: targets.excluded };
      if (
        command.capacity !== null &&
        targets.members.length > command.capacity
      )
        fail("CLAIM_FULL", "执行人数超过上限，请先调高上限。", 409);
      const selectedIds = new Set(command.directIds);
      const personalAssignments = resolvePersonalAssignments(
        selectedIds, command.personalAssignments, round.personalAssignments,
      );
      const changedIds = changedAssignmentIds(round.personalAssignments, personalAssignments);
      const activeIds = new Set(active.map((member) => member.studentId));
      const previousDirectIds = new Set(round.directIds);
      // The announcement editor includes claimants as well as manual targets.
      const directIds = task.kind === "assigned"
        ? command.directIds
        : command.directIds.filter((id) => previousDirectIds.has(id) || !activeIds.has(id));
      const [updated] = await tx
        .update(taskRounds)
        .set({
          directIds,
          groupIds: command.groupIds,
          groupNames: targets.groupNames,
          capacity: command.capacity,
          personalAssignments,
        })
        .where(eq(taskRounds.id, round.id))
        .returning();
      if (task.kind === "announcement") {
        for (const p of active.filter((p) => !selectedIds.has(p.studentId))) {
          await retireAssignments(tx, round.id, [p.studentId]);
          await tx
            .update(taskParticipants)
            .set({ active: false, removedAt: new Date() })
            .where(eq(taskParticipants.id, p.id));
          await notify(
            tx,
            task,
            round,
            [p.studentId],
            "发布者将你移出了任务，已有成果保留为历史。",
          );
        }
        for (const s of targets.members.filter(
          (s) => !activeIds.has(s.id),
        )) {
          const existing = (await participants(tx, round.id)).find(
            (p) => p.studentId === s.id,
          );
          if (existing)
            await tx
              .update(taskParticipants)
              .set({
                active: true,
                generation: existing.generation + 1,
                joinedAt: new Date(),
                removedAt: null,
              })
              .where(eq(taskParticipants.id, existing.id));
          else
            await tx
              .insert(taskParticipants)
              .values({ roundId: round.id, studentId: s.id, name: s.name });
          await notify(
            tx,
            task,
            updated,
            [s.id],
            "发布者将你加入任务，请查看要求。",
            true,
          );
        }
      } else await reconcile(tx, task, updated, actor, targets.members);
      const before = active.map((p) => ({ id: p.studentId, name: p.name }));
      const changedAssignmentsBefore = round.personalAssignments.filter(({ studentId }) => changedIds.has(studentId));
      const changedAssignmentsAfter = personalAssignments.filter(({ studentId }) => changedIds.has(studentId));
      await event(tx, task, round, actor, "targets", {
        before: {
          directIds: round.directIds,
          groupIds: round.groupIds,
          groupNames: round.groupNames,
          capacity: round.capacity,
          members: before,
          ...(changedIds.size ? {
            personalAssignments: assignmentSnapshot(changedAssignmentsBefore, before),
          } : {}),
        },
        after: {
          directIds,
          groupIds: command.groupIds,
          groupNames: targets.groupNames,
          capacity: command.capacity,
          members: targets.members,
          excluded: targets.excluded,
          ...(changedIds.size ? {
            personalAssignments: assignmentSnapshot(changedAssignmentsAfter, targets.members),
          } : {}),
        },
      });
      await notify(
        tx,
        task,
        updated,
        targets.members.filter(({ id }) => changedIds.has(id) && activeIds.has(id)).map(({ id }) => id),
        "发布者更新了你的个人分工，请查看任务详情。",
      );
    } else if (command.action === "close") {
      if (task.kind !== "announcement")
        fail("INVALID_COMMAND", "指定任务没有领取入口。");
      await tx
        .update(taskRounds)
        .set({ claimsOpen: false })
        .where(eq(taskRounds.id, round.id));
      await event(tx, task, round, actor, "claims_closed");
    } else if (command.action === "cancel") {
      await tx
        .update(collabTasks)
        .set({ status: "cancelled" })
        .where(eq(collabTasks.id, id));
      await tx
        .update(taskRounds)
        .set({ claimsOpen: false, endedAt: new Date(), outcome: "cancelled" })
        .where(eq(taskRounds.id, round.id));
      await notify(
        tx,
        task,
        round,
        active.map((p) => p.studentId),
        "发布者撤销了任务，已有成果保留。",
      );
      await event(tx, task, round, actor, "cancelled");
    } else if (command.action === "submit") {
      if (command.roundId !== round.id)
        fail("STALE_SUBMISSION", "任务已进入新一轮，请刷新后提交。", 409);
      const own = active.find((p) => p.studentId === actor.studentId);
      if (!own)
        fail(
          "FORBIDDEN_EXECUTOR",
          "你不是本轮执行成员，请联系发布者调整名单。",
          403,
        );
      if (!command.body && !command.links.length && !command.fileIds.length)
        fail("INVALID_SUBMISSION", "请填写汇报、链接或上传文件后提交。");
      const subjectKey = taskSubject(
        task.delivery,
        actor.studentId,
        own.generation,
      );
      const latest = await latestFor(tx, round.id, subjectKey);
      if (latest?.status === "approved")
        fail(
          "SUBMISSION_APPROVED",
          "本轮成果已通过，需要新成果时请联系发布者重新开启。",
          409,
        );
      if ((latest?.version ?? 0) !== command.expectedVersion)
        fail("STALE_SUBMISSION", "已有新的成果版本，请刷新后再提交。", 409);
      await bindFiles(tx, command.fileIds, actor, id);
      const [submission] = await tx
        .insert(taskSubmissions)
        .values({
          roundId: round.id,
          subjectKey,
          version: (latest?.version ?? 0) + 1,
          requestKey: command.requestKey,
          authorId: actor.studentId,
          authorName: actor.name,
          body: command.body,
          links: command.links,
          fileIds: command.fileIds,
        })
        .returning();
      await notify(
        tx,
        task,
        round,
        [task.publisherId],
        `${actor.name}提交了第${submission.version}版成果，请验收。`,
      );
      await event(tx, task, round, actor, "submitted", {
        submissionId: submission.id,
        version: submission.version,
        name: actor.name,
      });
    } else if (command.action === "review") {
      if (command.roundId !== round.id)
        fail("STALE_SUBMISSION", "不能验收旧轮次，请刷新。", 409);
      const [submission] = await tx
        .select()
        .from(taskSubmissions)
        .where(
          and(
            eq(taskSubmissions.id, command.submissionId),
            eq(taskSubmissions.roundId, round.id),
          ),
        );
      if (!submission)
        fail("SUBMISSION_NOT_FOUND", "成果不存在，请刷新。", 404);
      const latest = await latestFor(tx, round.id, submission.subjectKey);
      if (latest?.id !== submission.id || submission.status !== "pending")
        fail(
          "STALE_SUBMISSION",
          "成果版本或验收状态已变化，请刷新后验收最新版本。",
          409,
        );
      if (
        task.delivery === "individual" &&
        !active.some(
          (p) =>
            taskSubject(task.delivery, p.studentId, p.generation) ===
            submission.subjectKey,
        )
      )
        fail("STALE_SUBMISSION", "执行成员已移出，这份成果仅作历史保留。", 409);
      if (command.decision === "return" && !command.reason)
        fail("INVALID_REVIEW", "请填写打回原因，说明需要补充的内容。");
      await tx
        .update(taskSubmissions)
        .set({
          status: command.decision === "approve" ? "approved" : "returned",
          feedback: command.reason || null,
          reviewerId: actor.studentId,
          reviewedAt: new Date(),
        })
        .where(eq(taskSubmissions.id, submission.id));
      await notify(
        tx,
        task,
        round,
        task.delivery === "shared"
          ? active.map((p) => p.studentId)
          : [submission.authorId],
        command.decision === "approve"
          ? "成果已通过验收。"
          : `成果被打回：${command.reason}`,
      );
      await event(
        tx,
        task,
        round,
        actor,
        command.decision === "approve" ? "approved" : "returned",
        { submissionId: submission.id, reason: command.reason },
      );
    }
    const state = await current(tx, id);
    task = await bump(tx, state.task);
    await completeIfReady(tx, task, state.round);
    return { id, ...targetReport };
  });
}

export async function listTasks(guest: boolean, studentId?: number) {
  await sync();
  const rows = await db
    .select({
      task: collabTasks,
      round: {
        id: taskRounds.id,
        title: taskRounds.title,
        deadline: taskRounds.deadline,
        capacity: taskRounds.capacity,
        claimsOpen: taskRounds.claimsOpen,
        number: taskRounds.number,
      },
      publisher: students.name,
    })
    .from(collabTasks)
    .innerJoin(
      taskRounds,
      and(
        eq(taskRounds.taskId, collabTasks.id),
        eq(taskRounds.number, collabTasks.currentRound),
      ),
    )
    .innerJoin(students, eq(students.id, collabTasks.publisherId))
    .orderBy(desc(collabTasks.updatedAt));
  if (guest)
    return rows.map(({ task, round, publisher }) => ({
      id: task.id,
      title: round.title,
      publisher,
      deadline: round.deadline,
      status: task.status,
      kind: task.kind,
    }));
  const ps = rows.length
    ? await db
        .select()
        .from(taskParticipants)
        .where(
          inArray(
            taskParticipants.roundId,
            rows.map((r) => r.round.id),
          ),
        )
    : [];
  return rows.map(({ task, round, publisher }) => ({
    id: task.id,
    title: round.title,
    publisher,
    deadline: round.deadline,
    status: task.status,
    kind: task.kind,
    delivery: task.delivery,
    capacity: round.capacity,
    claimsOpen: round.claimsOpen,
    round: round.number,
    count: ps.filter((p) => p.roundId === round.id && p.active).length,
    mine: task.publisherId === studentId,
    executing: ps.some(
      (p) => p.roundId === round.id && p.active && p.studentId === studentId,
    ),
  }));
}
export async function taskDetail(id: number) {
  await sync(id);
  return db.transaction(async (tx) => {
    await lockTaskGraph(tx);
    const { task, round: currentRound } = await current(tx, id);
    const rounds = await tx
      .select()
      .from(taskRounds)
      .where(eq(taskRounds.taskId, id))
      .orderBy(desc(taskRounds.number));
    const roundIds = rounds.map((r) => r.id);
    const [publisher] = await tx
      .select({ name: students.name })
      .from(students)
      .where(eq(students.id, task.publisherId));
    const members = await tx
      .select()
      .from(taskParticipants)
      .where(inArray(taskParticipants.roundId, roundIds))
      .orderBy(asc(taskParticipants.id));
    const submissions = await tx
      .select()
      .from(taskSubmissions)
      .where(inArray(taskSubmissions.roundId, roundIds))
      .orderBy(desc(taskSubmissions.id));
    const events = await tx
      .select()
      .from(taskEvents)
      .where(eq(taskEvents.taskId, id))
      .orderBy(desc(taskEvents.id));
    const files = await tx
      .select({ id: taskFiles.id, name: taskFiles.name, size: taskFiles.size })
      .from(taskFiles)
      .where(eq(taskFiles.taskId, id));
    return {
      ...task,
      publisher: publisher.name,
      targetExclusions: task.status === "active" && task.kind === "assigned" ? (await resolveTargets(tx, currentRound.directIds, currentRound.groupIds, false)).excluded : [],
      rounds: rounds.map((r) => ({ ...r, kind: r.kind ?? task.kind, delivery: r.delivery ?? task.delivery })),
      members,
      submissions,
      events,
      files,
    };
  });
}
export type TaskDetail = Awaited<ReturnType<typeof taskDetail>>;
export async function taskOptions() {
  const members = await db
    .select({
      id: students.id,
      name: students.name,
      studentNoSuffix: sql<string | null>`
        case when count(*) over (partition by ${students.name}) > 1
          then right(${students.studentNo}, 4)
        end`,
    })
    .from(students)
    .where(and(eq(students.enabled, true), isNotNull(students.userId)))
    .orderBy(asc(students.name));
  const gs = await db
    .select({ id: groups.id, name: groups.name })
    .from(groups)
    .orderBy(asc(groups.name));
  const memberships = await db.select({ groupId: groupMembers.groupId, id: students.id, name: students.name, enabled: students.enabled, userId: students.userId }).from(groupMembers).innerJoin(students, eq(students.id, groupMembers.studentId));
  return { members, groups: gs.map((g) => {
    const people = memberships.filter((m) => m.groupId === g.id);
    return { ...g, members: people.filter((m) => m.enabled && m.userId !== null).map(({ id, name }) => ({ id, name })), excluded: people.filter((m) => !m.enabled || m.userId === null).map((m) => ({ id: m.id, name: m.name, reason: m.enabled ? "未注册" : "已停用" })) };
  }) };
}
export async function notifications(actor: CurrentMember, before?: number) {
  await sync();
  const messages = await db
    .select()
    .from(taskNotifications)
    .where(
      and(
        eq(taskNotifications.recipientId, actor.studentId),
        before ? lt(taskNotifications.id, before) : undefined,
      ),
    )
    .orderBy(desc(taskNotifications.id))
    .limit(200);
  const active = await db
    .select({
      taskId: collabTasks.id,
      roundId: taskRounds.id,
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
        eq(taskParticipants.studentId, actor.studentId),
        eq(taskParticipants.active, true),
      ),
    )
    .where(eq(collabTasks.status, "active"));
  // Popups must not disappear just because ordinary updates filled the first page.
  const unreadAssignments = await db
    .select()
    .from(taskNotifications)
    .where(
      and(
        eq(taskNotifications.recipientId, actor.studentId),
        eq(taskNotifications.assignment, true),
        isNull(taskNotifications.readAt),
      ),
    )
    .orderBy(desc(taskNotifications.id));
  const assignments = unreadAssignments.filter((m) =>
    active.some((a) => a.taskId === m.taskId && a.roundId === m.roundId),
  );
  const taskIds = [
    ...new Set([...messages, ...assignments].map((m) => m.taskId)),
  ];
  const publisherRows = taskIds.length
    ? await db
        .select({ id: collabTasks.id, name: students.name })
        .from(collabTasks)
        .innerJoin(students, eq(students.id, collabTasks.publisherId))
        .where(inArray(collabTasks.id, taskIds))
    : [];
  const publisherNames = new Map(publisherRows.map((p) => [p.id, p.name]));
  const [count] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(taskNotifications)
    .where(
      and(
        eq(taskNotifications.recipientId, actor.studentId),
        isNull(taskNotifications.readAt),
      ),
    );
  return {
    messages: messages.map((m) => ({
      ...m,
      publisher: publisherNames.get(m.taskId) ?? "发布者",
    })),
    assignments: assignments.map((m) => ({
      ...m,
      publisher: publisherNames.get(m.taskId) ?? "发布者",
    })),
    unread: count.value,
    nextCursor:
      messages.length === 200 ? messages[messages.length - 1].id : null,
  };
}
export async function readNotifications(ids: number[], actor: CurrentMember) {
  return db.transaction(async (tx) => {
    await validActor(tx, actor);
    const rows = await tx
      .select()
      .from(taskNotifications)
      .where(inArray(taskNotifications.id, ids));
    if (
      rows.some((r) => r.recipientId !== actor.studentId) ||
      rows.length !== new Set(ids).size
    )
      fail(
        "FORBIDDEN_NOTIFICATION",
        "只能标记自己的消息，请刷新消息列表。",
        403,
      );
    await tx
      .update(taskNotifications)
      .set({ readAt: new Date() })
      .where(
        and(
          inArray(taskNotifications.id, ids),
          eq(taskNotifications.recipientId, actor.studentId),
          isNull(taskNotifications.readAt),
        ),
      );
  });
}

export async function deleteNotifications(ids: number[], actor: CurrentMember) {
  return db.transaction(async (tx) => {
    await validActor(tx, actor);
    // Lock the entire confirmation set in stable order before validating/deleting.
    const rows = await tx
      .select({ id: taskNotifications.id, recipientId: taskNotifications.recipientId, readAt: taskNotifications.readAt })
      .from(taskNotifications)
      .where(inArray(taskNotifications.id, ids))
      .orderBy(asc(taskNotifications.id))
      .for("update");
    if (rows.some((row) => row.recipientId !== actor.studentId))
      fail("FORBIDDEN_NOTIFICATION", "只能删除自己的已读消息，请刷新后重新选择。", 403);
    if (rows.some((row) => row.readAt === null))
      fail("NOTIFICATION_UNREAD", "所选消息包含未读消息，请先阅读并标为已读后重试。", 409);
    if (!rows.length) return { deleted: 0 };
    const deleted = await tx.delete(taskNotifications)
      .where(and(inArray(taskNotifications.id, rows.map((row) => row.id)), eq(taskNotifications.recipientId, actor.studentId), isNotNull(taskNotifications.readAt)))
      .returning({ id: taskNotifications.id });
    await tx.insert(auditLogs).values({
      actorUserId: actor.userId,
      action: "notification.delete",
      entityType: "notification",
      entityId: String(actor.studentId),
      after: JSON.stringify({ requested: ids.length, deleted: deleted.length }),
    });
    return { deleted: deleted.length };
  });
}
export async function fileRecord(id: string, actor: CurrentMember) {
  const [file] = await db.select().from(taskFiles).where(eq(taskFiles.id, id));
  if (!file || file.deletingAt !== null || (file.taskId === null && file.creatorId !== actor.studentId))
    fail(
      "FILE_NOT_FOUND",
      "文件不存在或不可访问，请重新上传或联系发布者。",
      404,
    );
  return file;
}

export async function unboundFiles(actor: CurrentMember) {
  const files = await db.select({ id: taskFiles.id, name: taskFiles.name, size: taskFiles.size, deleting: sql<boolean>`${taskFiles.deletingAt} is not null` }).from(taskFiles).where(and(eq(taskFiles.creatorId, actor.studentId), isNull(taskFiles.taskId))).orderBy(desc(taskFiles.createdAt), desc(taskFiles.id)).limit(51);
  return { files: files.slice(0, 50), hasMore: files.length > 50 };
}

export async function markFileDeletion(id: string, actor: CurrentMember) {
  return db.transaction(async (tx) => {
    await lockTaskGraph(tx);
    await validActor(tx, actor);
    const [file] = await tx.select().from(taskFiles).where(eq(taskFiles.id, id));
    if (!file || file.creatorId !== actor.studentId)
      fail("FILE_NOT_FOUND", "附件不存在或不属于你，请刷新未提交附件列表。", 404);
    if (file.taskId !== null)
      fail("FILE_IN_USE", "附件已进入任务历史，不能清理；请仅移除当前表单中的引用。", 409);
    await tx.update(taskFiles).set({ deletingAt: file.deletingAt ?? new Date() }).where(eq(taskFiles.id, id));
  });
}

export async function finishFileDeletion(id: string, actor: CurrentMember) {
  await db.transaction(async (tx) => {
    await lockTaskGraph(tx);
    await validActor(tx, actor);
    await tx.delete(taskFiles).where(and(eq(taskFiles.id, id), eq(taskFiles.creatorId, actor.studentId), isNull(taskFiles.taskId), isNotNull(taskFiles.deletingAt)));
  });
}

// Exported only for storage accounting, not a public query surface.
export async function saveFileRecord(
  file: typeof taskFiles.$inferInsert,
  userQuota: number,
  totalQuota: number,
) {
  return db.transaction(async (tx) => {
    await lockTaskGraph(tx);
    const [usage] = await tx
      .select({
        total: sql<number>`coalesce(sum(${taskFiles.size}),0)::bigint`,
        own: sql<number>`coalesce(sum(case when ${taskFiles.creatorId} = ${file.creatorId} then ${taskFiles.size} else 0 end),0)::bigint`,
      })
      .from(taskFiles);
    if (
      Number(usage.total) + file.size > totalQuota ||
      Number(usage.own) + file.size > userQuota
    )
      fail(
        "STORAGE_FULL",
        "附件存储额度不足，请清理本人未提交附件、改用链接或联系项目维护者。",
        507,
      );
    await tx.insert(taskFiles).values(file);
  });
}
