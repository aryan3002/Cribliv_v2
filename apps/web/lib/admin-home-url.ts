export function adminHomePublicUrl(publicPath: string): string {
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://cribliv.com").replace(/\/+$/, "");
  const path = publicPath.startsWith("/") ? publicPath : `/${publicPath}`;
  return `${siteUrl}${path}`;
}

export async function copyAdminHomeUrl(publicPath: string): Promise<void> {
  const url = adminHomePublicUrl(publicPath);
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(url);
      return;
    } catch {
      // Fall through to the selection-based copy path.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = url;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);

  let copied = false;
  try {
    textarea.select();
    copied = document.execCommand("copy");
  } finally {
    textarea.remove();
  }

  if (!copied) throw new Error("copy_failed");
}
