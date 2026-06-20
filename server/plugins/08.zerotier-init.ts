import { zerotierController } from "~/server/internal/zerotier/controller";
import { roomManager } from "~/server/internal/zerotier";
import { logger } from "~/server/internal/logging";

/**
 * Logs co-op room availability at boot so misconfigured controllers are obvious
 * in the server log rather than only surfacing on the first failed room create.
 * Never throws — an unreachable controller just disables the feature softly.
 */
export default defineNitroPlugin(async () => {
  if (!roomManager.isEnabled()) {
    logger.info(
      "[ZeroTier] Co-op rooms disabled (set ZEROTIER_CONTROLLER_URL + token to enable).",
    );
    return;
  }

  try {
    const status = await zerotierController.getStatus();
    logger.info(
      `[ZeroTier] Controller reachable — node ${status.address}, online=${status.online}, v${status.version}.`,
    );
  } catch (e) {
    logger.warn(
      `[ZeroTier] Co-op rooms enabled but controller is unreachable: ${e}`,
    );
  }
});
