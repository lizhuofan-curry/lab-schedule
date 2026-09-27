import "server-only";

import { HenuClient } from "@/lib/henu-client";
import { parseScheduleGrid } from "@/lib/henu-schedule-parse";
import { previewParsedScheduleImport } from "@/lib/schedule-import-service";
import type { CurrentMember } from "@/lib/server-auth";

export class HenuSyncError extends Error {
  constructor(public code: "FORBIDDEN_STUDENT" | "IDENTITY_MISMATCH" | "HENU_LOGIN_FAILED" | "HENU_SCHEDULE_EMPTY", message: string) {
    super(message);
  }
}

function normalizeStudentNo(value: string) {
  return value.trim().toLowerCase();
}

export async function previewHenuSchedule({ member, studentId, password }: {
  member: CurrentMember;
  studentId: string;
  password: string;
}) {
  if (normalizeStudentNo(studentId) !== normalizeStudentNo(member.studentNo)) {
    throw new HenuSyncError("FORBIDDEN_STUDENT", "只能同步当前登录账号本人的河大课表。");
  }

  const client = new HenuClient();
  let schedule: Awaited<ReturnType<HenuClient["fetchSchedule"]>>;
  try {
    await client.login(member.studentNo, password);
    schedule = await client.fetchSchedule();
  } catch (error) {
    throw new HenuSyncError("HENU_LOGIN_FAILED", error instanceof Error ? error.message : "河大教务系统登录失败，请稍后重试。");
  }

  if (normalizeStudentNo(schedule.context.loginId) !== normalizeStudentNo(member.studentNo)) {
    throw new HenuSyncError("IDENTITY_MISMATCH", "教务系统返回的登录身份与当前账号不一致，未生成导入预览。");
  }

  const parsedCourses = parseScheduleGrid(schedule.gridHtml).map((course) => ({
    ...course,
    teacher: course.teacher || null,
    location: course.location || null,
    note: "河大教务系统同步",
    color: "#dce8e3",
  }));
  if (parsedCourses.length === 0) {
    throw new HenuSyncError("HENU_SCHEDULE_EMPTY", "没有从河大教务系统解析到课程，请确认当前学期已有课表，或稍后重试。");
  }

  const preview = await previewParsedScheduleImport({
    member,
    source: "henu",
    fileName: "河大教务系统",
    imported: parsedCourses,
  });

  return {
    ...preview,
    context: {
      academicYear: schedule.context.xn,
      semesterCode: schedule.context.xq,
    },
  };
}
