import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import taskHandler from "~/server/internal/tasks";
import type { TaskGroup } from "~/server/internal/tasks/group";

export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["task:read"]);
  if (!allowed) throw createError({ statusCode: 403 });
  const allAcls = await aclManager.fetchAllACLs(h3);
  if (!allAcls)
    throw createError({
      statusCode: 403,
      statusMessage: "Somehow no ACLs on authenticated request.",
    });

  const runningTasks = (await taskHandler.runningTasks()).map((e) => e.id);
  const historicalTasks = await prisma.task.findMany({
    where: {
      OR: [{ acls: { hasSome: allAcls } }, { acls: { isEmpty: true } }],
    },
    orderBy: { ended: "desc" },
    select: {
      id: true,
      name: true,
      actions: true,
      error: true,
      success: true,
    },
    take: 32,
  });

  const dailyTasks = await taskHandler.dailyTasks();
  const weeklyTasks = await taskHandler.weeklyTasks();

  // On-demand admin categories. Ordering here controls the UI reading order.
  const library: TaskGroup[] = [
    "check:game-updates",
    "cleanup:library-orphans",
    "refresh:metadata",
  ];
  const achievements: TaskGroup[] = [
    "scan:goldberg-readiness",
    "refresh:achievement-defs",
    "link:retroachievements",
    "recalculate:achievements",
    "upgrade:gbe",
  ];
  const system: TaskGroup[] = ["recalculate:playtime", "backup:export"];

  return {
    runningTasks,
    historicalTasks,
    dailyTasks,
    weeklyTasks,
    library,
    achievements,
    system,
  };
});
