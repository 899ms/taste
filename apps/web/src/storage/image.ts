import { createHash } from "node:crypto";
import { imageSize } from "image-size";

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function dimensions(bytes: Uint8Array): { width: number | null; height: number | null } {
  try {
    const result = imageSize(bytes);
    return {
      width: result.width ?? null,
      height: result.height ?? null,
    };
  } catch {
    return { width: null, height: null };
  }
}
