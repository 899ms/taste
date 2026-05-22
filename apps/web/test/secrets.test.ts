import { describe, expect, it } from "vitest";

import {
  decryptSecret,
  encryptSecret,
  hashSecret,
  safeEqualHash,
} from "../src/crypto/secrets";

describe("run secret crypto", () => {
  it("encrypts and decrypts a run-scoped AI Gateway token", () => {
    const encrypted = encryptSecret("vck_test_token", "test-key-material");

    expect(encrypted.ciphertext).not.toContain("vck_test_token");
    expect(decryptSecret(encrypted, "test-key-material")).toBe("vck_test_token");
  });

  it("compares secret hashes without exposing the secret", () => {
    const hash = hashSecret("run-secret");

    expect(safeEqualHash("run-secret", hash)).toBe(true);
    expect(safeEqualHash("wrong-secret", hash)).toBe(false);
  });
});
