import { describe, expect, it } from "vitest";

import { AppConfigError } from "../src/config";
import { errorResponse } from "../src/http/errors";

describe("configuration errors", () => {
  it("returns a sanitized server configuration response", async () => {
    const response = errorResponse(new AppConfigError(["DATABASE_URL", "APP_ENCRYPTION_KEY"]));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: {
        code: "server_config",
        message: "Server configuration is missing or invalid: DATABASE_URL, APP_ENCRYPTION_KEY.",
        fields: ["DATABASE_URL", "APP_ENCRYPTION_KEY"],
      },
    });
  });
});
