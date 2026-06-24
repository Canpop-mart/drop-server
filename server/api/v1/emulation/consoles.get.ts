/*
Console grouping for the library's emulation view.

Returns, for every console that has at least one emulated game on the server,
the list of game IDs that belong to it. A game is "emulated" exactly as the
store endpoint decides it: its latest version's launch carries an `emulatorId`
or a non-empty `emulatorSuggestions` list. The console is derived from those
suggested ROM extensions via the shared console registry.

The client intersects these IDs with the games it actually has in its library
(the same way collection shelves resolve), so this can return server-wide IDs
without leaking anything the client can't already see via the library fetch.

Emulator runtimes themselves (type=Emulator — RetroArch, DuckStation, …) are
excluded: they're the players, not the content.
*/
import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import { GameType } from "~/prisma/client/enums";
import {
  CONSOLES,
  OTHER_CONSOLE,
  consoleForExtensions,
  type ConsoleDef,
} from "~/server/internal/emulation/consoles";

export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["store:read"]);
  if (!userId) throw createError({ statusCode: 403 });

  const games = await prisma.game.findMany({
    where: {
      type: { not: GameType.Emulator },
      versions: {
        some: {
          launches: {
            some: {
              OR: [
                { emulatorId: { not: null } },
                { NOT: { emulatorSuggestions: { isEmpty: true } } },
              ],
            },
          },
        },
      },
    },
    select: {
      id: true,
      // Latest version only — its launch config decides the console.
      versions: {
        select: {
          launches: {
            select: { emulatorId: true, emulatorSuggestions: true },
          },
        },
        orderBy: { versionIndex: "desc" },
        take: 1,
      },
    },
  });

  // console id -> ordered, de-duplicated game ids
  const byConsole = new Map<string, string[]>();
  const push = (consoleId: string, gameId: string) => {
    const arr = byConsole.get(consoleId);
    if (arr) arr.push(gameId);
    else byConsole.set(consoleId, [gameId]);
  };

  for (const g of games) {
    const latest = g.versions[0];
    if (!latest) continue;
    // The emulated launch (a game may also have a native launch alongside).
    const launch = latest.launches.find(
      (l) => l.emulatorId != null || l.emulatorSuggestions.length > 0,
    );
    if (!launch) continue;

    const matched = consoleForExtensions(launch.emulatorSuggestions);
    // No extension match but still emulated (e.g. emulatorId set, no
    // suggestions) -> the catch-all bucket so nothing goes missing.
    push((matched ?? OTHER_CONSOLE).id, g.id);
  }

  // Emit in registry order, OTHER last, skipping empty consoles.
  const ordered: ConsoleDef[] = [...CONSOLES, OTHER_CONSOLE];
  const consoles = ordered
    .filter((c) => byConsole.has(c.id))
    .map((c) => ({
      id: c.id,
      name: c.name,
      shortName: c.shortName,
      maker: c.maker,
      blurb: c.blurb,
      gameIds: byConsole.get(c.id)!,
    }));

  return { consoles };
});
