# Standby build of groundgoat-website for gg-app-1.
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_TILES_URL
ARG NEXT_PUBLIC_SCRAPER_URL
ARG NEXT_PUBLIC_IS_SANDBOX
ARG NEXT_PUBLIC_LIVE_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_TILES_URL=$NEXT_PUBLIC_TILES_URL
ENV NEXT_PUBLIC_SCRAPER_URL=$NEXT_PUBLIC_SCRAPER_URL
ENV NEXT_PUBLIC_IS_SANDBOX=$NEXT_PUBLIC_IS_SANDBOX
ENV NEXT_PUBLIC_LIVE_URL=$NEXT_PUBLIC_LIVE_URL
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app ./
EXPOSE 3000
# Railway injects PORT; the AWS compose stack maps 3000 (the default).
CMD ["sh", "-c", "npx next start -p ${PORT:-3000}"]
