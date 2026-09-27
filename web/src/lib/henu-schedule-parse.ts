import * as cheerio from "cheerio";

// 解析河大选课系统网格课表 HTML（xskcb10319.jsp 返回的片段）。

export type HenuParsedCourse = {
  name: string;
  teacher: string;
  weekday: number;
  startPeriod: number;
  endPeriod: number;
  weeks: number[];
  location: string;
};

// "1-18" / "1-18 单" / "1-18 双" / "1-12" / "3-18" → 具体周次数组（BR-04）。
function parseWeeks(text: string): number[] {
  const range = text.match(/(\d+)-(\d+)/);
  if (!range) return [];
  const start = Number(range[1]);
  const end = Number(range[2]);
  const weeks = Array.from({ length: end - start + 1 }, (_, index) => start + index);
  if (text.includes("单")) return weeks.filter((week) => week % 2 === 1);
  if (text.includes("双")) return weeks.filter((week) => week % 2 === 0);
  return weeks;
}

// 解析单个课程单元格：<font>课程名</font><br>教师 <br>周次 [节次]<br>地点
function parseCourseCell(innerHtml: string, weekday: number): HenuParsedCourse | null {
  const name = innerHtml.match(/<font[^>]*>([^<]*)<\/font>/i)?.[1]?.trim();
  if (!name) return null;

  const parts = innerHtml
    .replace(/<font[^>]*>[^<]*<\/font>/i, "")
    .split(/<br\s*\/?\s*>/i)
    .map((part) => part.replace(/<[^>]+>/g, "").replace(/&ensp;|&nbsp;/g, " ").trim())
    .filter(Boolean);

  const timing = parts[1] ?? "";
  const period = timing.match(/\[(\d+)-(\d+)\]/);
  if (!period) return null; // 无节次信息（如「1-18周」的环节课程），不纳入网格课表

  return {
    name,
    teacher: parts[0] ?? "",
    weekday,
    startPeriod: Number(period[1]),
    endPeriod: Number(period[2]),
    weeks: parseWeeks(timing.replace(/\[.*\]/, "").trim()),
    location: parts[2] ?? "",
  };
}

export function parseScheduleGrid(html: string): HenuParsedCourse[] {
  const $ = cheerio.load(html);
  const courses: HenuParsedCourse[] = [];

  const table = $("table#mytable").first();
  if (!table.length) return courses;

  table.find("tr").each((_, row) => {
    if ($(row).hasClass("H")) return; // 表头行
    const weekdayCells = $(row).find("td").toArray().slice(-7); // 每行最后 7 个 td = 星期一到日
    weekdayCells.forEach((cell, index) => {
      const weekday = index + 1;
      $(cell).find("div[style*='padding-bottom']").each((_, div) => {
        const course = parseCourseCell($(div).html() ?? "", weekday);
        if (course && course.weeks.length > 0) courses.push(course);
      });
    });
  });

  return courses;
}
