import type { ImportHeader, ImportRecord } from "./schedule-import.ts";

export type OcrTextLine = {
  text: string;
  confidence: number;
  bbox?: { x0: number; y0: number; x1: number; y1: number };
};

export type ImageCourseDraft = {
  id: string;
  sourceText: string;
  confidence: number;
  reviewFields?: ImportHeader[];
  record: ImportRecord;
};

const noisePatterns = [
  /^\d{1,2}:\d{2}/,
  /^第?\d{1,2}(节|周)?$/,
  /^(周|星期)[一二三四五六日天]$/,
  /^\d{1,2}(日|月)$/,
  /^(我的课表|设置|首页|消息|备注|学年学期|上课时间|读取教务作息时间)$/,
  /(学年|学期|添加备注|空白格子|无课教室|我的课表|设置上课时间)/,
  /^(金明|校区|综合楼|教室|楼\d|区金明|明综合|综合一)/,
];

function cleanLine(value: string) {
  return value.replace(/[|｜]/g, " ").replace(/\s+/g, " ").trim();
}

function looksLikeCourse(text: string, confidence: number) {
  if (confidence < 65) return false;
  if (/\d{1,2}\s*[-~至]\s*\d{1,2}\s*(?:单|双)?\s*周/.test(text)) return true;
  const cjkCount = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const latinWord = text.match(/[A-Za-z]{4,}/);
  return cjkCount >= 3 || Boolean(latinWord);
}

function weekdayFrom(text: string) {
  const matched = text.match(/(?:周|星期)([一二三四五六日天])/);
  return matched ? `周${matched[1] === "天" ? "日" : matched[1]}` : "";
}

function periodsFrom(text: string) {
  const matched = text.match(/(?:第)?\s*(\d{1,2})\s*[-~至]\s*(\d{1,2})\s*节?/);
  return matched ? [matched[1], matched[2]] : ["", ""];
}

function weeksFrom(text: string) {
  const matched = text.match(/(\d{1,2}\s*[-~至]\s*\d{1,2}\s*(?:单|双)?\s*周)/);
  return matched?.[1]?.replace(/\s+/g, "").replace(/[~至]/, "-") ?? "";
}

function locationFrom(text: string) {
  const tokens = text.split(/\s+/).filter(Boolean);
  const token = [...tokens].reverse().find((item) => /(?:楼|教室|校区|体育馆|操场|MOOC)/i.test(item));
  if (token) return token.replace(/^@/, "");
  const matched = text.match(/@([^@]{2,60}(?:楼|教室|校区|体育馆|操场|MOOC)[^@\s]*)/i);
  return matched?.[1] ?? "";
}

function probableCourseName(text: string, location: string) {
  return text
    .replace(/\d{1,2}\s*[-~至]\s*\d{1,2}\s*(?:单|双)?\s*周/g, "")
    .replace(/(?:周|星期)[一二三四五六日天]/g, "")
    .replace(/(?:第)?\s*\d{1,2}\s*[-~至]\s*\d{1,2}\s*节?/g, "")
    .replace(location, "")
    .replace(/@[\u4e00-\u9fa5A-Za-z0-9（）()·\-]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

export function draftsFromOcrLines(lines: OcrTextLine[]): ImageCourseDraft[] {
  const seen = new Set<string>();
  const drafts: ImageCourseDraft[] = [];
  for (const line of lines) {
    const sourceText = cleanLine(line.text);
    if (sourceText.length < 2 || sourceText.length > 140 || noisePatterns.some((pattern) => pattern.test(sourceText))) continue;
    if (!looksLikeCourse(sourceText, line.confidence)) continue;
    const location = locationFrom(sourceText);
    const name = probableCourseName(sourceText, location);
    if (name.length < 2 || seen.has(name)) continue;
    seen.add(name);
    const scheduleWithoutWeeks = sourceText.replace(/\d{1,2}\s*[-~至]\s*\d{1,2}\s*(?:单|双)?\s*周/g, "");
    const [start, end] = periodsFrom(scheduleWithoutWeeks);
    drafts.push({
      id: `${drafts.length + 1}-${sourceText.slice(0, 12)}`,
      sourceText,
      confidence: Math.max(0, Math.min(100, Math.round(line.confidence))),
      record: {
        "课程名称": name,
        "教师": "",
        "地点": location,
        "星期": weekdayFrom(sourceText),
        "开始节次": start,
        "结束节次": end,
        "周次": weeksFrom(sourceText),
        "备注": "",
        "颜色": "#dce8e3",
      },
    });
    if (drafts.length >= 16) break;
  }
  return drafts;
}
