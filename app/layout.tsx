import "./globals.css";
import "./chat-theme.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "Tech Store Assistant",
  description:
    "A product assistant for pre-purchase information and basic post-purchase support, grounded in your catalog/KB (RAG).",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

