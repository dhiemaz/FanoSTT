import React from "react";
import { Inter, JetBrains_Mono } from "next/font/google";
import type { Metadata } from "next";
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
    default: "Fano STT - Advanced Speech-to-Text",
    template: "%s | Fano STT",
  },
  description:
    "Professional speech-to-text transcription powered by Fano AI with real-time streaming and file upload capabilities.",
  keywords: [
    "speech-to-text",
    "transcription",
    "voice recognition",
    "audio processing",
    "real-time",
    "streaming",
    "AI",
    "Fano",
  ],
};

function NavigationHeader() {
  return (
    <header className="relative z-50">
      <nav className="fixed top-0 left-0 right-0 bg-black/20 backdrop-blur-xl border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-3">
              <div className="relative">
                <div className="w-10 h-10 bg-gradient-to-br from-primary-400 to-secondary-500 rounded-lg flex items-center justify-center shadow-lg">
                  <svg
                    className="w-6 h-6 text-white"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
                    />
                  </svg>
                </div>
              </div>
              <div>
                <h1 className="text-xl font-bold gradient-text">Fano STT</h1>
                <p className="text-xs text-white/60 font-medium">
                  Speech-to-Text
                </p>
              </div>
            </div>
            {/*<div className="flex items-center space-x-4">
              <div className="hidden sm:flex items-center space-x-2 px-3 py-1.5 bg-white/5 rounded-full border border-white/10">
                <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                <span className="text-sm text-white/80 font-medium">Ready</span>
              </div>
            </div>*/}
          </div>
        </div>
      </nav>
    </header>
  );
}

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
    <footer className="relative z-10 mt-auto">
      <div className="bg-black/20 backdrop-blur-xl border-t border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex flex-col md:flex-row items-center justify-between space-y-4 md:space-y-0">
            <div className="flex items-center space-x-6">
              <p className="text-sm text-white/60">
                © 2025 Fano STT. Powered by Tetherfi Pte Ltd.
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
          <NavigationHeader />
          <main className="flex-1 pt-16">
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
