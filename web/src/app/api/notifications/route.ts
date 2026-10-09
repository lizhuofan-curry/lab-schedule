import { memberFor, readInput, taskError } from "@/lib/task-http";
import {
  notifications,
  readNotifications,
  TaskError,
} from "@/lib/task-service";
import { notificationReadSchema } from "@/lib/task-schema";
export async function GET(request: Request) {
  try {
    const actor = await memberFor(request);
    const value = new URL(request.url).searchParams.get("before");
    const before = value === null ? undefined : Number(value);
    if (
      value !== null &&
      (!/^\d+$/.test(value) || !Number.isSafeInteger(before) || before! <= 0)
    )
      throw new TaskError("INVALID_CURSOR", "消息页码无效，请刷新消息列表。");
    return Response.json(
      { data: await notifications(actor, before) },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    return taskError(e);
  }
}
export async function POST(request: Request) {
  try {
    const actor = await memberFor(request, true);
    await readNotifications(
      (await readInput(request, notificationReadSchema)).ids,
      actor,
    );
    return Response.json({ data: { read: true } });
  } catch (e) {
    return taskError(e);
  }
}
