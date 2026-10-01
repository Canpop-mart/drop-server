/**
 * Profile themes: the one list of accent presets used by every surface that
 * shows or edits a profile (the desktop client, Big Picture, and the web
 * pages in drop-server).
 *
 * A stored `profileTheme` is either a preset id below or a custom `#rrggbb`.
 * Every surface must render every stored value as itself, never as the
 * fallback, so a preset can be added here but never removed or renamed.
 *
 * Two identical copies of this file exist: drop-app
 * main/composables/profile-themes.ts (the client) and drop-server
 * server/internal/utils/profile-themes.ts (the server validates against it and
 * the web pages render from it). It is tested in drop-app
 * (main/tests/profile-themes.test.ts), which also compares the two copies when
 * the repos sit side by side; drop-server has no test runner. Keep them in
 * step.
 */

export interface ProfileThemePreset {
  id: string;
  /** Player-facing name. */
  label: string;
  /** The accent the desktop profile threads through text, rings and buttons. */
  accent: string;
  /** Banner gradient used by Big Picture and the web pages. */
  from: string;
  to: string;
}

export const DEFAULT_PROFILE_THEME = "default";

export const PROFILE_THEME_PRESETS: readonly ProfileThemePreset[] = [
  {
    id: "default",
    label: "Default",
    accent: "#3b82f6",
    from: "#1e3a5f",
    to: "#581c87",
  },
  {
    id: "ocean",
    label: "Ocean",
    accent: "#0ea5e9",
    from: "#0c4a6e",
    to: "#164e63",
  },
  {
    id: "arctic",
    label: "Arctic",
    accent: "#06b6d4",
    from: "#0e7490",
    to: "#1e40af",
  },
  {
    id: "forest",
    label: "Forest",
    accent: "#22c55e",
    from: "#14532d",
    to: "#1a2e05",
  },
  {
    id: "sunset",
    label: "Sunset",
    accent: "#f97316",
    from: "#9a3412",
    to: "#831843",
  },
  {
    id: "ember",
    label: "Ember",
    accent: "#f59e0b",
    from: "#7c2d12",
    to: "#451a03",
  },
  {
    id: "rose",
    label: "Rose",
    accent: "#f43f5e",
    from: "#9f1239",
    to: "#4c0519",
  },
  {
    id: "purple",
    label: "Purple",
    accent: "#a855f7",
    from: "#581c87",
    to: "#3b0764",
  },
  {
    id: "midnight",
    label: "Midnight",
    accent: "#6366f1",
    from: "#1e1b4b",
    to: "#0f172a",
  },
];

const HEX_RE = /^#[0-9a-f]{6}$/i;

export function isCustomProfileTheme(theme?: string | null): boolean {
  return !!theme && HEX_RE.test(theme);
}

export function findProfileThemePreset(
  theme?: string | null,
): ProfileThemePreset | undefined {
  if (!theme) return undefined;
  return PROFILE_THEME_PRESETS.find((p) => p.id === theme);
}

/**
 * The stored form of a theme value: a preset id as-is, a custom colour in
 * lower case, or null if it is neither.
 */
export function normalizeProfileTheme(theme?: string | null): string | null {
  if (isCustomProfileTheme(theme)) return theme!.toLowerCase();
  if (findProfileThemePreset(theme)) return theme!;
  return null;
}

function defaultPreset(): ProfileThemePreset {
  return findProfileThemePreset(DEFAULT_PROFILE_THEME)!;
}

/** The accent hex for a stored theme. Unknown values get the default. */
export function resolveAccentHex(theme?: string | null): string {
  if (isCustomProfileTheme(theme)) return theme!.toLowerCase();
  return (findProfileThemePreset(theme) ?? defaultPreset()).accent;
}

/**
 * The two-stop banner gradient for a stored theme. A custom colour gets a
 * darkened pair of its own hue so it sits like the presets do.
 */
export function resolveThemeGradient(theme?: string | null): {
  from: string;
  to: string;
} {
  if (isCustomProfileTheme(theme)) {
    const { h, s, l } = rgbToHsl(hexToRgb(theme!));
    const fromL = Math.min(Math.max(l, 0.18), 0.38);
    return {
      from: hslToHex(h, s, fromL),
      to: hslToHex(h, s, Math.max(fromL - 0.15, 0.08)),
    };
  }
  const p = findProfileThemePreset(theme) ?? defaultPreset();
  return { from: p.from, to: p.to };
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function hexToRgb(hex: string): Rgb {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (x: number) => `0${Math.round(x).toString(16)}`.slice(-2);
  return `#${c(r)}${c(g)}${c(b)}`;
}

function rgbToHsl({ r, g, b }: Rgb): { h: number; s: number; l: number } {
  r /= 255;
  g /= 255;
  b /= 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (mx + mn) / 2;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h =
      mx === r
        ? (g - b) / d + (g < b ? 6 : 0)
        : mx === g
          ? (b - r) / d + 2
          : (r - g) / d + 4;
    h /= 6;
  }
  return { h, s, l };
}

function hslToHex(h: number, s: number, l: number): string {
  let r: number;
  let g: number;
  let b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hue = (t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    r = hue(h + 1 / 3);
    g = hue(h);
    b = hue(h - 1 / 3);
  }
  return rgbToHex(r * 255, g * 255, b * 255);
}

/**
 * The desktop profile's CSS custom properties, derived from one accent hex.
 * `--accent` is lightness-clamped so text and icons stay legible on the dark
 * background even for a near-black or near-white custom colour, while
 * `--accent-raw` and the banner gradient keep the user's true colour (they sit
 * behind the page scrim).
 */
export function accentVars(hex: string): Record<string, string> {
  const rgb = hexToRgb(hex);
  const { h, s, l } = rgbToHsl(rgb);
  const fg = hslToHex(h, Math.max(s, 0.5), Math.min(Math.max(l, 0.58), 0.82));
  const bannerTo = hslToHex(h, s, Math.max(l - 0.3, 0.1));
  const lum = 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b;
  return {
    "--accent-raw": hex,
    "--accent": fg,
    "--accent-soft": `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.14)`,
    "--accent-border": `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.42)`,
    "--accent-contrast": lum > 150 ? "#000000" : "#ffffff",
    "--profile-banner": `linear-gradient(135deg, ${hex}, ${bannerTo})`,
  };
}
