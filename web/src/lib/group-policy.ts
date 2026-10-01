export type GroupRole = "leader" | "member";

export function canManageGroup(role: GroupRole | null | undefined) {
  return role === "leader";
}

export function canRemoveGroupMember(actorRole: GroupRole | null | undefined, targetRole: GroupRole) {
  return actorRole === "leader" && targetRole !== "leader";
}

