import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FastAuth Metrics Dashboard",
  description: "Private peersyst.org FastAuth analytics dashboard",
};

const fontVariables = {
  "--font-sf":
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Segoe UI", system-ui, sans-serif',
  "--font-sf-mono":
    '"SF Mono", Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
} as React.CSSProperties & Record<`--${string}`, string>;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" style={fontVariables}>
      <body>{children}</body>
    </html>
  );
}
