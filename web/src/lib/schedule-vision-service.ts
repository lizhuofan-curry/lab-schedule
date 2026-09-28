import "server-only";

import { parseVisionSchedule, visionCoursesToDrafts } from "./schedule-vision";

const SYSTEM_PROMPT = `你是大学课表图片结构化助手。只提取图片中明确可见的课程，不猜测被截断或看不清的内容。
输出一个 JSON 对象，唯一顶层字段是 courses。每门课包含：
name、teacher、location、weekday(1=周一至7=周日)、startPeriod、endPeriod、weeks、note、confidence(0到1)、evidence、uncertainFields。
weekday/startPeriod/endPeriod 无法确定时填 null；其余无法确定时填空字符串。uncertainFields 只能包含 name、teacher、location、weekday、periods、weeks。
同一课程若存在不同星期、节次、周次或地点，应拆成多条。不得把表头、日期、午休、备注说明识别为课程。
节次作息固定为：1 08:00-08:45，2 08:55-09:40，3 10:00-10:45，4 10:55-11:40，5 11:45-12:30，6 14:05-14:50，7 15:00-15:45，8 15:55-16:40，9 17:00-17:45，10 17:55-18:40，11 19:10-19:55，12 20:05-20:50，13 20:55-21:40。中午不是课程节次。`;

export class ScheduleVisionError extends Error {
  constructor(public code: "VISION_NOT_CONFIGURED" | "VISION_PROVIDER_FAILED" | "VISION_OUTPUT_INVALID", message: string) {
    super(message);
  }
}

function getConfig() {
  const provider = process.env.SCHEDULE_VISION_PROVIDER?.trim().toLowerCase();
  const model = process.env.SCHEDULE_VISION_MODEL?.trim();
  const apiKey = process.env.DASHSCOPE_API_KEY?.trim();
  const baseUrl = process.env.DASHSCOPE_BASE_URL?.trim().replace(/\/+$/, "");
  if (provider !== "qwen" || !model || !apiKey || !baseUrl) {
    throw new ScheduleVisionError("VISION_NOT_CONFIGURED", "智能识别尚未配置完整，请联系维护者检查模型、API Key 和服务地址。");
  }
  if (apiKey.startsWith("sk-sp-")) {
    throw new ScheduleVisionError("VISION_NOT_CONFIGURED", "当前配置的是 Token Plan Key，图片识别需要标准 API Key，请联系维护者更换。");
  }
  return { model, apiKey, baseUrl };
}

export async function recognizeScheduleWithVision(file: File) {
  const { model, apiKey, baseUrl } = getConfig();
  const imageBase64 = Buffer.from(await file.arrayBuffer()).toString("base64");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 40_000);
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: `data:${file.type};base64,${imageBase64}` } },
              { type: "text", text: "请直接根据图片识别并结构化这张课表。" },
            ],
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0.1,
        max_tokens: 4000,
        enable_thinking: false,
      }),
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new ScheduleVisionError("VISION_PROVIDER_FAILED", "智能识别超过 40 秒仍未完成，请重试、裁剪图片，或改用本地识别。");
    }
    throw new ScheduleVisionError("VISION_PROVIDER_FAILED", "智能识别服务暂时无法连接，请稍后重试或改用本地识别。");
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    throw new ScheduleVisionError("VISION_PROVIDER_FAILED", "智能识别服务返回错误，请联系维护者检查 Key、模型名称和地域地址。");
  }
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new ScheduleVisionError("VISION_OUTPUT_INVALID", "智能识别没有返回可用课表，请改用本地识别或更换清晰图片。");
  try {
    const drafts = visionCoursesToDrafts(parseVisionSchedule(content));
    if (drafts.length === 0) throw new Error("empty");
    return { model, drafts };
  } catch {
    throw new ScheduleVisionError("VISION_OUTPUT_INVALID", "智能识别结果格式异常，请重试或改用本地识别。");
  }
}
