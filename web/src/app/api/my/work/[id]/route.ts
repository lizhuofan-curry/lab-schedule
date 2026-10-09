import { memberFor, readInput, taskError, taskId } from "@/lib/task-http";
import { workDeleteSchema, workUpdateSchema } from "@/lib/work-schema";
import { deleteWork, getOwnWork, updateWork } from "@/lib/work-service";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const actor = await memberFor(request);
    return Response.json(
      { data: await getOwnWork(taskId((await context.params).id), actor) },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    return taskError(e);
  }
}
export async function PATCH(request: Request, context: Context) {
  try {
    const actor = await memberFor(request, true);
    return Response.json({
      data: await updateWork(
        taskId((await context.params).id),
        await readInput(request, workUpdateSchema),
        actor,
      ),
    });
  } catch (e) {
    return taskError(e);
  }
}
export async function DELETE(request: Request, context: Context) {
  try {
    const actor = await memberFor(request, true);
    const body = await readInput(request, workDeleteSchema);
    return Response.json({
      data: await deleteWork(
        taskId((await context.params).id),
        body.expectedRevision,
        actor,
      ),
    });
  } catch (e) {
    return taskError(e);
  }
}
