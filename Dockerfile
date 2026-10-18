FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM node:22-alpine AS runner
WORKDIR /app
RUN apk add --no-cache ffmpeg
ENV NODE_ENV=production
ENV PORT=10000
ENV STATE_DIR=/app/data
RUN addgroup -S botgroup && adduser -S botuser -G botgroup
COPY --chown=botuser:botgroup --from=deps /app/node_modules ./node_modules
COPY --chown=botuser:botgroup . .
RUN mkdir -p /app/data /app/temp \
    && chown -R botuser:botgroup /app/data /app/temp
USER botuser
EXPOSE 10000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:10000/health || exit 1
CMD ["node", "main.js"]
