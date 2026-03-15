# ISS Sourcing — production Dockerfile
# Build: docker build -t iss-sourcing .
# Run:   docker run -p 5000:5000 -e DATABASE_URL=... -e SESSION_SECRET=... iss-sourcing

# Stage 1: build client and server
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build

# Stage 2: production runtime
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=5000

# Copy package files and install production deps only
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Copy built server bundle and client static assets (vite outputs to dist/public)
COPY --from=builder /app/dist ./dist

EXPOSE 5000

CMD ["node", "dist/index.js"]
