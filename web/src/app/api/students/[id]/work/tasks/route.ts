import { memberFor, readQuery, taskError, taskId } from "@/lib/task-http";
import { memberTaskQuerySchema } from "@/lib/work-schema";
import { listMemberTasks } from "@/lib/work-service";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const actor = await memberFor(request);
    const query = readQuery(request, memberTaskQuerySchema);
    return Response.json(
      {
        data: await listMemberTasks(
          taskId((await context.params).id),
          actor,
          query.cursor,
        ),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    return taskError(e);
  }
}
