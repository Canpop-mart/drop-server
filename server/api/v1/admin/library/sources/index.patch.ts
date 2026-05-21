import { type } from "arktype";
import { readDropValidatedBody, throwingArktype } from "~/server/arktype";
import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import libraryManager from "~/server/internal/library";
import type { WorkingLibrarySource } from "~/server/api/v1/admin/library/sources/index.get";
import { libraryConstructors } from "~/server/plugins/05.library-init";

const UpdateLibrarySource = type({
  id: "string",
  name: "string",
  options: "object",
  // Optional opt-out for the GBE steam_api DLL auto-swap. Default ON
  // matches the historical behaviour; admins flip it off when the
  // library is full of pre-fixed games whose crack DLLs must be
  // preserved. See server/internal/gbe.ts → ensureGbeDll.
  autoSwapSteamApiDll: "boolean?",
  // Optional opt-out for the whole emulator-setup phase of version
  // imports. Default ON. When OFF the `setupEmulators` phase is a full
  // no-op (no Goldberg achievement setup, no DLL swap) for every game
  // in this library. Strictly broader than autoSwapSteamApiDll.
  autoEmulatorSetup: "boolean?",
}).configure(throwingArktype);

export default defineEventHandler<{ body: typeof UpdateLibrarySource.infer }>(
  async (h3) => {
    const allowed = await aclManager.allowSystemACL(h3, [
      "library:sources:update",
      "setup",
    ]);
    if (!allowed) throw createError({ statusCode: 403 });

    const body = await readDropValidatedBody(h3, UpdateLibrarySource);

    const source = await prisma.library.findUnique({ where: { id: body.id } });
    if (!source)
      throw createError({
        statusCode: 400,
        statusMessage: "Library source not found",
      });

    const constructor = libraryConstructors[source.backend];

    const newLibrary = constructor(body.options, source.id);

    // Test we can actually use it
    if ((await newLibrary.listGames()) === undefined) {
      throw "Library failed to fetch games.";
    }

    const updatedSource = (
      await prisma.library.updateManyAndReturn({
        where: {
          id: source.id,
        },
        data: {
          name: body.name,
          options: body.options,
          // Only update when the client sent a value; leave existing
          // value alone otherwise.
          ...(body.autoSwapSteamApiDll === undefined
            ? {}
            : { autoSwapSteamApiDll: body.autoSwapSteamApiDll }),
          ...(body.autoEmulatorSetup === undefined
            ? {}
            : { autoEmulatorSetup: body.autoEmulatorSetup }),
        },
      })
    ).at(0);
    if (!updatedSource)
      throw createError({
        statusCode: 404,
        message: "Library source not found",
      });

    libraryManager.removeLibrary(source.id);
    libraryManager.addLibrary(newLibrary);

    const workingSource: WorkingLibrarySource = {
      ...updatedSource,
      working: true,
    };

    return workingSource;
  },
);
