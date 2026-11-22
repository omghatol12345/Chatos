import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chatos - Offline Voice & Character AI Chat",
  description: "Multimodal Character Companion with local Ollama, Speech, and Image generation",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased min-h-screen bg-zinc-950 text-zinc-100">
        {children}
      </body>
    </html>
  );
}
