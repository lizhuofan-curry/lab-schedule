import { commandTask, taskDetail } from "@/lib/task-service";
import { memberFor, readInput, taskError, taskId } from "@/lib/task-http";
import { taskCommandSchema } from "@/lib/task-schema";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try {
    await memberFor(request);
    return Response.json(
      { data: await taskDetail(taskId((await context.params).id)) },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    return taskError(e);
  }
}
export async function POST(request: Request, context: Context) {
  try {
    const actor = await memberFor(request, true);
    return Response.json({
      data: await commandTask(
        taskId((await context.params).id),
        await readInput(request, taskCommandSchema),
        actor,
      ),
    });
  } catch (e) {
    return taskError(e);
  }
}
