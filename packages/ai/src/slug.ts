export function slug(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
}

export function modelSlug(model: string): string {
  return slug(model.replace("/", "_").replace(":", "_"));
}
