import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import prisma from "~/server/internal/db/database";
import { ExternalAccountProvider } from "~/prisma/client/enums";

/**
 * The caller's RetroAchievements Connect credentials for RetroArch. Called by
 * the desktop client before launching a RetroArch game (and from its settings
 * screens) so it can inject `cheevos_username` / `cheevos_token`.
 *
 * Always 200 with an explicit answer, so the client never has to read meaning
 * into a 404 (a reverse proxy returns those too while the container restarts):
 *   - `{ linked: false }`: no RA account linked. The client drops its copy.
 *   - `{ linked: true, username, connectToken }`: use these.
 *   - `{ linked: true, username, connectToken: null, reason: "no_token" }`:
 *     the account is linked but has no Connect token, e.g. it was linked
 *     before tokens were stored (they were added with a default of ''). The
 *     player has to sign in again once; meanwhile the client keeps whatever
 *     token it already has for that account.
 *
 * Older clients expected `{ username, connectToken }` or a 404. Only a 404
 * made them drop their cached copy; a response they can't parse makes them
 * fall back to it. So an older client keeps signing RetroArch in with the
 * credentials it already had (even after an unlink on the web) until it is
 * updated. Nothing is wiped, but unlinking doesn't reach those clients.
 */
export default defineClientEventHandler(async (_h3, { fetchUser }) => {
  const user = await fetchUser();

  const account = await prisma.userExternalAccount.findUnique({
    where: {
      userId_provider: {
        userId: user.id,
        provider: ExternalAccountProvider.RetroAchievements,
      },
    },
    select: {
      externalId: true,
      connectToken: true,
    },
  });

  if (!account || !account.externalId) {
    return { linked: false as const };
  }
  if (!account.connectToken) {
    return {
      linked: true as const,
      username: account.externalId,
      connectToken: null,
      reason: "no_token" as const,
    };
  }
  return {
    linked: true as const,
    username: account.externalId,
    connectToken: account.connectToken,
  };
});
