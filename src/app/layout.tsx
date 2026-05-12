import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "karaoke-night",
  description:
    "A mobile-first karaoke party app for collaborative YouTube queues, host playback, and multilingual sing-alongs.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full bg-slate-950 antialiased`}
    >
      <body className="min-h-full bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.22),_transparent_45%),radial-gradient(circle_at_20%_20%,_rgba(168,85,247,0.24),_transparent_35%),linear-gradient(180deg,_#020617_0%,_#111827_55%,_#020617_100%)] text-slate-100">
        {children}
      </body>
    </html>
  );
}
