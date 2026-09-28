import { recognizeScheduleImage, ImageOcrError } from "@/lib/image-ocr-service";
import { getCurrentMember, unauthorized } from "@/lib/server-auth";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const member = await getCurrentMember(request.headers);
  if (!member) return unauthorized();
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ code: "IMAGE_INVALID", message: "请选择一张课表截图。" }, { status: 422 });
  }
  try {
    return Response.json({ data: await recognizeScheduleImage(file) });
  } catch (error) {
    if (error instanceof ImageOcrError) {
      return Response.json({ code: error.code, message: error.message }, { status: 422 });
    }
    return Response.json({ code: "OCR_FAILED", message: "图片识别失败，请稍后重试。" }, { status: 500 });
  }
}
