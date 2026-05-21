import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import objectHandler from "../objects";
import stream from "node:stream/promises";
import prisma from "../db/database";

class ScreenshotManager {
  /**
   * Gets a specific screenshot
   * @param id
   * @returns
   */
  async get(id: string) {
    return await prisma.screenshot.findUnique({
      where: {
        id,
      },
    });
  }

  /**
   * Get all user screenshots
   * @param userId
   * @returns
   */
  async getUserAll(userId: string) {
    const results = await prisma.screenshot.findMany({
      where: {
        userId,
      },
    });
    return results;
  }

  /**
   * Get all user screenshots in a specific game
   * @param userId
   * @param gameId
   * @returns
   */
  async getUserAllByGame(userId: string, gameId: string) {
    const results = await prisma.screenshot.findMany({
      where: {
        gameId,
        userId,
      },
    });
    return results;
  }

  /**
   * Delete a specific screenshot
   * @param id
   */
  async delete(id: string) {
    const screenshot = await prisma.screenshot.findUnique({ where: { id } });
    if (!screenshot) return false;
    // eslint-disable-next-line drop/no-prisma-delete
    await prisma.screenshot.delete({
      where: {
        id,
      },
    });
    await objectHandler.deleteAsSystem(screenshot.objectId);
    return true;
  }

  /**
   * Allows a user to upload a screenshot.
   *
   * `maxBytes` (optional) enforces a streaming byte cap: as data flows
   * from the HTTP body into the object store, we count bytes and
   * destroy the stream the moment we cross the limit. This is the
   * only safeguard against a client that omits Content-Length and
   * uploads forever; without it the screenshot endpoint is a disk-
   * fill DoS. Throws `Error("ScreenshotTooLarge")` so the caller can
   * map to a 413.
   */
  async upload(
    userId: string,
    gameId: string,
    inputStream: IncomingMessage,
    maxBytes?: number,
  ) {
    const objectId = randomUUID();
    const saveStream = await objectHandler.createWithStream(
      objectId,
      {
        // TODO: set createAt to the time screenshot was taken
        createdAt: new Date().toISOString(),
      },
      [`${userId}:read`], // This is a system tracked object, so we don't want users to have direct write access to it
    );
    if (!saveStream)
      throw createError({
        statusCode: 500,
        statusMessage: "Failed to create writing stream to storage backend.",
      });

    // Wire a streaming byte counter between the HTTP body and the
    // backend stream so we abort overlarge uploads mid-flight.
    let received = 0;
    let aborted: Error | undefined;
    if (maxBytes && maxBytes > 0) {
      inputStream.on("data", (chunk: Buffer) => {
        received += chunk.length;
        if (received > maxBytes) {
          aborted = new Error("ScreenshotTooLarge");
          inputStream.destroy(aborted);
        }
      });
    }

    try {
      // pipe into object store
      await stream.pipeline(inputStream, saveStream);
    } catch (err) {
      // Clean up the partial object so the GC doesn't have to.
      await objectHandler.deleteAsSystem(objectId).catch(() => undefined);
      if (aborted) throw aborted;
      throw err;
    }

    await prisma.screenshot.create({
      data: {
        gameId,
        userId,
        objectId,
        private: true,
      },
    });
  }
}

export const screenshotManager = new ScreenshotManager();
export default screenshotManager;
