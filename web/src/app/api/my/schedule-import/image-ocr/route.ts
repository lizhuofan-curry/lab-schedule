import { recognizeScheduleImage, validateScheduleImage, ImageOcrError } from "@/lib/image-ocr-service";
import { draftsFromOcrLines } from "@/lib/image-ocr";
import { recognizeScheduleWithVision, ScheduleVisionError } from "@/lib/schedule-vision-service";
import { getCurrentMember, unauthorized } from "@/lib/server-auth";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  const member = await getCurrentMember(request.headers);
  if (!member) return unauthorized();
  const form = await request.formData();
  const file = form.get("file");
  const mode = form.get("mode") === "vision" ? "vision" : "local";
  if (!(file instanceof File)) {
    return Response.json({ code: "IMAGE_INVALID", message: "请选择一张课表截图。" }, { status: 422 });
  }
  if (mode === "vision" && form.get("visionConsent") !== "true") {
    return Response.json({ code: "VISION_CONSENT_REQUIRED", message: "使用智能识别前，请先确认同意将本次图片发送给模型服务处理。" }, { status: 422 });
  }
  if (mode === "vision" && file.size >= 7 * 1024 * 1024) {
    return Response.json({ code: "IMAGE_INVALID", message: "智能识别图片需小于 7 MB，请裁剪无关区域或压缩后重试；本地 OCR 仍支持最大 8 MB。" }, { status: 422 });
  }
  const startedAt = Date.now();
  console.info("[schedule-image-recognition] started", { mode, bytes: file.size });
  try {
    validateScheduleImage(file);
    if (mode === "vision") {
      const vision = await recognizeScheduleWithVision(file);
      const confidence = Math.round(vision.drafts.reduce((sum, draft) => sum + draft.confidence, 0) / vision.drafts.length);
      console.info("[schedule-image-recognition] completed", { mode, elapsedMs: Date.now() - startedAt, drafts: vision.drafts.length });
      return Response.json({ data: { fileName: file.name, confidence, text: "", lines: [], mode, model: vision.model, drafts: vision.drafts } });
    }
    const local = await recognizeScheduleImage(file);
    const drafts = draftsFromOcrLines(local.lines);
    console.info("[schedule-image-recognition] completed", { mode, elapsedMs: Date.now() - startedAt, drafts: drafts.length });
    return Response.json({ data: { ...local, mode, drafts } });
  } catch (error) {
    console.warn("[schedule-image-recognition] failed", {
      mode,
      elapsedMs: Date.now() - startedAt,
      code: error instanceof ImageOcrError || error instanceof ScheduleVisionError ? error.code : "UNKNOWN",
    });
    if (error instanceof ImageOcrError) {
      return Response.json({ code: error.code, message: error.message }, { status: 422 });
    }
    if (error instanceof ScheduleVisionError) {
      const status = error.code === "VISION_NOT_CONFIGURED" ? 503 : 502;
      return Response.json({ code: error.code, message: error.message }, { status });
    }
    return Response.json({ code: "OCR_FAILED", message: "图片识别失败，请稍后重试。" }, { status: 500 });
  }
}
