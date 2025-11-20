"use client";

import React, { useState, useCallback, useEffect } from "react";
import { useWebSocket } from "@/hooks/useWebSocket";

export default function NavigationHeaderWithConnection() {
  const [isInitialConnection, setIsInitialConnection] = useState(true);

  const handleWebSocketMessage = useCallback(() => {
    // Simple message handler for navigation
  }, []);

  const { connectionStatus, connect, disconnect } = useWebSocket({
    onMessage: handleWebSocketMessage,
    onError: (error) => {
      console.error("❌ [FANO] WebSocket error:", error);
    },
    onConnect: () => {
      if (isInitialConnection) {
        setIsInitialConnection(false);
      }
    },
    onDisconnect: () => {
      console.log("[FANO] Disconnected");
    },
  });

  // Auto-connect on component mount
  useEffect(() => {
    const timer = setTimeout(() => {
      connect();
    }, 500);
    return () => clearTimeout(timer);
  }, [connect]);

  const renderConnectionStatus = () => {
    const statusConfig = {
      connected: {
        color: "text-emerald-400",
        bg: "bg-emerald-500/5",
        border: "border-emerald-500/20",
        dot: "bg-emerald-400",
        text: "Connected",
        icon: "●",
      },
      connecting: {
        color: "text-amber-400",
        bg: "bg-amber-500/5",
        border: "border-amber-500/20",
        dot: "bg-amber-400",
        text: "Connecting",
        icon: "◐",
      },
      reconnecting: {
        color: "text-orange-400",
        bg: "bg-orange-500/5",
        border: "border-orange-500/20",
        dot: "bg-orange-400",
        text: "Reconnecting",
        icon: "◒",
      },
      disconnected: {
        color: "text-slate-400",
        bg: "bg-slate-500/5",
        border: "border-slate-500/20",
        dot: "bg-slate-400",
        text: "Disconnected",
        icon: "○",
      },
      error: {
        color: "text-red-400",
        bg: "bg-red-500/5",
        border: "border-red-500/20",
        dot: "bg-red-400",
        text: "Error",
        icon: "✕",
      },
    };

    const config = statusConfig[connectionStatus.state] || statusConfig.error;

    return (
      <div
        className={`flex items-center space-x-2 px-2.5 py-1 rounded-lg ${config.bg} ${config.border} border backdrop-blur-sm transition-all duration-300`}
      >
        <div
          className={`w-1.5 h-1.5 rounded-full ${config.dot} ${
            connectionStatus.state === "connected" ||
            connectionStatus.state === "connecting"
              ? "animate-pulse"
              : ""
          } shadow-sm`}
        ></div>
        <span className={`text-xs font-medium ${config.color} tracking-wide`}>
          {config.text}
        </span>
      </div>
    );
  };

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
                <h1 className="text-xl font-bold gradient-text">Cortex STT</h1>
                <p className="text-xs text-white/60 font-medium">
                  Advanced Speech-to-Text (Demo Version)
                </p>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              {renderConnectionStatus()}
            </div>
          </div>
        </div>
      </nav>
    </header>
  );
}
