import { type } from "arktype";
import { readDropValidatedBody, throwingArktype } from "~/server/arktype";
import aclManager from "~/server/internal/acls";
import {
  resolveGameVersionDir,
  setupGoldberg,
} from "~/server/internal/goldberg";

const ScanRequest = type({
  gameId: "string",
  provider: "'Goldberg'",
}).configure(throwingArktype);

export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["game:update"]);
  if (!allowed) throw createError({ statusCode: 403 });

  const body = await readDropValidatedBody(h3, ScanRequest);

  console.log(
    `[ACH-SCAN] Scan requested for game=${body.gameId} provider=${body.provider}`,
  );

  const versionDir = await resolveGameVersionDir(body.gameId);
  if (!versionDir) {
    throw createError({
      statusCode: 400,
      statusMessage:
        "Cannot resolve game files on disk. Is the library filesystem-backed?",
    });
  }

  // setupGoldberg handles the full pipeline:
  // local file → Steam API fallback → write to disk → DB records
  await setupGoldberg(body.gameId, versionDir);

  return { scanned: true };
});
