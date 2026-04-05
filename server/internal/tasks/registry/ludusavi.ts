import { defineDropTask } from "..";
import { refreshManifest } from "../../ludusavi";

export default defineDropTask({
  buildId: () => `ludusavi:refresh:${new Date().toISOString()}`,
  name: "Refresh Ludusavi manifest",
  acls: ["system:admin"],
  taskGroup: "ludusavi:refresh",
  async run({ progress, logger }) {
    logger.info("Starting Ludusavi manifest refresh…");
    const count = await refreshManifest((pct) => progress(pct));
    if (count > 0) {
      logger.info(`Imported ${count} game save path entries.`);
    } else {
      logger.info("Manifest already up to date, no changes.");
    }
    progress(100);
  },
});
