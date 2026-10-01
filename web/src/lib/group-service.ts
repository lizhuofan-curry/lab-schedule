import "server-only";

import { and, asc, eq, ilike, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, groupMembers, groups, students } from "@/db/schema";
import type { CurrentMember } from "@/lib/server-auth";

export type GroupDirectoryMember = {
  studentId: number;
  name: string;
  studentNo: string | null;
  role: "leader" | "member";
};

export type GroupDirectoryItem = {
  id: number;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  members: GroupDirectoryMember[];
  leader: GroupDirectoryMember;
  canManage: boolean;
};

export class GroupServiceError extends Error {
  constructor(public code: string, message: string, public status = 422) {
    super(message);
  }
}

function normalizeGroupName(name: string) {
  return name.trim().replace(/\s+/g, " ");
}

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

type SelectExecutor = Pick<typeof db, "select">;

async function assertLeader(groupId: number, studentId: number, executor: SelectExecutor = db) {
  const [leader] = await executor.select({ id: groupMembers.id })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.studentId, studentId), eq(groupMembers.role, "leader")))
    .limit(1);
  if (!leader) throw new GroupServiceError("FORBIDDEN_GROUP_LEADER", "只有当前组长可以执行此操作。", 403);
}

async function assertUniqueName(name: string, excludeId?: number, executor: SelectExecutor = db) {
  const where = excludeId
    ? and(ilike(groups.name, name), ne(groups.id, excludeId))
    : ilike(groups.name, name);
  const [existing] = await executor.select({ id: groups.id }).from(groups).where(where).limit(1);
  if (existing) throw new GroupServiceError("GROUP_NAME_TAKEN", "已经有同名小组，请换一个名称。", 409);
}

export async function getGroupDirectory(viewerStudentId?: number | null): Promise<GroupDirectoryItem[]> {
  const groupRows = await db.select({
    id: groups.id,
    name: groups.name,
    createdAt: groups.createdAt,
    updatedAt: groups.updatedAt,
  }).from(groups).orderBy(asc(groups.name), asc(groups.id));
  if (groupRows.length === 0) return [];

  const memberRows = await db.select({
    groupId: groupMembers.groupId,
    studentId: students.id,
    name: students.name,
    studentNo: students.studentNo,
    role: groupMembers.role,
  }).from(groupMembers)
    .innerJoin(students, eq(students.id, groupMembers.studentId))
    .where(and(inArray(groupMembers.groupId, groupRows.map((group) => group.id)), eq(students.enabled, true)))
    .orderBy(asc(groupMembers.groupId), asc(groupMembers.role), asc(students.name));

  return groupRows.flatMap((group) => {
    const members = memberRows.filter((member) => member.groupId === group.id).map((member) => ({
      studentId: member.studentId,
      name: member.name,
      studentNo: member.studentNo,
      role: member.role as "leader" | "member",
    }));
    const leader = members.find((member) => member.role === "leader");
    if (!leader) return [];
    return [{
      ...group,
      members,
      leader,
      canManage: viewerStudentId === leader.studentId,
    }];
  });
}

