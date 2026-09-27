import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const sql = postgres(databaseUrl, { max: 1, prepare: false });
const semesterName = "2026–2027 学年第一学期";
const periods = [
  [1, "第1节", "08:00", "08:45"], [2, "第2节", "08:55", "09:40"],
  [3, "第3节", "10:00", "10:45"], [4, "第4节", "10:55", "11:40"],
  [5, "第5节", "11:45", "12:30"], [6, "第6节", "14:05", "14:50"],
  [7, "第7节", "15:00", "15:45"], [8, "第8节", "15:55", "16:40"],
  [9, "第9节", "17:00", "17:45"], [10, "第10节", "17:55", "18:40"],
  [11, "第11节", "19:10", "19:55"], [12, "第12节", "20:05", "20:50"],
  [13, "第13节", "20:55", "21:40"],
];

try {
  await sql.begin(async (tx) => {
    await tx`update semesters set is_current = false, updated_at = now() where name <> ${semesterName} and is_current = true`;
    const [semester] = await tx`
      insert into semesters (name, start_date, end_date, week_count, is_current)
      values (${semesterName}, '2026-08-31', '2027-01-03', 18, true)
      on conflict (name) do update set
        start_date = excluded.start_date,
        end_date = excluded.end_date,
        week_count = excluded.week_count,
        is_current = true,
        updated_at = now()
      returning id
    `;

    for (const [periodNo, name, startTime, endTime] of periods) {
      await tx`
        insert into periods (semester_id, period_no, name, start_time, end_time)
        values (${semester.id}, ${periodNo}, ${name}, ${startTime}, ${endTime})
        on conflict (semester_id, period_no) do update set
          name = excluded.name,
          start_time = excluded.start_time,
          end_time = excluded.end_time
      `;
    }

    await tx`delete from periods where semester_id = ${semester.id} and period_no > 13`;
  });
  console.log(`Seeded ${semesterName} with ${periods.length} periods.`);
} finally {
  await sql.end();
}
