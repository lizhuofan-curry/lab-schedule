import assert from "node:assert/strict";
import test from "node:test";
import { parseScheduleGrid } from "./henu-schedule-parse.ts";

test("解析河大网格课表并展开单双周", () => {
  const empty = "<td></td>";
  const html = `<table id="mytable">
    <tr class="H"><td>节次</td>${empty.repeat(7)}</tr>
    <tr><td>上午</td>
      <td><div style="padding-bottom: 6px"><font>网络协议设计与分析</font><br>郭念<br>1-18周 [7-8]<br>金明综合楼1201</div></td>
      ${empty}
      <td><div style="padding-bottom: 6px"><font>数字通信原理</font><br>蒋磊<br>1-18周 双 [11-12]<br>金明综合楼6202</div></td>
      ${empty.repeat(4)}
    </tr>
  </table>`;

  const courses = parseScheduleGrid(html);
  assert.equal(courses.length, 2);
  assert.deepEqual(courses[0], {
    name: "网络协议设计与分析",
    teacher: "郭念",
    weekday: 1,
    startPeriod: 7,
    endPeriod: 8,
    weeks: Array.from({ length: 18 }, (_, index) => index + 1),
    location: "金明综合楼1201",
  });
  assert.equal(courses[1].weekday, 3);
  assert.deepEqual(courses[1].weeks, [2, 4, 6, 8, 10, 12, 14, 16, 18]);
});

test("缺少课表或节次信息时不生成错误课程", () => {
  assert.deepEqual(parseScheduleGrid("<p>登录失效</p>"), []);
  assert.deepEqual(parseScheduleGrid(`<table id="mytable"><tr><td></td><td><div style="padding-bottom:1px"><font>实践环节</font><br>教师<br>1-18周<br>地点</div></td>${"<td></td>".repeat(6)}</tr></table>`), []);
});
