import { ArkErrors, type } from "arktype";
import { GameType } from "~/prisma/client/enums";
import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

const SearchQuery = type({
  q: "string",
  take: type("string")
    .pipe((s) => Number.parseInt(s))
    .default("10"),
});

export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["store:read"]);
  if (!userId) throw createError({ statusCode: 403 });

  const query = SearchQuery(getQuery(h3));
  if (query instanceof ArkErrors)
    throw createError({ statusCode: 400, statusMessage: query.summary });

  const limit = Math.min(Math.max(query.take, 1), 25);
  const searchTerm = query.q.trim();

  if (searchTerm.length === 0) {
    return { results: [] };
  }

  // Use PostgreSQL trigram similarity for fuzzy full-text search
  // This leverages the existing GiST index on mName
  const results: {
    id: string;
    mName: string;
    mIconObjectId: string;
    mCoverObjectId: string;
    mShortDescription: string;
    mReleased: string;
    similarity: number;
  }[] = await prisma.$queryRaw`
    SELECT id, "mName", "mIconObjectId", "mCoverObjectId", "mShortDescription", "mReleased",
           SIMILARITY("mName", ${searchTerm}) as similarity
    FROM "Game"
    WHERE SIMILARITY("mName", ${searchTerm}) > 0.1
      AND type = ${GameType.Game}::"GameType"
    ORDER BY SIMILARITY("mName", ${searchTerm}) DESC
    LIMIT ${limit};
  `;

  return {
    results: results.map((r) => ({
      id: r.id,
      name: r.mName,
      icon: r.mIconObjectId,
      cover: r.mCoverObjectId,
      description: r.mShortDescription,
      released: r.mReleased,
      similarity: r.similarity,
    })),
  };
});
