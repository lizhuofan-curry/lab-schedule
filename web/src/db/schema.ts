import { relations, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
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

export const groups = pgTable("groups", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull(),
  createdByStudentId: bigint("created_by_student_id", { mode: "number" }).notNull().references(() => students.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("groups_name_uidx").on(table.name),
  index("groups_created_by_student_id_idx").on(table.createdByStudentId),
  check("groups_name_not_blank", sql`length(trim(${table.name})) > 0`),
  check("groups_name_length_valid", sql`char_length(${table.name}) <= 40`),
]);

export const groupMembers = pgTable("group_members", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  groupId: bigint("group_id", { mode: "number" }).notNull().references(() => groups.id, { onDelete: "cascade" }),
  studentId: bigint("student_id", { mode: "number" }).notNull().references(() => students.id, { onDelete: "restrict" }),
  role: text("role").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("group_members_group_student_uidx").on(table.groupId, table.studentId),
  uniqueIndex("group_members_one_leader_uidx").on(table.groupId).where(sql`${table.role} = 'leader'`),
  index("group_members_group_id_idx").on(table.groupId),
  index("group_members_student_id_idx").on(table.studentId),
  check("group_members_role_valid", sql`${table.role} in ('leader', 'member')`),
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

export const collabTasks = pgTable(
  "collab_tasks",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    publisherId: bigint("publisher_id", { mode: "number" })
      .notNull()
      .references(() => students.id, { onDelete: "restrict" }),
    kind: text("kind").$type<"announcement" | "assigned">().notNull(),
    delivery: text("delivery").$type<"shared" | "individual">().notNull(),
    status: text("status")
      .$type<"active" | "completed" | "cancelled">()
      .default("active")
      .notNull(),
    currentRound: integer("current_round").default(1).notNull(),
    revision: integer("revision").default(1).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("tasks_publisher_idx").on(t.publisherId),
    index("tasks_status_updated_idx").on(t.status, t.updatedAt),
    check("tasks_kind_check", sql`${t.kind} in ('announcement','assigned')`),
    check(
      "tasks_delivery_check",
      sql`${t.delivery} in ('shared','individual')`,
    ),
    check(
      "tasks_status_check",
      sql`${t.status} in ('active','completed','cancelled')`,
    ),
    check(
      "tasks_round_revision_positive",
      sql`${t.currentRound} > 0 and ${t.revision} > 0`,
    ),
  ],
);
export const taskRounds = pgTable(
  "task_rounds",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    taskId: bigint("task_id", { mode: "number" })
      .notNull()
      .references(() => collabTasks.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    deadline: timestamp("deadline", { withTimezone: true }),
    capacity: integer("capacity"),
    claimsOpen: boolean("claims_open").default(false).notNull(),
    directIds: jsonb("direct_ids").$type<number[]>().default([]).notNull(),
    groupIds: jsonb("group_ids").$type<number[]>().default([]).notNull(),
    groupNames: jsonb("group_names")
      .$type<Record<string, string>>()
      .default({})
      .notNull(),
    fileIds: jsonb("file_ids").$type<string[]>().default([]).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    outcome: text("outcome"),
  },
  (t) => [
    uniqueIndex("round_task_number_uidx").on(t.taskId, t.number),
    check(
      "round_values_check",
      sql`${t.number} > 0 and (${t.capacity} is null or ${t.capacity} > 0) and length(trim(${t.title})) > 0 and length(trim(${t.description})) > 0`,
    ),
    check(
      "round_outcome_check",
      sql`${t.outcome} is null or ${t.outcome} in ('completed','cancelled')`,
    ),
  ],
);
export const taskParticipants = pgTable(
  "task_participants",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    roundId: bigint("round_id", { mode: "number" })
      .notNull()
      .references(() => taskRounds.id, { onDelete: "cascade" }),
    studentId: bigint("student_id", { mode: "number" })
      .notNull()
      .references(() => students.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    active: boolean("active").default(true).notNull(),
    generation: integer("generation").default(1).notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    removedAt: timestamp("removed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("participant_round_student_uidx").on(t.roundId, t.studentId),
    index("participant_student_idx").on(t.studentId),
    check("participant_generation_positive", sql`${t.generation} > 0`),
  ],
);
export const taskSubmissions = pgTable(
  "task_submissions",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    roundId: bigint("round_id", { mode: "number" })
      .notNull()
      .references(() => taskRounds.id, { onDelete: "cascade" }),
    subjectKey: text("subject_key").notNull(),
    version: integer("version").notNull(),
    requestKey: text("request_key").notNull(),
    authorId: bigint("author_id", { mode: "number" })
      .notNull()
      .references(() => students.id, { onDelete: "restrict" }),
    authorName: text("author_name").notNull(),
    body: text("body").notNull(),
    links: jsonb("links").$type<string[]>().default([]).notNull(),
    fileIds: jsonb("file_ids").$type<string[]>().default([]).notNull(),
    status: text("status")
      .$type<"pending" | "returned" | "approved">()
      .default("pending")
      .notNull(),
    feedback: text("feedback"),
    reviewerId: bigint("reviewer_id", { mode: "number" }).references(
      () => students.id,
      { onDelete: "restrict" },
    ),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("submission_round_subject_version_uidx").on(
      t.roundId,
      t.subjectKey,
      t.version,
    ),
    uniqueIndex("submission_request_uidx").on(
      t.roundId,
      t.authorId,
      t.requestKey,
    ),
    index("submission_author_idx").on(t.authorId),
    index("submission_reviewer_idx").on(t.reviewerId),
    check("submission_version_positive", sql`${t.version} > 0`),
    check(
      "submission_status_check",
      sql`${t.status} in ('pending','returned','approved')`,
    ),
  ],
);
export const taskEvents = pgTable(
  "task_events",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    taskId: bigint("task_id", { mode: "number" })
      .notNull()
      .references(() => collabTasks.id, { onDelete: "cascade" }),
    roundId: bigint("round_id", { mode: "number" })
      .notNull()
      .references(() => taskRounds.id, { onDelete: "cascade" }),
    actorId: bigint("actor_id", { mode: "number" }).references(
      () => students.id,
      { onDelete: "restrict" },
    ),
    action: text("action").notNull(),
    detail: jsonb("detail")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("event_task_created_idx").on(t.taskId, t.createdAt),
    index("event_round_idx").on(t.roundId),
    index("event_actor_idx").on(t.actorId),
  ],
);
export const taskFiles = pgTable(
  "task_files",
  {
    id: text("id").primaryKey(),
    creatorId: bigint("creator_id", { mode: "number" })
      .notNull()
      .references(() => students.id, { onDelete: "restrict" }),
    taskId: bigint("task_id", { mode: "number" }).references(
      () => collabTasks.id,
      { onDelete: "restrict" },
    ),
    name: text("name").notNull(),
    size: integer("size").notNull(),
    sha256: text("sha256").notNull(),
    deletingAt: timestamp("deleting_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("file_creator_idx").on(t.creatorId),
    index("file_task_idx").on(t.taskId),
    index("file_unbound_creator_created_idx").on(t.creatorId, t.createdAt.desc(), t.id).where(sql`${t.taskId} is null`),
    check("file_delete_unbound_check", sql`${t.deletingAt} is null or ${t.taskId} is null`),
    check("file_size_check", sql`${t.size} > 0 and ${t.size} <= 10485760`),
  ],
);
export const taskNotifications = pgTable(
  "task_notifications",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    recipientId: bigint("recipient_id", { mode: "number" })
      .notNull()
      .references(() => students.id, { onDelete: "restrict" }),
    taskId: bigint("task_id", { mode: "number" })
      .notNull()
      .references(() => collabTasks.id, { onDelete: "cascade" }),
    roundId: bigint("round_id", { mode: "number" })
      .notNull()
      .references(() => taskRounds.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    message: text("message").notNull(),
    assignment: boolean("assignment").default(false).notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("notification_recipient_created_idx").on(t.recipientId, t.createdAt),
    index("notification_unread_idx")
      .on(t.recipientId)
      .where(sql`${t.readAt} is null`),
    index("notification_task_idx").on(t.taskId),
    index("notification_round_idx").on(t.roundId),
  ],
);

export const memberWorkRecords = pgTable("member_work_records", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  studentId: bigint("student_id", { mode: "number" }).notNull().references(() => students.id, { onDelete: "restrict" }),
  title: text("title").notNull(),
  description: text("description").notNull(),
  status: text("status").$type<"active" | "completed" | "paused">().default("active").notNull(),
  revision: integer("revision").default(1).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true, precision: 3 }),
  createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 }).defaultNow().notNull(),
}, (t) => [
  index("work_student_updated_idx").on(t.studentId, t.updatedAt.desc(), t.id.desc()),
  index("work_student_completed_idx").on(t.studentId, t.completedAt),
  check("work_content_check", sql`char_length(trim(${t.title})) between 1 and 120 and char_length(trim(${t.description})) between 1 and 20000`),
  check("work_status_check", sql`${t.status} in ('active','completed','paused') and ((${t.status} = 'completed') = (${t.completedAt} is not null))`),
  check("work_revision_positive", sql`${t.revision} > 0`),
]);

