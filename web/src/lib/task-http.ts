import "server-only";
import { getCurrentMember, getCurrentViewer } from "./server-auth";
import { TaskError } from "./task-service";
import type { z } from "zod";
export function taskError(error: unknown) {
  if (error instanceof TaskError)
    return Response.json(
      { code: error.code, message: error.message },
      { status: error.status, headers: { "cache-control": "no-store" } },
    );
  return Response.json(
    {
      code: "TASK_FAILED",
      message: "操作未完成，请刷新后重试；持续失败请联系项目维护者。",
    },
    { status: 500 },
  );
}
export async function memberFor(request: Request, write = false) {
  const actor = await getCurrentMember(request.headers);
  if (!actor) {
    const viewer = await getCurrentViewer(request.headers);
    throw new TaskError(
      viewer?.kind === "guest" ? "FORBIDDEN_GUEST" : "UNAUTHORIZED",
      "请以注册成员身份登录后操作。",
      viewer?.kind === "guest" ? 403 : 401,
    );
  }
  if (write) {
    const origin = request.headers.get("origin");
    const trusted = [
      new URL(request.url).origin,
      process.env.BETTER_AUTH_URL,
      ...(process.env.BETTER_AUTH_TRUSTED_ORIGINS ?? "").split(","),
    ].filter(Boolean);
    if (!origin || !trusted.includes(origin))
      throw new TaskError(
        "FORBIDDEN_ORIGIN",
        "请求来源无效，请从本站刷新后重试。",
        403,
      );
  }
  return actor;
}
export function taskId(value: string) {
  const id = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(id) || id <= 0)
    throw new TaskError("INVALID_TASK", "任务编号无效，请返回任务列表。");
  return id;
}
export function readQuery<T>(request: Request, schema: z.ZodType<T>) {
  const search = new URL(request.url).searchParams;
  for (const key of search.keys())
    if (search.getAll(key).length !== 1)
      throw new TaskError(
        "INVALID_COMMAND",
        "查询参数重复，请刷新成员页面后重试。",
      );
  const parsed = schema.safeParse(Object.fromEntries(search));
  if (!parsed.success)
    throw new TaskError(
      "INVALID_COMMAND",
      "查询范围或分页信息无效，请刷新后重试。",
    );
  return parsed.data;
}
export async function boundedBody(request: Request, max: number) {
  if (Number(request.headers.get("content-length")) > max)
    throw new TaskError(
      "PAYLOAD_TOO_LARGE",
      "内容过大，请缩短文字或改用链接。",
      413,
    );
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader)
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > max) {
          await reader.cancel();
          throw new TaskError(
            "PAYLOAD_TOO_LARGE",
            "内容过大，请压缩文件或改用链接。",
            413,
          );
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
export async function readInput<T>(request: Request, schema: z.ZodType<T>) {
  let body: unknown;
  try {
    body = JSON.parse(
      new TextDecoder().decode(await boundedBody(request, 256 * 1024)),
    );
  } catch (e) {
    if (e instanceof TaskError) throw e;
    throw new TaskError("INVALID_COMMAND", "请求格式无效，请刷新后重试。");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success)
    throw new TaskError(
      "INVALID_COMMAND",
      parsed.error.issues[0]?.message ?? "输入无效，请检查后重试。",
    );
  return parsed.data;
}
