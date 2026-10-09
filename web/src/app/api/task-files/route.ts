import { boundedBody, memberFor, taskError } from "@/lib/task-http";
import { TaskError, unboundFiles } from "@/lib/task-service";
import { uploadTaskFile } from "@/lib/task-file-service";
import { taskFileUploadSchema } from "@/lib/task-schema";
export async function GET(request: Request) {
  try {
    return Response.json({ data: await unboundFiles(await memberFor(request)) }, { headers: { "cache-control": "private, no-store" } });
  } catch (e) { return taskError(e); }
}
export async function POST(request: Request) {
  try {
    const actor = await memberFor(request, true);
    const bytes = await boundedBody(request, 11 * 1024 * 1024);
    let form: FormData;
    try {
      form = await new Response(bytes, {
        headers: { "content-type": request.headers.get("content-type") ?? "" },
      }).formData();
    } catch {
      throw new TaskError("INVALID_FILE", "文件上传格式无效，请重新选择文件。");
    }
    if ([...form.keys()].length !== 1)
      throw new TaskError("INVALID_FILE", "请每次上传一个文件。");
    const parsed = taskFileUploadSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success)
      throw new TaskError(
        "INVALID_FILE",
        parsed.error.issues[0]?.message ?? "请重新选择文件。",
      );
    return Response.json(
      { data: await uploadTaskFile(parsed.data.file, actor) },
      { status: 201 },
    );
  } catch (e) {
    return taskError(e);
  }
}
