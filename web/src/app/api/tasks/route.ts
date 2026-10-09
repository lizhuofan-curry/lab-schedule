import { getCurrentViewer } from "@/lib/server-auth";
import { createTask, listTasks, TaskError } from "@/lib/task-service";
import { memberFor, readInput, taskError } from "@/lib/task-http";
import { taskCreateSchema } from "@/lib/task-schema";
export async function GET(request: Request) {
  try {
    const viewer = await getCurrentViewer(request.headers);
    if (!viewer)
      throw new TaskError("UNAUTHORIZED", "请登录或进入游客模式。", 401);
    return Response.json(
      {
        data: await listTasks(
          viewer.kind === "guest",
          viewer.member?.studentId,
        ),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    return taskError(e);
  }
}
export async function POST(request: Request) {
  try {
    const actor = await memberFor(request, true);
    return Response.json(
      {
        data: await createTask(
          await readInput(request, taskCreateSchema),
          actor,
        ),
      },
      { status: 201 },
    );
  } catch (e) {
    return taskError(e);
  }
}
