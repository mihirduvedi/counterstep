import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "Counterstep — Evidence-bound agent recovery",
  description:
    "Inspect a completed agent overstep, apply only authorized reversible repairs, and verify closure from fresh state.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
