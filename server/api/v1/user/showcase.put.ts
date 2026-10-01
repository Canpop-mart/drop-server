import { type } from "arktype";
import { readDropValidatedBody, throwingArktype } from "~/server/arktype";
import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import {
  MAX_SHOWCASE_ITEMS,
  achievementVariantKey,
  newAchievementItems,
  showcaseSizeProblem,
} from "~/server/internal/userprofile/limits";

const ShowcaseItem = type({
  type: "'FavoriteGame' | 'Achievement' | 'GameStats' | 'Custom'",
  gameId: "string | null | undefined",
  itemId: "string | null | undefined",
  title: "string | undefined",
  data: "unknown | undefined",
});

const ShowcaseBody = type({
  items: ShowcaseItem.array(),
}).configure(throwingArktype);

export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["profile:update"]);
  if (!userId) throw createError({ statusCode: 403 });

  const body = await readDropValidatedBody(h3, ShowcaseBody);

  if (body.items.length > MAX_SHOWCASE_ITEMS) {
    throw createError({
      statusCode: 400,
      statusMessage: `Maximum ${MAX_SHOWCASE_ITEMS} showcase items allowed.`,
    });
  }

  // Items stored exactly as sent are not size-checked: see showcaseSizeProblem.
  const storedItems = await prisma.profileShowcase.findMany({
    where: { userId },
    select: { type: true, gameId: true, itemId: true, title: true, data: true },
  });
  const sizeProblem = showcaseSizeProblem(body.items, storedItems);
  if (sizeProblem)
    throw createError({ statusCode: 400, statusMessage: sizeProblem });

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

  // An achievement card must name an achievement of its game that this user
  // has unlocked (on any provider's variant of it). Cards already stored are
  // not re-checked: see newAchievementItems.
  const toCheck = newAchievementItems(
    body.items,
    storedItems.filter((s) => s.type === "Achievement"),
  );
  if (toCheck.length > 0) {
    for (const item of toCheck) {
      if (!item.gameId || !item.itemId)
        throw createError({
          statusCode: 400,
          statusMessage: "An achievement card needs a game and an achievement.",
        });
    }
    const achievements = await prisma.achievement.findMany({
      where: { id: { in: toCheck.map((i) => i.itemId!) } },
      select: { id: true, gameId: true, externalId: true, title: true },
    });
    const byId = new Map(achievements.map((a) => [a.id, a]));
    for (const item of toCheck) {
      const ach = byId.get(item.itemId!);
      if (!ach || ach.gameId !== item.gameId)
        throw createError({
          statusCode: 400,
          statusMessage: `Achievement ${item.itemId} is not an achievement of that game.`,
        });
    }
    const unlocked = await prisma.userAchievement.findMany({
      where: {
        userId,
        achievement: {
          OR: achievements.map((a) => ({
            gameId: a.gameId,
            externalId: a.externalId,
          })),
        },
      },
      select: { achievement: { select: { gameId: true, externalId: true } } },
    });
    const unlockedKeys = new Set(
      unlocked.map((u) =>
        achievementVariantKey(u.achievement.gameId, u.achievement.externalId),
      ),
    );
    for (const item of toCheck) {
      const ach = byId.get(item.itemId!)!;
      if (!unlockedKeys.has(achievementVariantKey(ach.gameId, ach.externalId)))
        throw createError({
          statusCode: 400,
          statusMessage: `You have not unlocked "${ach.title}".`,
        });
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
