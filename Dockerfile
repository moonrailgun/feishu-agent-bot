# Stage 1: Build
FROM oven/bun:1 AS builder

WORKDIR /app

# Copy package files
COPY package.json bun.lock* ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source code
COPY . .

# Build TypeScript to JavaScript
RUN bun run build

# Stage 2: Production
FROM oven/bun:1

WORKDIR /app

# Copy package files
COPY package.json bun.lock* ./

# Install production dependencies only
RUN bun install --production --frozen-lockfile

# Copy built files from builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public

# Expose port
EXPOSE 3000

# Set environment to production
ENV NODE_ENV=production

# Start the application (websocket mode by default)
CMD ["bun", "dist/app.js"]
