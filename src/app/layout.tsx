import type { Metadata } from "next";
import "./globals.css";

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
      <body>{children}</body>
    </html>
  );
}
