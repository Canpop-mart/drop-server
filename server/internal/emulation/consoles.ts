/*
Canonical console registry for the emulation library view.

Drop has no explicit "console"/"system" field on a game — a ROM game's system
is implied by its file extension. Three places already encode ext knowledge:
the admin `ROM_EXTENSIONS` set (GameEditor/Version.vue), the client's
`EXTENSION_CORE_MAP` (remote/src/retroarch/cores.rs), and now this. This is the
single server-side source the console grouping uses; the others can be derived
from it over time.

Each console lists the ROM extensions that map to it. Some extensions are
genuinely ambiguous (`.iso` spans GameCube/Wii/PS2/PSP/Saturn; `.chd`/`.cue`
span PS1/Saturn) — they're assigned here to their most common system, matching
the primary core in EXTENSION_CORE_MAP. The client can refine disc-based cases
later via header sniffing (it already does this at launch). `.bin` is left out
on purpose: it's too ambiguous (raw track, BIOS, or Genesis dump) and real ROM
games carry a `.cue`/`.md` alongside it.

Extensions are stored lowercase, without the leading dot. Order matters: the
first console claiming an extension wins, so list specific systems before
catch-alls.
*/
export interface ConsoleDef {
  /** Stable slug used in routes + the toggle. */
  id: string;
  /** Display name, e.g. "PlayStation". */
  name: string;
  /** Compact label for tight UI, e.g. "PS1". */
  shortName: string;
  /** Maker, used only for grouping/ordering in the UI. */
  maker: string;
  /** One calm line for the console detail header. */
  blurb: string;
  /** ROM extensions (lowercase, no dot) that imply this console. */
  exts: string[];
}

