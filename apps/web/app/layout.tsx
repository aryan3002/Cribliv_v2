import "./globals.css";
import type { ReactNode } from "react";
import { SessionProvider } from "../components/auth/session-provider";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
