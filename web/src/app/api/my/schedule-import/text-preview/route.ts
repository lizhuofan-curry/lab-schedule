import { z } from "zod";
import { previewPastedScheduleImport, ScheduleImportError } from "@/lib/schedule-import-service";
import { getCurrentMember, unauthorized } from "@/lib/server-auth";

export const runtime = "nodejs";

const schema = z.object({ text: z.string().trim().min(1, "请先粘贴课表内容。").max(100_000, "粘贴内容不能超过 10 万字符。") });

export async function POST(request: Request) {
  const member = await getCurrentMember(request.headers);
  if (!member) return unauthorized();
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ code: "INVALID_INPUT", message: parsed.error.issues[0]?.message ?? "输入无效。" }, { status: 422 });
  try {
    return Response.json({ data: await previewPastedScheduleImport(parsed.data.text, member) });
  } catch (error) {
    if (error instanceof ScheduleImportError) return Response.json({ code: error.code, message: error.message }, { status: 422 });
    return Response.json({ code: "PREVIEW_FAILED", message: "粘贴内容预览失败，请检查表头和课程格式。" }, { status: 500 });
  }
}
