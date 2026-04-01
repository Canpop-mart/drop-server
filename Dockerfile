# syntax=docker/dockerfile:1

FROM node:lts-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

## so corepack knows pnpm's version
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
## prevent prompt to download
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
## setup for offline
RUN corepack pack
## don't call out to network anymore
ENV COREPACK_ENABLE_NETWORK=0

### INSTALL DEPS (using Debian for glibc compat during build)
FROM node:lts-slim AS build-base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack pack
ENV COREPACK_ENABLE_NETWORK=0

FROM build-base AS deps
RUN pnpm install --frozen-lockfile --ignore-scripts

### BUILD TORRENTIAL
FROM rustlang/rust:nightly-alpine AS torrential-build
RUN apk add musl-dev
WORKDIR /build
COPY torrential .
RUN apk add protoc
RUN cargo build --release

### BUILD APP (Debian-based to avoid musl/V8 OOM bug)
FROM build-base AS build-system

ENV NODE_ENV=production
ENV NUXT_TELEMETRY_DISABLED=1
## Set as ENV (not inline) so it propagates to all grandchild Node processes
ENV NODE_OPTIONS="--max-old-space-size=8192"

## add git so drop can determine its git ref at build
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*

## copy deps and rest of project files
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG BUILD_DROP_VERSION
ARG BUILD_GIT_REF

## build — call node directly on nuxt's JS entry point so --max-old-space-size
## is guaranteed to reach V8 (pnpm shell shims swallow NODE_OPTIONS)
RUN pnpm exec nuxt prepare && pnpm exec prisma generate && pnpm exec buf generate && \
    node --max-old-space-size=8192 node_modules/nuxt/bin/nuxt.mjs build


# create run environment for Drop (Debian/glibc for native module compat)
FROM build-base AS run-system

ENV NODE_ENV=production
ENV NUXT_TELEMETRY_DISABLED=1

RUN apt-get update && apt-get install -y --no-install-recommends p7zip-full nginx && rm -rf /var/lib/apt/lists/*
RUN pnpm install prisma@7.3.0
# init prisma to download all required files
RUN pnpm prisma init

COPY --from=build-system /app/prisma.config.ts ./
COPY --from=build-system /app/.output ./app
COPY --from=build-system /app/prisma ./prisma
COPY --from=build-system /app/build ./startup
COPY --from=build-system /app/build/nginx.conf /nginx.conf
COPY --from=torrential-build /build/target/release/torrential /usr/bin/

ENV LIBRARY="/library"
ENV DATA="/data"
ENV NGINX_CONFIG="/nginx.conf"
# NGINX's port
ENV PORT=4000

CMD ["sh", "/app/startup/launch.sh"]