export const graphAnalysisState = pgTable("graph_analysis_state", {
  id: integer("id").primaryKey(),
  inputVersion: text("input_version").notNull(),
  status: text("status").$type<"pending" | "running" | "ready" | "failed">().notNull(),
  model: text("model").notNull(),
  themes: jsonb("themes").$type<{ label: string; sourceIds: string[] }[]>().default([]).notNull(),
  relations: jsonb("relations").$type<import("@/lib/graph-schema").GraphRelation[]>().default([]).notNull(),
  analyzedAt: timestamp("analyzed_at", { withTimezone: true }),
  attempts: integer("attempts").default(0).notNull(),
  retryAt: timestamp("retry_at", { withTimezone: true }).notNull(),
  leaseToken: text("lease_token"),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  calls: bigint("calls", { mode: "number" }).default(0).notNull(),
  inputTokens: bigint("input_tokens", { mode: "number" }).default(0).notNull(),
  outputTokens: bigint("output_tokens", { mode: "number" }).default(0).notNull(),
}, (t) => [
  check("graph_state_singleton", sql`${t.id} = 1`),
  check("graph_state_values", sql`${t.status} in ('pending','running','ready','failed') and ${t.attempts} >= 0 and ${t.calls} >= 0 and ${t.inputTokens} >= 0 and ${t.outputTokens} >= 0`),
  check("graph_state_version", sql`${t.inputVersion} ~ '^[0-9a-f]{64}$'`),
]);

