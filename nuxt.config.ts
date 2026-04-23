import tailwindcss from "@tailwindcss/vite";
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import module from "node:module";
import { fileURLToPath } from "node:url";
import { type } from "arktype";

const packageJsonSchema = type({
  name: "string",
  version: "string",
});

const twemojiPackage = module.findPackageJSON(
  "@discordapp/twemoji",
  import.meta.url,
);
if (!twemojiPackage) {
  throw new Error("Could not find @discordapp/twemoji package.");
}
const twemojiAssetsPath = path.join(
  path.dirname(twemojiPackage),
  "dist",
  "svg",
);

// get drop version
const dropVersion = getDropVersion();

// get git ref or supply during build
const commitHash =
  process.env.BUILD_GIT_REF ??
  execSync("git rev-parse --short HEAD").toString().trim();

console.log(`Drop ${dropVersion} #${commitHash}`);

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  extends: ["./drop-base"],
  // Module config from here down

  modules: [
    "vue3-carousel-nuxt",
    "nuxt-security", // "@nuxt/image",
    "@nuxt/fonts",
    "@nuxt/eslint",
    "@nuxtjs/i18n",
    "@vueuse/nuxt",
  ],

  // Nuxt-only config
  telemetry: false,
  compatibilityDate: "2024-04-03",
  devtools: {
    enabled: true,
    telemetry: false,
    timeline: {
      // this seems to be the tracking issue, composables not registered
      // https://github.com/nuxt/devtools/issues/662
      enabled: false,
    },
  },
  css: ["~/assets/tailwindcss.css", "~/assets/core.scss"],

  sourcemap: false,

  experimental: {
    buildCache: true,
    viewTransition: false,
    appManifest: false,
    componentIslands: true,
  },

  // future: {
  //   compatibilityVersion: 4,
  // },

  vite: {
    plugins: [
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tailwindcss() as any,
    ],
  },

  runtimeConfig: {
    gitRef: commitHash,
    dropVersion: dropVersion,
  },

  app: {
    head: {
      link: [{ rel: "icon", href: "/favicon.ico" }],
    },
  },

  routeRules: {
    // CORS is handled by nuxt-security's corsHandler (see security block below).
    // The Tauri client uses the server:// custom protocol which bypasses CORS
    // entirely; CORS only gates browser-based callers.

    // Save uploads use JSON with base64-encoded data (~33% overhead),
    // so they need a higher body limit than the default 10MB.
    "/api/v1/client/saves/upload": {
      security: {
        requestSizeLimiter: {
          maxRequestSizeInBytes: 75 * 1024 * 1024, // 75MB (50MB file + base64 overhead)
        },
      },
    },
    "/api/v1/client/saves/bulk-upload": {
      security: {
        requestSizeLimiter: {
          maxRequestSizeInBytes: 200 * 1024 * 1024, // 200MB (multiple saves)
        },
      },
    },

    // Strict rate limits on authentication endpoints — 10 attempts per minute per IP.
    // This is more than a human will ever hit but tight enough to blunt credential
    // stuffing and TOTP brute-force. Legitimate users who trigger it can retry after
    // a minute; the nuxt-security limiter responds with 429 + Retry-After.
    "/api/v1/auth/signin/**": {
      security: {
        rateLimiter: {
          tokensPerInterval: 10,
          interval: 60000, // 1 minute
        },
      },
    },
    "/api/v1/auth/signup/**": {
      security: {
        rateLimiter: {
          tokensPerInterval: 5,
          interval: 60000,
        },
      },
    },
    "/api/v1/auth/mfa/**": {
      security: {
        rateLimiter: {
          tokensPerInterval: 10,
          interval: 60000,
        },
      },
    },
    "/api/v1/auth/passkey/**": {
      security: {
        rateLimiter: {
          tokensPerInterval: 10,
          interval: 60000,
        },
      },
    },
    // Search + metadata scrape: cap at 30/min per IP. High enough for normal browsing,
    // low enough to prevent scraper-amplification (us hitting Steam/GiantBomb in a loop).
    "/api/v1/store/search": {
      security: {
        rateLimiter: {
          tokensPerInterval: 30,
          interval: 60000,
        },
      },
    },
    "/api/v1/admin/metadata/**": {
      security: {
        rateLimiter: {
          tokensPerInterval: 20,
          interval: 60000,
        },
      },
    },

    // redirect old OIDC callback route
    "/auth/callback/oidc": {
      redirect: "/api/v1/auth/oidc/callback",
    },
  },

  devServer: {
    port: 4000,
  },

  nitro: {
    sourceMap: false,
    minify: true,
    compressPublicAssets: true,

    experimental: {
      websocket: true,
      tasks: true,
      openAPI: true,
    },

    openAPI: {
      // tracking for dynamic openapi schema https://github.com/nitrojs/nitro/issues/2974
      // create body from types: https://github.com/nitrojs/nitro/issues/3275
      meta: {
        title: "Drop",
        description:
          "Drop is an open-source, self-hosted game distribution platform, creating a Steam-like experience for DRM-free games.",
        version: dropVersion,
      },
    },

    scheduledTasks: {
      "0 * * * *": ["dailyTasks"],
    },

    storage: {
      appCache: {
        driver: "lru-cache",
      },
    },

    devStorage: {
      appCache: {
        // store cache on fs to handle dev server restarts
        driver: "fs",
        base: "./.data/appCache",
      },
    },

    serverAssets: [
      {
        baseName: "twemoji",
        // get path to twemoji svg assets
        dir: twemojiAssetsPath,
      },
    ],
  },

  typescript: {
    typeCheck: true,

    tsConfig: {
      compilerOptions: {
        verbatimModuleSyntax: false,
        strictNullChecks: true,
        exactOptionalPropertyTypes: true,
      },
    },
  },

  carousel: {
    prefix: "Vue",
  },

  i18n: {
    bundle: {
      optimizeTranslationDirective: false,
    },
    defaultLocale: "en-us",
    lazy: true,
    strategy: "no_prefix",
    experimental: {
      localeDetector: "localeDetector.ts",
      autoImportTranslationFunctions: true,
    },
    detectBrowserLanguage: {
      useCookie: true,
      cookieKey: "drop_i18n_redirected",
      fallbackLocale: "en-us",
    },
    locales: [
      { code: "en-us", language: "en-us", name: "English", file: "en_us.json" },
      {
        code: "en-gb",
        language: "en-gb",
        name: "English (UK)",
        file: "en_gb.json",
      },
      {
        code: "en-au",
        language: "en-au",
        name: "English (Australia)",
        file: "en_au.json",
      },
      {
        code: "en-pirate",
        language: "en-pirate",
        name: "English (Pirate)",
        file: "en_pirate.json",
      },
      {
        code: "fr",
        language: "fr",
        name: "French",
        file: "fr.json",
      },
      {
        code: "de",
        language: "de",
        name: "German",
        file: "de.json",
      },
      {
        code: "it",
        language: "it",
        name: "Italian",
        file: "it.json",
      },
      {
        code: "es",
        language: "es",
        name: "Spanish",
        file: "es.json",
      },
      {
        code: "zh",
        language: "zh",
        name: "Chinese",
        file: "zh.json",
      },
      {
        code: "zh-tw",
        language: "zh-tw",
        name: "Chinese (Taiwan)",
        file: "zh_tw.json",
      },
    ],
  },

  security: {
    // Subresource Integrity: disabled because Nuxt injects inline module scripts
    // that don't have stable hashes. Revisit when SRI support lands in nuxt-security
    // for module preloads.
    sri: false,
    headers: {
      contentSecurityPolicy: {
        // In production force every http:// subresource to https://. In dev we
        // allow http because vite's HMR and localhost metadata scrapes are http.
        "upgrade-insecure-requests": process.env.NODE_ENV === "production",

        "img-src": [
          "'self'",
          "data:",
          "https://www.giantbomb.com",
          "https://images.pcgamingwiki.com",
          "https://images.igdb.com",
          "https://*.steamstatic.com",
          "https://media.retroachievements.org",
        ],
        // Script sources:
        //   - 'self' and Nuxt's own inline scripts (Nuxt generates an inline
        //     bootstrap blob that can't be externalized). In dev, 'unsafe-eval'
        //     is required for Vite HMR. In production we drop 'unsafe-eval' and
        //     keep a nonce-compatible baseline.
        //   - The 'strict-dynamic' keyword would be ideal but requires every
        //     Nuxt-generated script to carry a matching nonce, which nuxt-security
        //     can add but requires additional wiring (routeRules). TODO for next
        //     pass: move to nonce-based CSP with strict-dynamic.
        "script-src":
          process.env.NODE_ENV === "production"
            ? ["'self'", "'unsafe-inline'"]
            : ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
        // Default-deny fetch sources; explicit allow list for what we actually call.
        "connect-src": [
          "'self'",
          "https://api.steampowered.com",
          "https://store.steampowered.com",
          "https://steamcommunity.com",
          "https://www.pcgamingwiki.com",
          "https://www.giantbomb.com",
          "https://retroachievements.org",
          "https://*.retroachievements.org",
        ],
        // Block Flash / legacy plugins outright.
        "object-src": ["'none'"],
        // Only allow framing from same origin (the Tauri client iframes server://
        // which resolves to this origin via the custom protocol proxy).
        "frame-ancestors": ["'self'"],
        // Prevent <base href> injection from redirecting relative URLs.
        "base-uri": ["'self'"],
        // Block form POSTs to other origins.
        "form-action": ["'self'"],
      },
      // Enable HSTS in production with a 6-month max-age and preload readiness.
      // Disabled in dev because localhost is http://.
      strictTransportSecurity:
        process.env.NODE_ENV === "production"
          ? {
              maxAge: 15552000, // 6 months
              includeSubdomains: true,
              preload: false, // flip to true once you're ready to submit to hstspreload.org
            }
          : false,
      // Prevent MIME sniffing.
      xContentTypeOptions: "nosniff",
      // Deny framing entirely by header (CSP frame-ancestors above is the modern
      // equivalent; this header is the legacy fallback).
      xFrameOptions: "SAMEORIGIN",
      // Minimise referrer leakage to cross-origin destinations.
      referrerPolicy: "strict-origin-when-cross-origin",
    },
    // Global rate limiter — 1000 req/min. Per-endpoint stricter limits are applied
    // via routeRules below (auth endpoints get much tighter limits).
    rateLimiter: {
      tokensPerInterval: 1000,
      interval: 60000, // 1 minute
      headers: true,
    },
    // xssValidator off: nuxt-security's xss validator scans request bodies with
    // a legacy HTML sanitizer that false-positives on Markdown content we legitimately
    // accept (game descriptions, news articles). Content sanitization is done at
    // render time with DOMPurify instead (see components that use v-html).
    xssValidator: false,
    requestSizeLimiter: {
      maxRequestSizeInBytes: 10 * 1024 * 1024, // 10MB
      maxUploadFileRequestInBytes: 50 * 1024 * 1024, // 50MB
    },
    // Restrict CORS origins in production. In dev, allow all (localhost testing).
    // The Tauri client uses the server:// protocol which doesn't trigger CORS at
    // all (requests are proxied natively), so this only affects web-browser clients.
    corsHandler: {
      origin:
        process.env.NODE_ENV === "production"
          ? (process.env.ALLOWED_ORIGINS?.split(",").map((o) => o.trim()) ?? [])
          : "*",
      methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"],
      credentials: true,
    },
  },
});

/**
 * Gets the drop version from the environment variable or package.json
 * @returns {string} The drop version
 */
function getDropVersion(): string {
  // get drop version from environment variable
  if (process.env.BUILD_DROP_VERSION) {
    return process.env.BUILD_DROP_VERSION;
  }
  // example nightly: "v0.3.0-nightly.2025.05.28"
  const defaultVersion = "v0.0.0-alpha.0";

  const packageJsonPath = fileURLToPath(import.meta.resolve("./package.json"));

  if (!existsSync(packageJsonPath)) {
    console.error("Could not find package.json, using default version.");
    return defaultVersion;
  }

  // parse package.json
  const raw = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
  const packageJson = packageJsonSchema(raw);
  if (packageJson instanceof type.errors) {
    console.error("Failed to parse package.json", packageJson.summary);
    return defaultVersion;
  }

  // ensure version starts with 'v'
  if (packageJson.version.startsWith("v")) {
    return packageJson.version;
  }
  return `v${packageJson.version}`;
}