// Ordered by maker then era. Only consoles with games render in the UI.
export const CONSOLES: ConsoleDef[] = [
  // Nintendo
  {
    id: "nes",
    name: "Nintendo Entertainment System",
    shortName: "NES",
    maker: "Nintendo",
    blurb: "Nintendo's 8-bit home console.",
    exts: ["nes", "fds", "unf"],
  },
  {
    id: "snes",
    name: "Super Nintendo",
    shortName: "SNES",
    maker: "Nintendo",
    blurb: "Nintendo's 16-bit home console.",
    exts: ["sfc", "smc"],
  },
  {
    id: "n64",
    name: "Nintendo 64",
    shortName: "N64",
    maker: "Nintendo",
    blurb: "Nintendo's 64-bit cartridge console.",
    exts: ["z64", "n64", "v64", "ndd"],
  },
  {
    id: "gamecube",
    name: "GameCube",
    shortName: "GC",
    maker: "Nintendo",
    blurb: "Nintendo's mini-disc console.",
    exts: ["gcm", "gcz", "rvz"],
  },
  {
    id: "wii",
    name: "Wii",
    shortName: "Wii",
    maker: "Nintendo",
    blurb: "Nintendo's motion-controlled console.",
    exts: ["wbfs", "wia", "nkit"],
  },
  {
    id: "switch",
    name: "Nintendo Switch",
    shortName: "Switch",
    maker: "Nintendo",
    blurb: "Nintendo's hybrid handheld console.",
    exts: ["xci", "nsp"],
  },
  {
    id: "gb",
    name: "Game Boy",
    shortName: "GB",
    maker: "Nintendo",
    blurb: "Nintendo's original handheld.",
    exts: ["gb"],
  },
  {
    id: "gbc",
    name: "Game Boy Color",
    shortName: "GBC",
    maker: "Nintendo",
    blurb: "The color Game Boy.",
    exts: ["gbc"],
  },
  {
    id: "gba",
    name: "Game Boy Advance",
    shortName: "GBA",
    maker: "Nintendo",
    blurb: "Nintendo's 32-bit handheld.",
    exts: ["gba"],
  },
  {
    id: "nds",
    name: "Nintendo DS",
    shortName: "DS",
    maker: "Nintendo",
    blurb: "Nintendo's dual-screen handheld.",
    exts: ["nds", "dsi"],
  },
  {
    id: "3ds",
    name: "Nintendo 3DS",
    shortName: "3DS",
    maker: "Nintendo",
    blurb: "Nintendo's stereoscopic handheld.",
    exts: ["3ds", "cia"],
  },
  {
    id: "virtualboy",
    name: "Virtual Boy",
    shortName: "VB",
    maker: "Nintendo",
    blurb: "Nintendo's stereoscopic oddity.",
    exts: ["vb"],
  },
  {
    id: "pokemonmini",
    name: "Pokémon Mini",
    shortName: "Mini",
    maker: "Nintendo",
    blurb: "The smallest official handheld.",
    exts: ["min"],
  },
  // Sony
  {
    id: "ps1",
    name: "PlayStation",
    shortName: "PS1",
    maker: "Sony",
    blurb: "Sony's debut disc console.",
    exts: ["cue", "chd", "pbp", "m3u"],
  },
  {
    id: "ps2",
    name: "PlayStation 2",
    shortName: "PS2",
    maker: "Sony",
    blurb: "Sony's best-selling console.",
    exts: ["iso"],
  },
  {
    id: "psp",
    name: "PlayStation Portable",
    shortName: "PSP",
    maker: "Sony",
    blurb: "Sony's widescreen handheld.",
    exts: ["psp", "cso"],
  },
  {
    id: "vita",
    name: "PlayStation Vita",
    shortName: "Vita",
    maker: "Sony",
    blurb: "Sony's second handheld.",
    exts: ["vpk"],
  },
  // Sega
  {
    id: "sms",
    name: "Sega Master System",
    shortName: "SMS",
    maker: "Sega",
    blurb: "Sega's 8-bit console.",
    exts: ["sms", "sg"],
  },
  {
    id: "genesis",
    name: "Sega Genesis",
    shortName: "Genesis",
    maker: "Sega",
    blurb: "Sega's 16-bit console (Mega Drive).",
    exts: ["md", "gen", "smd"],
  },
  {
    id: "sega32x",
    name: "Sega 32X",
    shortName: "32X",
    maker: "Sega",
    blurb: "The Genesis 32-bit add-on.",
    exts: ["32x"],
  },
  {
    id: "gamegear",
    name: "Game Gear",
    shortName: "GG",
    maker: "Sega",
    blurb: "Sega's color handheld.",
    exts: ["gg"],
  },
  // Microsoft
  {
    id: "xbox",
    name: "Xbox",
    shortName: "Xbox",
    maker: "Microsoft",
    blurb: "Microsoft's debut console.",
    exts: ["xex", "xbe"],
  },
  // Atari + others
  {
    id: "atari2600",
    name: "Atari 2600",
    shortName: "2600",
    maker: "Atari",
    blurb: "The console that started it all.",
    exts: ["a26"],
  },
  {
    id: "atari7800",
    name: "Atari 7800",
    shortName: "7800",
    maker: "Atari",
    blurb: "Atari's 8-bit successor.",
    exts: ["a78"],
  },
  {
    id: "lynx",
    name: "Atari Lynx",
    shortName: "Lynx",
    maker: "Atari",
    blurb: "Atari's color handheld.",
    exts: ["lnx"],
  },
  {
    id: "jaguar",
    name: "Atari Jaguar",
    shortName: "Jaguar",
    maker: "Atari",
    blurb: "Atari's final console.",
    exts: ["j64"],
  },
  {
    id: "pcengine",
    name: "PC Engine",
    shortName: "PCE",
    maker: "NEC",
    blurb: "NEC's compact 8-bit console (TurboGrafx-16).",
    exts: ["pce"],
  },
  {
    id: "neogeopocket",
    name: "Neo Geo Pocket",
    shortName: "NGP",
    maker: "SNK",
    blurb: "SNK's monochrome and color handheld.",
    exts: ["ngp", "ngc"],
  },
  {
    id: "wonderswan",
    name: "WonderSwan",
    shortName: "WS",
    maker: "Bandai",
    blurb: "Bandai's portable, designed by the Game Boy's creator.",
    exts: ["ws", "wsc"],
  },
  {
    id: "vectrex",
    name: "Vectrex",
    shortName: "Vectrex",
    maker: "GCE",
    blurb: "The vector-display console.",
    exts: ["vec"],
  },
  {
    id: "colecovision",
    name: "ColecoVision",
    shortName: "Coleco",
    maker: "Coleco",
    blurb: "Coleco's arcade-faithful console.",
    exts: ["col"],
  },
  {
    id: "intellivision",
    name: "Intellivision",
    shortName: "Intv",
    maker: "Mattel",
    blurb: "Mattel's early home console.",
    exts: ["int"],
  },
];

// Reverse index: extension (no dot, lowercase) -> first console that claims it.
const EXT_TO_CONSOLE: Map<string, ConsoleDef> = (() => {
  const m = new Map<string, ConsoleDef>();
  for (const c of CONSOLES) {
    for (const ext of c.exts) {
      if (!m.has(ext)) m.set(ext, c);
    }
  }
  return m;
})();

/** Fallback bucket for emulated games whose extension isn't in the registry. */
export const OTHER_CONSOLE: ConsoleDef = {
  id: "other",
  name: "Other Emulated",
  shortName: "Other",
  maker: "",
  blurb: "Emulated games that don't match a known console.",
  exts: [],
};

function normalizeExt(ext: string): string {
  // Accept ".z64", "z64", "*.cue", or even "game.cue" — take the last dot
  // segment so however suggestions are stored, we compare bare extensions.
  const s = ext.trim().toLowerCase();
  const dot = s.lastIndexOf(".");
  return dot >= 0 ? s.slice(dot + 1) : s;
}

/**
 * Map a set of ROM-extension suggestions to a console. Returns the first
 * matching console in registry order, or null if none of the extensions are
 * recognized (caller decides whether to use OTHER_CONSOLE).
 */
export function consoleForExtensions(exts: string[]): ConsoleDef | null {
  for (const raw of exts) {
    const hit = EXT_TO_CONSOLE.get(normalizeExt(raw));
    if (hit) return hit;
  }
  return null;
}

export function consoleById(id: string): ConsoleDef | null {
  if (id === OTHER_CONSOLE.id) return OTHER_CONSOLE;
  return CONSOLES.find((c) => c.id === id) ?? null;
}
