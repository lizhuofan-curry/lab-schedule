import { previewScheduleImport, ScheduleImportError } from "@/lib/schedule-import-service";
import { getCurrentMember, unauthorized } from "@/lib/server-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const member = await getCurrentMember(request.headers);
  if (!member) return unauthorized();
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ code: "FILE_REQUIRED", message: "请选择要导入的 .xlsx 或 .csv 文件。" }, { status: 422 });
  try {
    return Response.json({ data: await previewScheduleImport(file, member) });
  } catch (error) {
    if (error instanceof ScheduleImportError) return Response.json({ code: error.code, message: error.message }, { status: 422 });
    return Response.json({ code: "PREVIEW_FAILED", message: "文件预览失败，请确认使用了最新模板。" }, { status: 500 });
  }
}
