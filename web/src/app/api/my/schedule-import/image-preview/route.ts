import { z } from "zod";
import type { ImportRecord } from "@/lib/schedule-import";
import { previewImageScheduleImport, ScheduleImportError } from "@/lib/schedule-import-service";
import { getCurrentMember, unauthorized } from "@/lib/server-auth";

export const runtime = "nodejs";

const recordSchema = z.object({
  "课程名称": z.string().max(500),
  "教师": z.string().max(500),
  "地点": z.string().max(500),
  "星期": z.string().max(500),
  "开始节次": z.string().max(500),
  "结束节次": z.string().max(500),
  "周次": z.string().max(500),
  "备注": z.string().max(500),
  "颜色": z.string().max(500),
}).strict();

const schema = z.object({
  fileName: z.string().trim().min(1).max(255),
  records: z.array(recordSchema).min(1).max(200),
});

export async function POST(request: Request) {
  const member = await getCurrentMember(request.headers);
  if (!member) return unauthorized();
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ code: "INVALID_INPUT", message: parsed.error.issues[0]?.message ?? "图片草稿无效。" }, { status: 422 });
  }
  try {
    return Response.json({ data: await previewImageScheduleImport(parsed.data.records as ImportRecord[], member, parsed.data.fileName) });
  } catch (error) {
    if (error instanceof ScheduleImportError) {
      return Response.json({ code: error.code, message: error.message }, { status: 422 });
    }
    return Response.json({ code: "PREVIEW_FAILED", message: "草稿预览失败，请检查课程字段后重试。" }, { status: 500 });
  }
}
