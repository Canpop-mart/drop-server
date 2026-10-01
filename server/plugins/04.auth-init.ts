import authManager from "~/server/internal/auth";
import prisma from "../internal/db/database";
import { APITokenMode } from "~/prisma/client/enums";
import type { UserACL } from "../internal/acls";

export const CLIENT_WEBTOKEN_ACLS: UserACL = [
  "read",
  // Profile, showcase and favourites edits from the desktop client and Big
  // Picture. Existing client tokens pick this up from the updateMany below at
  // the next server start.
  "profile:update",
  "store:read",
  "object:read",
  "object:update",
  "settings:read",
  "news:read",

  "collections:read",
  "collections:new",
  "collections:add",
  "collections:remove",
  "collections:delete",

  "library:add",
  "library:remove",

  // The desktop client's settings page resets achievements through
  // server:// with this token.
  "achievements:reset",

  // The desktop client polls for game request decisions and marks them read
  // (main/composables/request-notifications.ts).
  "notifications:read",
  "notifications:mark",
];

export default defineNitroPlugin(async () => {
  await authManager.init();

  await prisma.aPIToken.updateMany({
    where: {
      mode: APITokenMode.Client,
    },
    data: {
      acls: CLIENT_WEBTOKEN_ACLS,
    },
  });

  await prisma.aPIToken.deleteMany({
    where: {
      id: "torrential",
    },
  });
});
