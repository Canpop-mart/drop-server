import { type } from "arktype";
import { readDropValidatedBody, throwingArktype } from "~/server/arktype";
import type {
  CapabilityConfiguration,
  InternalClientCapability,
} from "~/server/internal/clients/capabilities";
import capabilityManager, {
  validCapabilities,
} from "~/server/internal/clients/capabilities";
import clientHandler, { AuthMode } from "~/server/internal/clients/handler";
import { parsePlatform } from "~/server/internal/utils/parseplatform";

const ClientAuthInitiate = type({
  name: "string",
  platform: "string",
  capabilities: "object",
  mode: type.valueOf(AuthMode).default(AuthMode.Callback),
}).configure(throwingArktype);

export default defineEventHandler(async (h3) => {
  const body = await readDropValidatedBody(h3, ClientAuthInitiate);

  const platformRaw = body.platform;
  const capabilities: Partial<CapabilityConfiguration> =
    body.capabilities ?? {};

  const platform = parsePlatform(platformRaw);
  if (!platform)
    throw createError({
      statusCode: 400,
      statusMessage: "Invalid or unsupported platform",
    });

  // Match every advertised capability against the server's known set, dropping
  // anything we don't recognise. We deliberately do NOT 400 on unknowns: the
  // client/server pair are version-skewed in the wild (older clients still
  // advertise renamed/removed capabilities like `cloudSaves`, newer clients
  // advertise ones the server hasn't been updated to know yet), and the
  // handshake has to survive that — a forgotten/extra name shouldn't lock the
  // user out of signing in. Capabilities are *features the client supports*;
  // anything we don't know about, we just won't register server-side.
  const capabilityIterable = Object.entries(
    capabilities,
  ).flatMap<[InternalClientCapability, object]>(([capability, value]) => {
    const actualCapability = validCapabilities.find(
      (v) => capability.toLowerCase() === v.toLowerCase(),
    );
    if (!actualCapability) {
      console.warn(
        `[client/auth/initiate] ignoring unknown capability "${capability}" (version skew between client and server)`,
      );
      return [];
    }
    return [[actualCapability, value as object]];
  });

  if (
    capabilityIterable.length > 0 &&
    capabilityIterable.filter(
      ([capability, configuration]) =>
        !capabilityManager.validateCapabilityConfiguration(
          capability,
          configuration,
        ),
    ).length > 0
  )
    throw createError({
      statusCode: 400,
      statusMessage: "Invalid capability configuration.",
    });

  const result = await clientHandler.initiate({
    name: body.name,
    platform,
    capabilities: Object.fromEntries(capabilityIterable),
    mode: body.mode,
  });

  return result;
});
