import { memberFor, taskError } from "@/lib/task-http";
import { taskOptions } from "@/lib/task-service";
export async function GET(request: Request) {
  try {
    await memberFor(request);
    return Response.json(
      { data: await taskOptions() },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    return taskError(e);
  }
}
