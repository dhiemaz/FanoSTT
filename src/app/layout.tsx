import React from "react";
import { Inter, JetBrains_Mono } from "next/font/google";
import type { Metadata } from "next";
import NavigationHeaderWithConnection from "@/components/NavigationHeaderWithConnection";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-jetbrains-mono",
});

export const metadata: Metadata = {
  title: {
    default: "Cortex STT - Advanced Speech-to-Text (Demo Version)",
    template: "%s | Cortex STT",
  },
  description:
    "Advanced speech-to-text transcription by Tetherfi with real-time streaming and file upload capabilities.",
  keywords: [
    "speech-to-text",
    "transcription",
    "voice recognition",
    "audio processing",
    "real-time",
    "streaming",
    "AI",
    "Tetherfi",
  ],
};

// NavigationHeader moved to separate client component

function BackgroundPattern() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900"></div>
      <div className="absolute inset-0 opacity-10">
        <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/5 to-transparent"></div>
      </div>
      <div className="absolute top-1/4 left-1/4 w-64 h-64 bg-primary-500/10 rounded-full blur-3xl animate-pulse-slow"></div>
      <div className="absolute top-3/4 right-1/4 w-96 h-96 bg-secondary-500/10 rounded-full blur-3xl animate-pulse-slow"></div>
      <div className="absolute top-1/2 left-1/2 w-32 h-32 bg-accent-500/10 rounded-full blur-2xl animate-pulse-slow"></div>
    </div>
  );
}

function FooterSection() {
  return (
    <footer className="relative z-10 mt-4">
      <div className="bg-black/20 backdrop-blur-xl border-t border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
          <div className="flex flex-col md:flex-row items-center justify-between space-y-4 md:space-y-0">
            <div className="flex items-center space-x-6">
              <p className="text-sm text-white/60">
                © 2025 Cortex STT. Powered by Tetherfi Pte Ltd.
              </p>
              <div className="hidden md:flex items-center space-x-4 text-xs text-white/40">
                <span>Real-time transcription</span>
                <span>•</span>
                <span>Multi-language support</span>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              {/*<div className="flex items-center space-x-2 text-xs text-white/40">
                <div className="w-1.5 h-1.5 bg-primary-400 rounded-full animate-pulse"></div>
                <span>WebSocket Connected</span>
              </div>*/}
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <head>
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1"
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
      </head>
      <body className={`${inter.className} antialiased`}>
        <div className="relative min-h-screen flex flex-col">
          <BackgroundPattern />
          <NavigationHeaderWithConnection />
          <main className="flex-1 pt-20">
            <div className="relative z-10">{children}</div>
          </main>
          <FooterSection />
        </div>
        <div
          id="toast-container"
          className="fixed top-20 right-4 z-[9998] space-y-2 pointer-events-none"
        ></div>
      </body>
    </html>
  );
}
