import { put } from "@vercel/blob";

export async function putTextArtifact(pathname: string, content: string) {
  const blob = await put(pathname, content, {
    access: "public",
    contentType: "text/markdown; charset=utf-8",
    addRandomSuffix: false,
  });
  return {
    blobUrl: blob.url,
    pathname: blob.pathname,
    bytes: Buffer.byteLength(content, "utf8"),
  };
}

export async function downloadBlobBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download blob: ${response.status} ${response.statusText}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}
