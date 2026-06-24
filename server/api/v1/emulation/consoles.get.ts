/*
Console grouping for the library's emulation view.

In Drop, ROM/console games are organized into per-console libraries that use
the "Compatibility" (FlatFilesystem) backend — one library per system, named
by the operator (e.g. "PlayStation 2", "Super Nintendo"). PC games and the
emulator binaries themselves live in standard "Drop-style" (Filesystem)
libraries. So a console is simply a FlatFilesystem library, and its games are
that library's games.

Grouping by library (rather than guessing a console from each ROM's file
extension) is exact: it can't pull in a PC game, never dumps everything into a
catch-all bucket, and the console name is whatever the operator called the
library. The client intersects these IDs with the games it actually has.
*/
import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import { LibraryBackend } from "~/prisma/client/enums";

export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["store:read"]);
  if (!userId) throw createError({ statusCode: 403 });

  const libraries = await prisma.library.findMany({
    where: { backend: LibraryBackend.FlatFilesystem },
    select: {
      id: true,
      name: true,
      games: { select: { id: true } },
    },
    orderBy: { name: "asc" },
  });

  const consoles = libraries
    .filter((lib) => lib.games.length > 0)
    .map((lib) => ({
      id: lib.id,
      name: lib.name,
      shortName: lib.name,
      maker: "",
      blurb: "",
      gameIds: lib.games.map((g) => g.id),
    }));

  return { consoles };
});
