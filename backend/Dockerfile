# syntax=docker/dockerfile:1
FROM node:20-bookworm-slim AS builder
WORKDIR /app

# openssl must be present so `prisma generate` can correctly detect the
# OpenSSL version and download the matching query engine binary.
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm install

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# iputils-ping is required by the `ping` package used for ICMP reachability checks.
# curl is used by the container healthcheck. openssl is required by the Prisma query engine.
RUN apt-get update && apt-get install -y --no-install-recommends iputils-ping curl openssl && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY package.json ./
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

EXPOSE 4000 514/udp 162/udp

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "dist/api/server.js"]
