"use client";

import { usePathname } from "next/navigation";

import { shouldShowWhatsappFab, waLink } from "../lib/contact";

const FAB_MESSAGE = "Hi Cribliv! I need help finding a place to rent.";

/**
 * Floating WhatsApp support button — opens a chat with the central Cribliv
 * number. Rendered site-wide from the locale layout; hides itself on the
 * authenticated dashboards / auth screens via `shouldShowWhatsappFab`.
 */
export function WhatsappFab() {
  const pathname = usePathname();
  if (!shouldShowWhatsappFab(pathname)) return null;

  return (
    <a
      className="wa-fab"
      href={waLink(FAB_MESSAGE)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Chat with Cribliv on WhatsApp"
    >
      <svg
        viewBox="0 0 24 24"
        width="28"
        height="28"
        fill="currentColor"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.71.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.885-9.885 9.885M20.52 3.449C18.24 1.245 15.24.044 12.045.044 5.463.044.104 5.4.101 11.986c0 2.096.548 4.142 1.588 5.945L0 24l6.304-1.654a11.881 11.881 0 005.684 1.448h.005c6.582 0 11.94-5.356 11.943-11.945a11.86 11.86 0 00-3.416-8.4" />
      </svg>
    </a>
  );
}
