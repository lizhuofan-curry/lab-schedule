import { memberFor, readQuery, taskError, taskId } from "@/lib/task-http";
import { workQuerySchema } from "@/lib/work-schema";
import { listMemberWork } from "@/lib/work-service";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const actor = await memberFor(request);
    const query = readQuery(request, workQuerySchema);
    return Response.json(
      {
        data: await listMemberWork(
          taskId((await context.params).id),
          actor,
          query.scope,
          query.cursor,
        ),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    return taskError(e);
  }
}
