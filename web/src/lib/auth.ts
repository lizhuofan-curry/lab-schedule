import { and, eq, isNull } from "drizzle-orm";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { username } from "better-auth/plugins";
import { db } from "@/db";
import * as schema from "@/db/schema";

function normalizeStudentNo(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function internalEmail(studentNo: string) {
  return `${studentNo}@members.local`;
}

const authBaseUrl = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
const configuredOrigins = (process.env.BETTER_AUTH_TRUSTED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const trustedOrigins = [...new Set([authBaseUrl, ...configuredOrigins])];

export const auth = betterAuth({
  appName: "同频课表",
  baseURL: authBaseUrl,
  secret: process.env.BETTER_AUTH_SECRET ?? "build-time-placeholder-secret-change-in-production",
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
    },
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    autoSignIn: true,
  },
  trustedOrigins,
  rateLimit: {
    enabled: true,
    window: 60,
    max: 20,
  },
  advanced: {
    useSecureCookies: authBaseUrl.startsWith("https://"),
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/sign-up/email") return;

      const studentNo = normalizeStudentNo(ctx.body.username);
      const name = typeof ctx.body.name === "string" ? ctx.body.name.trim() : "";
      const email = typeof ctx.body.email === "string" ? ctx.body.email.trim().toLowerCase() : "";

      if (!studentNo || !name || email !== internalEmail(studentNo)) {
        throw new APIError("BAD_REQUEST", { message: "请使用姓名和学号完成注册。" });
      }

      const [student] = await db.select({ id: schema.students.id })
        .from(schema.students)
        .where(and(
          eq(schema.students.studentNo, studentNo),
          eq(schema.students.name, name),
          eq(schema.students.enabled, true),
          isNull(schema.students.userId),
        ))
        .limit(1);

      if (!student) {
        throw new APIError("UNPROCESSABLE_ENTITY", { message: "姓名和学号不在名册中，或该学号已经注册。" });
      }
    }),
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          const studentNo = normalizeStudentNo(user.username);
          if (!studentNo) return;

          const bound = await db.update(schema.students)
            .set({ userId: user.id, updatedAt: new Date() })
            .where(and(
              eq(schema.students.studentNo, studentNo),
              eq(schema.students.name, user.name.trim()),
              eq(schema.students.enabled, true),
              isNull(schema.students.userId),
            ))
            .returning({ id: schema.students.id });

          if (bound.length !== 1) {
            throw new APIError("CONFLICT", { message: "名册绑定失败，请联系项目维护者处理。" });
          }
        },
      },
    },
  },
  plugins: [
    username({
      minUsernameLength: 4,
      maxUsernameLength: 32,
      usernameValidator: (value) => /^[a-zA-Z0-9_-]+$/.test(value),
      immutableUsername: true,
      displayUsername: false,
    }),
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;
