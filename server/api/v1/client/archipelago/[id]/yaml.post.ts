import { type } from "arktype";
import {
  readDropValidatedBody,
  requireRouterParam,
  throwingArktype,
} from "~/server/arktype";
import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import archipelagoManager from "~/server/internal/archipelago";

// Sent as text rather than multipart: player YAMLs are small text files, so a
// JSON body keeps both the Tauri client and any web caller trivial. The cap is
// generous for a hand-written options file while still bounding the payload.
const YamlBody = type({
  yaml: "string <= 524288",
}).configure(throwingArktype);

/**
 * POST /api/v1/client/archipelago/:id/yaml
 *
 * Upload (or replace) the caller's YAML for this session. Validates structure
 * and rejects a slot name already taken by someone else in the session, so a
 * clash surfaces now rather than as a failed generation later.
 */
export default defineClientEventHandler(async (h3, { clientId }) => {
  const sessionId = requireRouterParam(h3, "id");
  const body = await readDropValidatedBody(h3, YamlBody);

  const slot = await archipelagoManager.upsertSlotYaml({
    sessionId,
    clientId,
    yamlText: body.yaml,
  });

  return {
    slotName: slot.slotName,
    game: slot.game,
    uploadedAt: slot.uploadedAt,
  };
});
