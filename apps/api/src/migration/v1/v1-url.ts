/** Extract the trailing 24-hex Mongo ObjectId from a v1 /properties/…-<id> URL. */
export function extractV1ObjectId(url: string): string | null {
  const m = String(url).match(/([a-f0-9]{24})(?:[/?#].*)?$/i);
  return m ? m[1].toLowerCase() : null;
}

export function cloudinaryUrl(cloud: string, publicId: string): string {
  return `https://res.cloudinary.com/${cloud}/image/upload/${publicId}`;
}

export function extFromContentType(ct: string): "jpg" | "png" | "webp" | "bin" {
  const t = (ct || "").split(";")[0].trim().toLowerCase();
  if (t === "image/jpeg" || t === "image/jpg") return "jpg";
  if (t === "image/png") return "png";
  if (t === "image/webp") return "webp";
  return "bin";
}
