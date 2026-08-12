import type { ClientModel, UserModel } from "~/prisma/client/models";
import type { EventHandlerRequest, H3Event } from "h3";
import prisma from "../db/database";
import { useCertificateAuthority } from "~/server/plugins/ca";
import jwt from "jsonwebtoken";

export type EventHandlerFunction<T> = (
  h3: H3Event<EventHandlerRequest>,
  utils: ClientUtils,
) => Promise<T> | T;

type ClientUtils = {
  clientId: string;
  fetchClient: () => Promise<ClientModel>;
  fetchUser: () => Promise<UserModel>;
};

// I forgot how to spell leniancne
const JWT_TIME_WIGGLE = 30_000;

// lastConnected used to be written on every authenticated request, so a client
// that fires 85 parallel object fetches put 85 writers on a single row. A
// "last seen" column does not need per-request precision, so one write per
// client per minute is enough.
const LAST_CONNECTED_DEBOUNCE_MS = 60_000;
// Keys are real paired clients (a valid, non-blacklisted certificate is needed
// to get this far), so this cap is only a backstop against the map outliving
// churned devices in a long-running process.
const LAST_CONNECTED_MAX_TRACKED = 1_000;
const lastConnectedWrites = new Map<string, number>();

function recordLastConnectedWrite(clientId: string, now: number) {
  // Re-inserting moves the key to the back, so iteration order is
  // least-recently-written first and the eviction below is LRU.
  lastConnectedWrites.delete(clientId);
  lastConnectedWrites.set(clientId, now);
  if (lastConnectedWrites.size <= LAST_CONNECTED_MAX_TRACKED) return;

  for (const [id, writtenAt] of lastConnectedWrites) {
    if (lastConnectedWrites.size <= LAST_CONNECTED_MAX_TRACKED) break;
    if (now - writtenAt >= LAST_CONNECTED_DEBOUNCE_MS)
      lastConnectedWrites.delete(id);
  }
  while (lastConnectedWrites.size > LAST_CONNECTED_MAX_TRACKED) {
    const oldest = lastConnectedWrites.keys().next().value;
    if (oldest === undefined) break;
    lastConnectedWrites.delete(oldest);
  }
}

export function defineClientEventHandler<T>(handler: EventHandlerFunction<T>) {
  return defineEventHandler(async (h3) => {
    const header = getHeader(h3, "Authorization");
    if (!header) throw createError({ statusCode: 403 });
    const [method, ...parts] = header.split(" ");

    let clientId: string;
    switch (method) {
      case "JWT": {
        clientId = parts[0];
        const jwtToken = parts[1];

        if (!clientId || !jwtToken) throw createError({ statusCode: 403 });

        const certificateAuthority = useCertificateAuthority();
        const certBundle =
          await certificateAuthority.fetchClientCertificate(clientId);
        // This does the blacklist check already
        if (!certBundle)
          throw createError({
            statusCode: 403,
            message: "Invalid client ID",
          });

        const valid = jwt.verify(jwtToken, certBundle.cert, {
          clockTolerance: JWT_TIME_WIGGLE,
          // algorithms: ["ES384"],
        });
        if (!valid)
          throw createError({
            statusCode: 403,
            message: "Invalid nonce signature.",
          });
        break;
      }
      default: {
        throw createError({
          statusCode: 403,
          message: "No authentication",
        });
      }
    }

    if (clientId === undefined)
      throw createError({
        statusCode: 500,
        message: "Failed to execute authentication pipeline.",
      });

    async function fetchClient() {
      const client = await prisma.client.findUnique({
        where: { id: clientId },
      });
      if (!client)
        throw createError({
          statusCode: 401,
          statusMessage:
            "Client record not found for authenticated clientId. The client may have been deleted or unpaired.",
        });
      return client;
    }

    async function fetchUser() {
      const client = await prisma.client.findUnique({
        where: { id: clientId },
        select: {
          user: true,
        },
      });

      if (!client)
        throw createError({
          statusCode: 401,
          statusMessage:
            "Client record not found for authenticated clientId. The client may have been deleted or unpaired.",
        });

      return client.user;
    }

    const utils: ClientUtils = {
      clientId,
      fetchClient,
      fetchUser,
    };

    // Bump lastConnected AND verify the Client row still exists. A certificate
    // can outlive its Client row (device removed / unpaired), and endpoints that
    // use `clientId` directly without calling fetchClient() — e.g. sync-installed
    // — would otherwise FK-crash (P2003) with a 500. updateMany returns the match
    // count, so the existence check is free. A missing row means re-pair → 401.
    //
    // Debounced: within the window we skip the write and therefore the existence
    // check too. Removing a client blacklists its certificate first, so the
    // normal unpair path already 403s above; this check only catches rows deleted
    // out from under the CA, and tolerating up to a minute of staleness there is
    // worth not serialising every burst of requests on one row.
    const now = Date.now();
    const lastWrite = lastConnectedWrites.get(clientId);
    if (
      lastWrite === undefined ||
      now - lastWrite >= LAST_CONNECTED_DEBOUNCE_MS
    ) {
      const { count } = await prisma.client.updateMany({
        where: { id: clientId },
        data: { lastConnected: new Date() },
      });
      if (count === 0) {
        lastConnectedWrites.delete(clientId);
        throw createError({
          statusCode: 401,
          statusMessage:
            "Client record not found for authenticated clientId. The client may have been deleted or unpaired.",
        });
      }
      recordLastConnectedWrite(clientId, now);
    }

    return await handler(h3, utils);
  });
}
