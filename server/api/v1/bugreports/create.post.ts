import { type } from "arktype";
import { readDropValidatedBody, throwingArktype } from "~/server/arktype";
import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import { handleFileUpload } from "~/server/internal/utils/handlefileupload";

const CreateBugReport = type({
  title: "string",
  description: "string = ''",
  systemInfo: "string | undefined",
  logs: "string | undefined",
}).configure(throwingArktype);

export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["read"]);
  if (!userId) throw createError({ statusCode: 403 });

  // Check content type to decide between JSON and multipart
  const contentType = getRequestHeader(h3, "content-type") || "";

  let title: string;
  let description: string;
  let systemInfo: string | undefined;
  let logs: string | undefined;
  let screenshotObjectId: string | undefined;

  if (contentType.includes("multipart/form-data")) {
    // Multipart upload with optional screenshot
    const uploadResult = await handleFileUpload(
      h3,
      { type: "bug-report-screenshot" },
      ["internal:read"],
      1,
    );

    if (uploadResult) {
      const [imageIds, options, pull] = uploadResult;
      title = options.title || "";
      description = options.description || "";
      systemInfo = options.systemInfo;
      logs = options.logs;

      if (imageIds.length > 0) {
        screenshotObjectId = imageIds[0];
        await pull();
      }
    } else {
      throw createError({ statusCode: 400, statusMessage: "Invalid form data" });
    }
  } else {
    // JSON body (no screenshot)
    const body = await readDropValidatedBody(h3, CreateBugReport);
    title = body.title;
    description = body.description;
    systemInfo = body.systemInfo;
    logs = body.logs;
  }

  if (!title || !title.trim()) {
    throw createError({ statusCode: 400, statusMessage: "Title is required" });
  }

  // Parse systemInfo JSON if provided
  let parsedSystemInfo = null;
  if (systemInfo) {
    try {
      parsedSystemInfo = JSON.parse(systemInfo);
    } catch {
      parsedSystemInfo = { raw: systemInfo };
    }
  }

  const report = await prisma.bugReport.create({
    data: {
      title: title.trim(),
      description: description.trim(),
      systemInfo: parsedSystemInfo,
      logs: logs || null,
      screenshotObjectId: screenshotObjectId || null,
      reporterId: userId,
    },
  });

  return report;
});
