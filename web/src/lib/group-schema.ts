import { z } from "zod";

export const groupNameSchema = z.object({
  name: z.string().trim().min(1, "请输入小组名称。").max(40, "小组名称最多 40 个字。"),
});

export const groupMemberSchema = z.object({
  studentId: z.number().int().positive("请选择有效成员。"),
});

export type GroupNameInput = z.infer<typeof groupNameSchema>;

