import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// 构建阶段不会访问数据库，因此允许使用不可连接的占位地址；
// Docker 启动时会通过环境变量强制提供真实连接串。
const databaseUrl = process.env.DATABASE_URL ?? "postgresql://schedule:build-only@127.0.0.1:5432/schedule";

const globalForDatabase = globalThis as unknown as { sqlClient?: ReturnType<typeof postgres> };

export const sqlClient = globalForDatabase.sqlClient ?? postgres(databaseUrl, {
  max: process.env.NODE_ENV === "production" ? 5 : 2,
  idle_timeout: 20,
  connect_timeout: 10,
  prepare: false,
});

if (process.env.NODE_ENV !== "production") globalForDatabase.sqlClient = sqlClient;

export const db = drizzle(sqlClient, { schema });
