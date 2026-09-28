import { z } from "zod";
import { confirmScheduleImport, ScheduleImportError } from "@/lib/schedule-import-service";
import { getCurrentMember, unauthorized } from "@/lib/server-auth";

const confirmSchema = z.object({
  source: z.enum(["csv", "xlsx", "henu", "text", "image"]),
  fileName: z.string().trim().min(1).max(255),
  courses: z.array(z.unknown()).min(1).max(200),
});

export async function POST(request: Request) {
  const member = await getCurrentMember(request.headers);
  if (!member) return unauthorized();
  const parsed = confirmSchema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ code: "INVALID_IMPORT", message: parsed.error.issues[0]?.message ?? "导入数据无效。" }, { status: 422 });
  try {
    return Response.json({ data: await confirmScheduleImport({ member, source: parsed.data.source, fileName: parsed.data.fileName, imported: parsed.data.courses }) });
  } catch (error) {
    if (error instanceof ScheduleImportError) return Response.json({ code: error.code, message: error.message }, { status: 422 });
    return Response.json({ code: "IMPORT_FAILED", message: "导入失败，原课表未被修改，请稍后重试。" }, { status: 500 });
  }
}
