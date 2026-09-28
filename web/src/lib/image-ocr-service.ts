import "server-only";

import path from "node:path";
import { createWorker, OEM, PSM } from "tesseract.js";
import chiSim from "@tesseract.js-data/chi_sim";
import type { OcrTextLine } from "./image-ocr";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export class ImageOcrError extends Error {
  constructor(public code: "IMAGE_INVALID" | "OCR_EMPTY" | "OCR_FAILED", message: string) {
    super(message);
  }
}

export function validateScheduleImage(file: File) {
  if (!ACCEPTED_IMAGE_TYPES.has(file.type)) {
    throw new ImageOcrError("IMAGE_INVALID", "仅支持 PNG、JPG 或 WebP 图片，请重新选择课表截图。");
  }
  if (file.size === 0 || file.size > MAX_IMAGE_BYTES) {
    throw new ImageOcrError("IMAGE_INVALID", "图片必须小于 8 MB，请裁剪无关区域或压缩后重试。");
  }
}

export async function recognizeScheduleImage(file: File) {
  validateScheduleImage(file);

  const worker = await createWorker(chiSim.code, OEM.LSTM_ONLY, {
    langPath: chiSim.langPath,
    gzip: chiSim.gzip,
    cacheMethod: "none",
    // Standalone 构建中的依赖追踪副本缺少 worker 的父模块，显式使用完整 node_modules。
    workerPath: path.join(process.cwd(), "node_modules", "tesseract.js", "src", "worker-script", "node", "index.js"),
  });
  try {
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SPARSE_TEXT,
      preserve_interword_spaces: "1",
      user_defined_dpi: "300",
    });
    const result = await worker.recognize(Buffer.from(await file.arrayBuffer()), {}, { blocks: true, text: true });
    const lines: OcrTextLine[] = (result.data.blocks ?? [])
      .flatMap((block) => block.paragraphs)
      .flatMap((paragraph) => paragraph.lines)
      .map((line) => ({ text: line.text.trim(), confidence: line.confidence, bbox: line.bbox }))
      .filter((line) => line.text.length > 0);
    if (!result.data.text.trim() || lines.length === 0) {
      throw new ImageOcrError("OCR_EMPTY", "没有识别到清晰文字，请裁剪到课表区域并使用原图重试。");
    }
    return {
      fileName: file.name,
      confidence: Math.round(result.data.confidence),
      text: result.data.text.trim(),
      lines,
    };
  } catch (error) {
    if (error instanceof ImageOcrError) throw error;
    throw new ImageOcrError("OCR_FAILED", "图片识别失败，请确认图片清晰、方向正确后重试。");
  } finally {
    await worker.terminate();
  }
}
