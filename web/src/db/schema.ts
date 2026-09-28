import { relations, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const users = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  username: text("username").unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const sessions = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
}, (table) => [index("session_user_id_idx").on(table.userId)]);

export const accounts = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("account_user_id_idx").on(table.userId)]);

export const verifications = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("verification_identifier_idx").on(table.identifier)]);

export const students = pgTable("students", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull(),
  studentNo: text("student_no"),
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  enabled: boolean("enabled").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("students_student_no_uidx").on(table.studentNo),
  uniqueIndex("students_user_id_uidx").on(table.userId).where(sql`${table.userId} is not null`),
  check("students_student_no_not_blank", sql`${table.studentNo} is null or length(trim(${table.studentNo})) > 0`),
  check("students_name_not_blank", sql`length(trim(${table.name})) > 0`),
]);

export const semesters = pgTable("semesters", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull(),
  startDate: date("start_date", { mode: "string" }).notNull(),
  endDate: date("end_date", { mode: "string" }).notNull(),
  weekCount: smallint("week_count").notNull(),
  isCurrent: boolean("is_current").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("semesters_name_uidx").on(table.name),
  uniqueIndex("semesters_current_uidx").on(table.isCurrent).where(sql`${table.isCurrent} = true`),
  check("semesters_dates_valid", sql`${table.startDate} <= ${table.endDate}`),
  check("semesters_week_count_valid", sql`${table.weekCount} between 1 and 30`),
]);

export const periods = pgTable("periods", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  semesterId: bigint("semester_id", { mode: "number" }).notNull().references(() => semesters.id, { onDelete: "restrict" }),
  periodNo: smallint("period_no").notNull(),
  name: text("name").notNull(),
  startTime: time("start_time").notNull(),
  endTime: time("end_time").notNull(),
}, (table) => [
  uniqueIndex("periods_semester_no_uidx").on(table.semesterId, table.periodNo),
  index("periods_semester_id_idx").on(table.semesterId),
  check("periods_no_valid", sql`${table.periodNo} between 1 and 20`),
  check("periods_time_valid", sql`${table.startTime} < ${table.endTime}`),
]);

export const courses = pgTable("courses", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  studentId: bigint("student_id", { mode: "number" }).notNull().references(() => students.id, { onDelete: "restrict" }),
  semesterId: bigint("semester_id", { mode: "number" }).notNull().references(() => semesters.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  teacher: text("teacher"),
  location: text("location"),
  weekday: smallint("weekday").notNull(),
  startPeriod: smallint("start_period").notNull(),
  endPeriod: smallint("end_period").notNull(),
  weeks: smallint("weeks").array().notNull(),
  note: text("note"),
  color: text("color").default("#dce8e3").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("courses_student_semester_idx").on(table.studentId, table.semesterId),
  index("courses_semester_weekday_idx").on(table.semesterId, table.weekday),
  index("courses_student_id_idx").on(table.studentId),
  index("courses_semester_id_idx").on(table.semesterId),
  index("courses_weeks_gin_idx").using("gin", table.weeks),
  check("courses_name_not_blank", sql`length(trim(${table.name})) > 0`),
  check("courses_weekday_valid", sql`${table.weekday} between 1 and 7`),
  check("courses_period_range_valid", sql`${table.startPeriod} >= 1 and ${table.startPeriod} <= ${table.endPeriod}`),
  check("courses_weeks_not_empty", sql`cardinality(${table.weeks}) > 0`),
]);

export const auditLogs = pgTable("audit_logs", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  before: text("before_json"),
  after: text("after_json"),
  ipHash: text("ip_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("audit_actor_created_idx").on(table.actorUserId, table.createdAt),
  index("audit_entity_idx").on(table.entityType, table.entityId),
]);

export const scheduleVersions = pgTable("schedule_versions", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  studentId: bigint("student_id", { mode: "number" }).notNull().references(() => students.id, { onDelete: "restrict" }),
  semesterId: bigint("semester_id", { mode: "number" }).notNull().references(() => semesters.id, { onDelete: "restrict" }),
  versionNo: integer("version_no").notNull(),
  source: text("source").notNull(),
  fileName: text("file_name"),
  courseCount: integer("course_count").notNull(),
  createdByUserId: text("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("schedule_versions_student_semester_version_uidx").on(table.studentId, table.semesterId, table.versionNo),
  index("schedule_versions_student_semester_created_idx").on(table.studentId, table.semesterId, table.createdAt),
  index("schedule_versions_student_id_idx").on(table.studentId),
  index("schedule_versions_semester_id_idx").on(table.semesterId),
  index("schedule_versions_created_by_user_id_idx").on(table.createdByUserId),
  check("schedule_versions_version_positive", sql`${table.versionNo} > 0`),
  check("schedule_versions_source_valid", sql`${table.source} in ('csv', 'xlsx', 'henu', 'text', 'image')`),
  check("schedule_versions_course_count_valid", sql`${table.courseCount} >= 0`),
]);

export const courseSnapshots = pgTable("course_snapshots", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  scheduleVersionId: bigint("schedule_version_id", { mode: "number" }).notNull().references(() => scheduleVersions.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  teacher: text("teacher"),
  location: text("location"),
  weekday: smallint("weekday").notNull(),
  startPeriod: smallint("start_period").notNull(),
  endPeriod: smallint("end_period").notNull(),
  weeks: smallint("weeks").array().notNull(),
  note: text("note"),
  color: text("color").default("#dce8e3").notNull(),
}, (table) => [
  index("course_snapshots_schedule_version_id_idx").on(table.scheduleVersionId),
  index("course_snapshots_schedule_version_weekday_idx").on(table.scheduleVersionId, table.weekday),
  check("course_snapshots_name_not_blank", sql`length(trim(${table.name})) > 0`),
  check("course_snapshots_weekday_valid", sql`${table.weekday} between 1 and 7`),
  check("course_snapshots_period_range_valid", sql`${table.startPeriod} >= 1 and ${table.startPeriod} <= ${table.endPeriod}`),
  check("course_snapshots_weeks_not_empty", sql`cardinality(${table.weeks}) > 0`),
]);

export const studentRelations = relations(students, ({ one, many }) => ({
  user: one(users, { fields: [students.userId], references: [users.id] }),
  courses: many(courses),
  scheduleVersions: many(scheduleVersions),
}));

export const courseRelations = relations(courses, ({ one }) => ({
  student: one(students, { fields: [courses.studentId], references: [students.id] }),
  semester: one(semesters, { fields: [courses.semesterId], references: [semesters.id] }),
}));

export const semesterRelations = relations(semesters, ({ many }) => ({ periods: many(periods), courses: many(courses), scheduleVersions: many(scheduleVersions) }));

export const periodRelations = relations(periods, ({ one }) => ({ semester: one(semesters, { fields: [periods.semesterId], references: [semesters.id] }) }));

export const scheduleVersionRelations = relations(scheduleVersions, ({ one, many }) => ({
  student: one(students, { fields: [scheduleVersions.studentId], references: [students.id] }),
  semester: one(semesters, { fields: [scheduleVersions.semesterId], references: [semesters.id] }),
  createdBy: one(users, { fields: [scheduleVersions.createdByUserId], references: [users.id] }),
  snapshots: many(courseSnapshots),
}));

export const courseSnapshotRelations = relations(courseSnapshots, ({ one }) => ({
  version: one(scheduleVersions, { fields: [courseSnapshots.scheduleVersionId], references: [scheduleVersions.id] }),
}));
