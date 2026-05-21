import taskHandler from "~/server/internal/tasks";
import taskScheduler from "~/server/internal/tasks/scheduler";

export default defineNitroPlugin(async (_nitro) => {
  // 1. Sweep any TaskReceipt rows left in flight from a crashed
  //    previous run. Marks them `orphaned` so the admin UI displays
  //    a consistent picture and retry can target them.
  await taskHandler.sweepOrphanedReceipts();

  // 2. Trigger the existing daily/weekly bucket (boot-time replay so
  //    a missed daily run still fires on first start of the day).
  await runTask("dailyTasks");

  // 3. Register declarative interval schedules (DropTask.schedule).
  //    Daily/weekly schedules continue to flow through the legacy
  //    path triggered above.
  taskScheduler.start();
});