export const graphRelationFeedback = pgTable("graph_relation_feedback", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  studentId: bigint("student_id", { mode: "number" }).notNull().references(() => students.id, { onDelete: "restrict" }),
  edgeId: text("edge_id").notNull(),
  inputVersion: text("input_version").notNull(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [
  uniqueIndex("graph_feedback_member_edge_version_uidx").on(t.studentId, t.edgeId, t.inputVersion),
  index("graph_feedback_created_idx").on(t.createdAt),
  check("graph_feedback_version", sql`${t.inputVersion} ~ '^[a-f0-9]{64}$'`),
  check("graph_feedback_reason", sql`length(trim(${t.reason})) between 1 and 1000`),
]);

export const studentRelations = relations(students, ({ one, many }) => ({
  user: one(users, { fields: [students.userId], references: [users.id] }),
  courses: many(courses),
  workRecords: many(memberWorkRecords),
  scheduleVersions: many(scheduleVersions),
  groupMemberships: many(groupMembers),
  createdGroups: many(groups),
}));

export const groupRelations = relations(groups, ({ one, many }) => ({
  createdBy: one(students, { fields: [groups.createdByStudentId], references: [students.id] }),
  members: many(groupMembers),
}));

export const groupMemberRelations = relations(groupMembers, ({ one }) => ({
  group: one(groups, { fields: [groupMembers.groupId], references: [groups.id] }),
  student: one(students, { fields: [groupMembers.studentId], references: [students.id] }),
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
