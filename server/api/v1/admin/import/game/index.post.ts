import { type } from "arktype";
import { GameType } from "~/prisma/client/enums";
import { readDropValidatedBody, throwingArktype } from "~/server/arktype";
import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import libraryManager from "~/server/internal/library";
import metadataHandler from "~/server/internal/metadata";
import taskHandler from "~/server/internal/tasks";
import { pickLaunchesFromPreload } from "~/server/internal/library/import/pickLaunches";

const ImportGameBody = type({
  library: "string",
  path: "string",
  type: type.valueOf(GameType),
  ["metadata?"]: {
    id: "string",
    sourceId: "string",
    name: "string",
  },
  // For multi-disc games: the ordered list of actual disc folder names
  // (e.g. ["Xenogears (USA) (Disc 1)", "Xenogears (USA) (Disc 2)"])
  ["discFolders?"]: "string[]",
  // For type=Mod games: the base game this mod applies to. Optional here —
  // it can also be assigned later in the admin game editor. Validated below.
  ["parentGameId?"]: "string",
  // One-click "import game + first version": when true, after the game
  // is created the endpoint auto-queues a version import IF exactly one
  // unimported version is discovered. The admin UI gates this behind a
  // single confirm modal.
  autoImportFirstVersion: "boolean = false",
}).configure(throwingArktype);

export default defineEventHandler<{ body: typeof ImportGameBody.infer }>(
  async (h3) => {
    const allowed = await aclManager.allowSystemACL(h3, ["import:game:new"]);
    if (!allowed) throw createError({ statusCode: 403 });

    const {
      library,
      path,
      metadata,
      type,
      discFolders,
      parentGameId,
      autoImportFirstVersion,
    } = await readDropValidatedBody(h3, ImportGameBody);

    if (!path)
      throw createError({
        statusCode: 400,
        statusMessage: "Path missing from body",
      });

    // A mod's parent must be an existing base game (type=Game). Reject a
    // parent that is itself a mod so we never build a mod-of-mod chain.
    if (parentGameId) {
      const parent = await prisma.game.findUnique({
        where: { id: parentGameId },
        select: { type: true },
      });
      if (!parent)
        throw createError({
          statusCode: 400,
          statusMessage: "Parent game not found.",
        });
      if (parent.type !== GameType.Game)
        throw createError({
          statusCode: 400,
          statusMessage: "Parent must be a base game, not a mod or dependency.",
        });
    }

    const valid = await libraryManager.checkUnimportedGamePath(library, path);
    if (!valid)
      throw createError({
        statusCode: 400,
        statusMessage: "Invalid library or game.",
      });

    // ── Plain game import ────────────────────────────────────────────
    if (!autoImportFirstVersion) {
      const created = metadata
        ? await metadataHandler.createGame(
            metadata,
            library,
            path,
            type,
            discFolders,
            undefined,
            parentGameId,
          )
        : await metadataHandler.createGameWithoutMetadata(
            library,
            path,
            type,
            discFolders,
            undefined,
            parentGameId,
          );

      if (!created)
        throw createError({
          statusCode: 400,
          statusMessage:
            "Duplicate metadata import. Please chose a different game or metadata provider.",
        });

      return { taskId: created.taskId, gameId: created.gameId };
    }

    // ── One-click: game import + first-version import in one task ─────
    // A wrapper task nests the game import as a child, then — if exactly
    // one unimported version exists — nests the version import too. Both
    // children are awaited (the task runner awaits child tasks).
    const wrapperId = await taskHandler.create({
      taskGroup: "import:game",
      name: `Import "${metadata?.name ?? path}" + first version`,
      acls: ["system:import:game:read"],
      async run(ctx) {
        ctx.markPhase("game");
        const created = metadata
          ? await metadataHandler.createGame(
              metadata,
              library,
              path,
              type,
              discFolders,
              ctx,
              parentGameId,
            )
          : await metadataHandler.createGameWithoutMetadata(
              library,
              path,
              type,
              discFolders,
              ctx,
              parentGameId,
            );
        if (!created) {
          throw new Error(
            "Duplicate metadata import — game already exists for this metadata.",
          );
        }

        ctx.markPhase("discover-versions");
        const unimported = await libraryManager.fetchUnimportedGameVersions(
          library,
          path,
        );
        if (!unimported || unimported.length === 0) {
          ctx.logger.info(
            "[one-click] No unimported versions found — game import only.",
          );
          return;
        }
        if (unimported.length !== 1) {
          ctx.logger.info(
            `[one-click] ${unimported.length} unimported versions found — ` +
              `skipping auto-import (only auto-imports when exactly one).`,
          );
          return;
        }

        const only = unimported[0];
        ctx.logger.info(
          `[one-click] Exactly one version ("${only.name}") — auto-importing it.`,
        );
        const preload = await libraryManager.fetchUnimportedVersionInformation(
          created.gameId,
          only,
        );
        if (!preload || preload.length === 0) {
          ctx.logger.warn(
            `[one-click] No executables auto-discovered for "${only.name}" — ` +
              `skipping auto-import. Use the version wizard to finish.`,
          );
          return;
        }
        const picked = pickLaunchesFromPreload(preload, false);

        ctx.markPhase("version");
        await libraryManager.importVersion(
          created.gameId,
          only,
          {
            id: created.gameId,
            version: only,
            launches: picked.launches,
            setups: picked.setups,
            onlySetup: false,
            delta: false,
            requiredContent: [],
          },
          ctx,
        );
        ctx.logger.info(`[one-click] Finished importing "${only.name}".`);
      },
    });

    return { taskId: wrapperId, autoImportFirstVersion: true };
  },
);
