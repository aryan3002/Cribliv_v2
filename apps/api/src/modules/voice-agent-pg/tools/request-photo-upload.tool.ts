import type { ToolDefinition, ToolHandler } from "./types";

/** Signal-only tool. Gateway forwards to client to open SAS-upload widget. */
const handler: ToolHandler = () => ({ ok: true, extracted: [], errors: [] });

export const requestPhotoUploadTool: ToolDefinition = {
  name: "request_photo_upload",
  description:
    "Signal the client to open the photo upload widget. Agent pauses until client confirms upload complete. No args.",
  handler
};
