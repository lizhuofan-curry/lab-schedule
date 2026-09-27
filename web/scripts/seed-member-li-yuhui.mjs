import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const sql = postgres(databaseUrl, { max: 1, prepare: false });
const allWeeks = Array.from({ length: 18 }, (_, index) => index + 1);
const oddWeeks = allWeeks.filter((week) => week % 2 === 1);

const member = {
  name: "李昱辉",
  studentNo: "2410250973",
};
const defaultCourseColor = "#dce8e3";

// 同一门课每周有多个上课时段时，每个时段作为一条记录保存。
const courseSlots = [
  { name: "马克思主义基本原理概论", teacher: "殷华成", location: "金明综合楼6101", weekday: 5, startPeriod: 3, endPeriod: 5, weeks: allWeeks, color: defaultCourseColor },
  { name: "数字通信原理", teacher: "蒋磊", location: "金明综合楼6202", weekday: 4, startPeriod: 11, endPeriod: 12, weeks: allWeeks, color: defaultCourseColor },
  { name: "网络信息安全技术", teacher: "罗来干", location: "金明综合楼6202", weekday: 5, startPeriod: 7, endPeriod: 8, weeks: allWeeks, color: defaultCourseColor },
  { name: "网络管理与测试", teacher: "程普", location: "金明综合楼2103", weekday: 2, startPeriod: 1, endPeriod: 2, weeks: allWeeks, color: defaultCourseColor },
  { name: "网络管理与测试", teacher: "程普", location: "金明综合楼2103", weekday: 2, startPeriod: 3, endPeriod: 4, weeks: oddWeeks, color: defaultCourseColor },
  { name: "计算机操作系统", teacher: "胡萍", location: "金明综合楼6402", weekday: 1, startPeriod: 9, endPeriod: 10, weeks: allWeeks, color: defaultCourseColor },
  { name: "计算机操作系统", teacher: "胡萍", location: "金明综合楼6402", weekday: 2, startPeriod: 6, endPeriod: 8, weeks: allWeeks, color: defaultCourseColor },
  { name: "Python开发与应用", teacher: "楚广琳", location: "金明综合楼2102", weekday: 1, startPeriod: 1, endPeriod: 2, weeks: allWeeks, color: defaultCourseColor },
  { name: "Python开发与应用", teacher: "楚广琳", location: "金明综合楼2102", weekday: 4, startPeriod: 3, endPeriod: 4, weeks: allWeeks, color: defaultCourseColor },
  { name: "网络协议设计与分析", teacher: "郭念", location: "金明综合楼1201", weekday: 3, startPeriod: 7, endPeriod: 8, weeks: allWeeks, color: defaultCourseColor },
  { name: "网络协议设计与分析", teacher: "郭念", location: "金明综合楼1201", weekday: 4, startPeriod: 1, endPeriod: 2, weeks: allWeeks, color: defaultCourseColor },
];

try {
  const result = await sql.begin(async (tx) => {
    const [semester] = await tx`
      select id
      from semesters
      where is_current = true
      limit 1
    `;
    if (!semester) throw new Error("未找到当前学期，请先执行 npm run db:seed");

    const [student] = await tx`
      insert into students (name, student_no, enabled)
      values (${member.name}, ${member.studentNo}, true)
      on conflict (student_no) do update set
        name = excluded.name,
        enabled = true,
        updated_at = now()
      returning id, name, student_no
    `;

    let inserted = 0;
    for (const course of courseSlots) {
      const updated = await tx`
        update courses
        set teacher = ${course.teacher},
            location = ${course.location},
            color = ${course.color},
            updated_at = now()
        where student_id = ${student.id}
          and semester_id = ${semester.id}
          and name = ${course.name}
          and weekday = ${course.weekday}
          and start_period = ${course.startPeriod}
          and end_period = ${course.endPeriod}
          and weeks = ${course.weeks}
        returning id
      `;
      if (updated.length > 0) continue;

      const rows = await tx`
        insert into courses (
          student_id, semester_id, name, teacher, location,
          weekday, start_period, end_period, weeks, color
        )
        select
          ${student.id}, ${semester.id}, ${course.name}, ${course.teacher}, ${course.location},
          ${course.weekday}, ${course.startPeriod}, ${course.endPeriod}, ${course.weeks}, ${course.color}
        where not exists (
          select 1
          from courses
          where student_id = ${student.id}
            and semester_id = ${semester.id}
            and name = ${course.name}
            and weekday = ${course.weekday}
            and start_period = ${course.startPeriod}
            and end_period = ${course.endPeriod}
            and weeks = ${course.weeks}
        )
        returning id
      `;
      inserted += rows.length;
    }

    return { student, inserted };
  });

  console.log(`已同步成员 ${result.student.name}（${result.student.student_no}），新增 ${result.inserted} 个课程时段。`);
} finally {
  await sql.end();
}
