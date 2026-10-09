import { memberFor, readInput, taskError } from "@/lib/task-http";
import { deleteTaskFile, downloadTaskFile } from "@/lib/task-file-service";
import { taskFileDeleteSchema } from "@/lib/task-schema";
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await memberFor(request, true);
    await readInput(request, taskFileDeleteSchema);
    await deleteTaskFile((await params).id, actor);
    return new Response(null, { status: 204 });
  } catch (e) { return taskError(e); }
}
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    return await downloadTaskFile((await params).id, await memberFor(request), new URL(request.url).searchParams.get("preview") === "1");
  } catch (e) {
    return taskError(e);
  }
}
