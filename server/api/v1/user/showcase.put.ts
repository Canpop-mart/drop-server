import { type } from "arktype";
import { readDropValidatedBody, throwingArktype } from "~/server/arktype";
import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

const MAX_SHOWCASE_ITEMS = 6;

const ShowcaseItem = type({
  type: "'FavoriteGame' | 'Achievement' | 'Review' | 'GameStats' | 'Custom'",
  gameId: "string | null | undefined",
  itemId: "string | null | undefined",
  title: "string | undefined",
  data: "unknown | undefined",
});

const ShowcaseBody = type({
  items: ShowcaseItem.array(),
}).configure(throwingArktype);

export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["read"]);
  if (!userId) throw createError({ statusCode: 403 });

  const body = await readDropValidatedBody(h3, ShowcaseBody);

  if (body.items.length > MAX_SHOWCASE_ITEMS) {
    throw createError({
      statusCode: 400,
      statusMessage: `Maximum ${MAX_SHOWCASE_ITEMS} showcase items allowed.`,
    });
  }

  // Validate gameIds exist
  const gameIds = [
    ...new Set(
      body.items.map((i) => i.gameId).filter((id): id is string => !!id),
    ),
  ];
  if (gameIds.length > 0) {
    const existingGames = await prisma.game.findMany({
      where: { id: { in: gameIds } },
      select: { id: true },
    });
    const existingIds = new Set(existingGames.map((g) => g.id));
    for (const gid of gameIds) {
      if (!existingIds.has(gid)) {
        throw createError({
          statusCode: 400,
          statusMessage: `Game ${gid} does not exist.`,
        });
      }
    }
  }

  // Replace all showcase items in a transaction
  await prisma.$transaction(async (tx) => {
    await tx.profileShowcase.deleteMany({ where: { userId } });

    if (body.items.length > 0) {
      await tx.profileShowcase.createMany({
        data: body.items.map((item, idx) => ({
          userId,
          type: item.type as never,
          gameId: item.gameId ?? null,
          itemId: item.itemId ?? null,
          title: item.title ?? "",
          data: item.data ?? undefined,
          sortOrder: idx,
        })),
      });
    }
  });

  // Return updated showcase
  const updated = await prisma.profileShowcase.findMany({
    where: { userId },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      type: true,
      gameId: true,
      itemId: true,
      title: true,
      data: true,
      sortOrder: true,
    },
  });

  return { items: updated };
});
