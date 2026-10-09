FROM node:24-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS runtime-dependencies
# The image also runs database migrations, so drizzle-kit is a runtime dependency.
# Exclude lint/test tools (including their unpatched glob dependency) from production.
RUN npm prune --omit=dev

FROM node:24-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
RUN mkdir -p /app/data/task-files && chown -R nextjs:nodejs /app/data
COPY --from=runtime-dependencies /app/node_modules ./node_modules
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/next.config.ts ./
COPY --from=builder /app/drizzle.config.ts ./
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/src/db ./src/db
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
# Next.js standalone 不会自动把静态资源放到 standalone 运行目录。
COPY --from=builder --chown=nextjs:nodejs /app/public ./.next/standalone/public
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/standalone/.next/static
USER nextjs
EXPOSE 3000
CMD ["node", ".next/standalone/server.js"]