export async function createGroup(name: string, actor: CurrentMember) {
  const normalizedName = normalizeGroupName(name);
  await assertUniqueName(normalizedName);
  try {
    return await db.transaction(async (tx) => {
      await assertUniqueName(normalizedName, undefined, tx);
      const [group] = await tx.insert(groups).values({ name: normalizedName, createdByStudentId: actor.studentId }).returning();
      await tx.insert(groupMembers).values({ groupId: group.id, studentId: actor.studentId, role: "leader" });
      await tx.insert(auditLogs).values({
        actorUserId: actor.userId,
        action: "group.create",
        entityType: "group",
        entityId: String(group.id),
        after: JSON.stringify({ id: group.id, name: group.name, leaderStudentId: actor.studentId }),
      });
      return group;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new GroupServiceError("GROUP_NAME_TAKEN", "已经有同名小组，请换一个名称。", 409);
    throw error;
  }
}

export async function renameGroup(groupId: number, name: string, actor: CurrentMember) {
  const normalizedName = normalizeGroupName(name);
  try {
    return await db.transaction(async (tx) => {
      await assertLeader(groupId, actor.studentId, tx);
      await assertUniqueName(normalizedName, groupId, tx);
      const [before] = await tx.select().from(groups).where(eq(groups.id, groupId)).limit(1);
      if (!before) throw new GroupServiceError("GROUP_NOT_FOUND", "小组不存在或已被解散。", 404);
      const [updated] = await tx.update(groups).set({ name: normalizedName, updatedAt: new Date() }).where(eq(groups.id, groupId)).returning();
      await tx.insert(auditLogs).values({ actorUserId: actor.userId, action: "group.rename", entityType: "group", entityId: String(groupId), before: JSON.stringify(before), after: JSON.stringify(updated) });
      return updated;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new GroupServiceError("GROUP_NAME_TAKEN", "已经有同名小组，请换一个名称。", 409);
    throw error;
  }
}

export async function addGroupMember(groupId: number, studentId: number, actor: CurrentMember) {
  return db.transaction(async (tx) => {
    await assertLeader(groupId, actor.studentId, tx);
    const [student] = await tx.select({ id: students.id, name: students.name }).from(students).where(and(eq(students.id, studentId), eq(students.enabled, true))).limit(1);
    if (!student) throw new GroupServiceError("STUDENT_NOT_FOUND", "成员不存在或已被停用。", 404);
    const [existing] = await tx.select({ id: groupMembers.id }).from(groupMembers).where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.studentId, studentId))).limit(1);
    if (existing) throw new GroupServiceError("GROUP_MEMBER_EXISTS", "该成员已经在这个小组中。", 409);
    const [membership] = await tx.insert(groupMembers).values({ groupId, studentId, role: "member" }).returning();
    await tx.update(groups).set({ updatedAt: new Date() }).where(eq(groups.id, groupId));
    await tx.insert(auditLogs).values({ actorUserId: actor.userId, action: "group.member.add", entityType: "group", entityId: String(groupId), after: JSON.stringify({ studentId, name: student.name }) });
    return membership;
  });
}

export async function removeGroupMember(groupId: number, studentId: number, actor: CurrentMember) {
  return db.transaction(async (tx) => {
    await assertLeader(groupId, actor.studentId, tx);
    const [membership] = await tx.select().from(groupMembers).where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.studentId, studentId))).limit(1);
    if (!membership) throw new GroupServiceError("GROUP_MEMBER_NOT_FOUND", "该成员不在这个小组中。", 404);
    if (membership.role === "leader") throw new GroupServiceError("CANNOT_REMOVE_LEADER", "请先转让组长，再移除原组长。", 409);
    await tx.delete(groupMembers).where(eq(groupMembers.id, membership.id));
    await tx.update(groups).set({ updatedAt: new Date() }).where(eq(groups.id, groupId));
    await tx.insert(auditLogs).values({ actorUserId: actor.userId, action: "group.member.remove", entityType: "group", entityId: String(groupId), before: JSON.stringify({ studentId }) });
  });
}

export async function transferGroupLeader(groupId: number, studentId: number, actor: CurrentMember) {
  return db.transaction(async (tx) => {
    await assertLeader(groupId, actor.studentId, tx);
    if (studentId === actor.studentId) throw new GroupServiceError("ALREADY_GROUP_LEADER", "该成员已经是组长。", 409);
    const [target] = await tx.select().from(groupMembers).where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.studentId, studentId))).limit(1);
    if (!target) throw new GroupServiceError("GROUP_MEMBER_NOT_FOUND", "只能把组长转让给当前组员。", 404);
    await tx.update(groupMembers).set({ role: "member" }).where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.studentId, actor.studentId)));
    await tx.update(groupMembers).set({ role: "leader" }).where(eq(groupMembers.id, target.id));
    await tx.update(groups).set({ updatedAt: new Date() }).where(eq(groups.id, groupId));
    await tx.insert(auditLogs).values({ actorUserId: actor.userId, action: "group.leader.transfer", entityType: "group", entityId: String(groupId), before: JSON.stringify({ leaderStudentId: actor.studentId }), after: JSON.stringify({ leaderStudentId: studentId }) });
  });
}

export async function deleteGroup(groupId: number, actor: CurrentMember) {
  return db.transaction(async (tx) => {
    await assertLeader(groupId, actor.studentId, tx);
    const [before] = await tx.select().from(groups).where(eq(groups.id, groupId)).limit(1);
    if (!before) throw new GroupServiceError("GROUP_NOT_FOUND", "小组不存在或已被解散。", 404);
    await tx.delete(groups).where(eq(groups.id, groupId));
    await tx.insert(auditLogs).values({ actorUserId: actor.userId, action: "group.delete", entityType: "group", entityId: String(groupId), before: JSON.stringify(before) });
  });
}

