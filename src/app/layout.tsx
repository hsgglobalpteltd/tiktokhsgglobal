import type { Metadata } from "next";
import "./globals.css";
import { TerminalAuthGate } from "../components/TerminalAuthGate";

export const metadata: Metadata = {
  title: "iB Bridge",
  description: "Gmail-styled modular application suite.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <TerminalAuthGate>
          {children}
        </TerminalAuthGate>
      </body>
    </html>
  );
}
