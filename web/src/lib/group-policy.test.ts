import assert from "node:assert/strict";
import test from "node:test";
import { canManageGroup, canRemoveGroupMember } from "./group-policy.ts";

test("只有组长可以管理小组", () => {
  assert.equal(canManageGroup("leader"), true);
  assert.equal(canManageGroup("member"), false);
  assert.equal(canManageGroup(null), false);
});

test("组长可以移除普通组员，但不能把自己作为普通移除操作删除", () => {
  assert.equal(canRemoveGroupMember("leader", "member"), true);
  assert.equal(canRemoveGroupMember("leader", "leader"), false);
  assert.equal(canRemoveGroupMember("member", "member"), false);
});

