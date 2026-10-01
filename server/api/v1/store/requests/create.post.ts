import { type } from "arktype";
import { readDropValidatedBody, throwingArktype } from "~/server/arktype";
import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import { MetadataSource, RequestStatus } from "~/prisma/client/enums";
import type { CreateRequestConflict } from "~/server/internal/requests";
import {
  REQUEST_DESCRIPTION_MAX,
  REQUEST_TITLE_MAX,
  REQUEST_URL_MAX,
  requestRefSelect,
} from "~/server/internal/requests";
import {
  findDuplicateRequest,
  steamAppIdFromUrl,
} from "~/server/internal/requests/matching";

// arktype: `"key?": "type"` makes the property truly optional (can be absent
// from the body). Lengths and URL shapes are checked by hand below so the
// error names the field in plain words.
const CreateRequest = type({
  title: "string",
  description: "string = ''",
  "igdbUrl?": "string",
  "steamUrl?": "string",
  // The provider match the requester picked, if any.
  "metadata?": {
    sourceId: "string",
    id: "string",
    name: "string",
  },
  // Submit even though a request with the same title is open. Ignored for a
  // same-game (provider id or Steam link) duplicate, which is always
  // refused: the pages offer a vote on the existing request instead, showing
  // its title and the game it was matched to.
  "allowSimilar?": "boolean",
}).configure(throwingArktype);

function badRequest(message: string): never {
  throw createError({ statusCode: 400, statusMessage: message });
}

function checkUrl(value: string | undefined, label: string) {
  const url = value?.trim();
  if (!url) return undefined;
  if (url.length > REQUEST_URL_MAX) badRequest(`${label} is too long.`);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    badRequest(`${label} is not a valid link.`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
    badRequest(`${label} must be a web link.`);
  return url;
}

export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["store:read"]);
  if (!userId) throw createError({ statusCode: 403 });

  const body = await readDropValidatedBody(h3, CreateRequest);

  const title = body.title.trim();
  if (!title) badRequest("A title is required.");
  if (title.length > REQUEST_TITLE_MAX)
    badRequest(`Title must be ${REQUEST_TITLE_MAX} characters or fewer.`);
  const description = body.description.trim();
  if (description.length > REQUEST_DESCRIPTION_MAX)
    badRequest(
      `Description must be ${REQUEST_DESCRIPTION_MAX} characters or fewer.`,
    );
  const steamUrl = checkUrl(body.steamUrl, "Steam link");
  const igdbUrl = checkUrl(body.igdbUrl, "IGDB link");

  let metadata: { source: MetadataSource; id: string; name: string } | null =
    null;
  if (body.metadata) {
    const source = body.metadata.sourceId as MetadataSource;
    if (
      !Object.values(MetadataSource).includes(source) ||
      source === MetadataSource.Manual ||
      !body.metadata.id.trim()
    )
      badRequest("Unknown game match. Search again and pick a result.");
    metadata = {
      source,
      id: body.metadata.id.trim(),
      name: body.metadata.name.trim().slice(0, REQUEST_TITLE_MAX),
    };
  }

  // Already in the library? Then there is nothing to request.
  const steamId = steamAppIdFromUrl(steamUrl);
  const libraryKeys = [
    ...(metadata
      ? [{ metadataSource: metadata.source, metadataId: metadata.id }]
      : []),
    ...(steamId
      ? [{ metadataSource: MetadataSource.Steam, metadataId: steamId }]
      : []),
  ];
  if (libraryKeys.length > 0) {
    const existingGame = await prisma.game.findFirst({
      where: { OR: libraryKeys },
      select: { id: true, mName: true },
    });
    if (existingGame) {
      const data: CreateRequestConflict = {
        reason: "in-library",
        game: { id: existingGame.id, name: existingGame.mName },
      };
      throw createError({
        statusCode: 409,
        statusMessage: "This game is already in the library.",
        data,
      });
    }
  }

  const open = await prisma.gameRequest.findMany({
    where: { status: { in: [RequestStatus.Pending, RequestStatus.Approved] } },
    select: { ...requestRefSelect, requesterId: true },
  });
  const duplicate = findDuplicateRequest(
    {
      title,
      metadata: metadata ? { source: metadata.source, id: metadata.id } : null,
      steamUrl: steamUrl ?? null,
    },
    open,
  );
  if (duplicate && (duplicate.reason === "metadata" || !body.allowSimilar)) {
    const existing = open.find((r) => r.id === duplicate.request.id)!;
    const data: CreateRequestConflict = {
      reason: duplicate.reason === "metadata" ? "duplicate" : "similar",
      request: {
        id: existing.id,
        title: existing.title,
        status: existing.status,
        mine: existing.requesterId === userId,
        matchedName: existing.metadataName,
      },
    };
    throw createError({
      statusCode: 409,
      statusMessage:
        duplicate.reason === "metadata"
          ? "This game has already been requested."
          : "A request with the same title already exists.",
      data,
    });
  }

  const request = await prisma.gameRequest.create({
    data: {
      title,
      description,
      requesterId: userId,
      ...(igdbUrl ? { igdbUrl } : {}),
      ...(steamUrl ? { steamUrl } : {}),
      ...(metadata
        ? {
            metadataSource: metadata.source,
            metadataId: metadata.id,
            metadataName: metadata.name,
          }
        : {}),
    },
  });

  return request;
});
