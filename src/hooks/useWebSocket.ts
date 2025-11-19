import { useCallback, useEffect, useRef, useState } from "react";
import {
  UseWebSocketReturn,
  ConnectionStatus,
  FanoSTTRequest,
  FanoSTTResponse,
  FanoAuth,
  WEBSOCKET_URL,
  AUTH_TOKEN,
} from "@/types";

interface UseWebSocketOptions {
  url?: string;
  auth?: FanoAuth;
  onMessage?: (message: FanoSTTResponse) => void;
  onError?: (error: Error) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
}

export function useWebSocket({
  url = WEBSOCKET_URL,
  auth = {
    type: "bearer",
    token: AUTH_TOKEN,
    header_name: "authorization",
  },
  onMessage,
  onError,
  onConnect,
  onDisconnect,
}: UseWebSocketOptions = {}): UseWebSocketReturn {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({
    state: "disconnected",
    reconnectAttempts: 0,
  });

  const [lastMessage, setLastMessage] = useState<FanoSTTResponse>();

  const wsRef = useRef<WebSocket | null>(null);
  const isManuallyClosedRef = useRef(false);
  const messageQueueRef = useRef<FanoSTTRequest[]>([]);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);

  const updateConnectionStatus = useCallback(
    (updates: Partial<ConnectionStatus>) => {
      setConnectionStatus((prev) => ({ ...prev, ...updates }));
    },
    [],
  );

  const clearTimeouts = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  const processMessageQueue = useCallback(() => {
    if (
      wsRef.current?.readyState === WebSocket.OPEN &&
      messageQueueRef.current.length > 0
    ) {
      const messages = [...messageQueueRef.current];
      messageQueueRef.current = [];

      messages.forEach((message) => {
        try {
          console.log("📤 [FANO] Sending queued message:", message);
          wsRef.current?.send(JSON.stringify(message));
        } catch (error) {
          console.error("❌ [FANO] Failed to send queued message:", error);
          messageQueueRef.current.unshift(message);
        }
      });
    }
  }, []);

  const handleOpen = useCallback(() => {
    console.log("✅ [FANO] Connected via proxy with Authorization header");

    // Reset reconnection attempts on successful connection
    reconnectAttemptsRef.current = 0;

    updateConnectionStatus({
      state: "connected",
      lastConnected: new Date(),
      reconnectAttempts: 0,
    });

    processMessageQueue();
    onConnect?.();
  }, [updateConnectionStatus, processMessageQueue, onConnect]);

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      try {
        const message: FanoSTTResponse = JSON.parse(event.data);
        console.log("📨 [FANO] Received:", message);

        setLastMessage(message);
        onMessage?.(message);
      } catch (error) {
        console.error("❌ [FANO] Failed to parse message:", error);
        onError?.(new Error(`Failed to parse message: ${error}`));
      }
    },
    [onMessage, onError],
  );

  const handleError = useCallback(
    (event: Event) => {
      console.error("❌ [FANO] Connection error:", event);
      updateConnectionStatus({
        state: "error",
        error: "WebSocket connection error",
      });
      onError?.(new Error("WebSocket connection error"));
    },
    [updateConnectionStatus, onError],
  );

  // Use useRef to store the reconnect function to avoid circular dependencies
  const scheduleReconnectRef = useRef<() => void>();

  const createWebSocketConnection = useCallback(() => {
    if (
      wsRef.current?.readyState === WebSocket.OPEN ||
      wsRef.current?.readyState === WebSocket.CONNECTING
    ) {
      return;
    }

    updateConnectionStatus({
      state: "connecting",
    });

    try {
      console.log("🔌 [FANO] Connecting via proxy server");
      console.log("🔌 [FANO] URL:", url);

      wsRef.current = new WebSocket(url);

      wsRef.current.onopen = handleOpen;
      wsRef.current.onmessage = handleMessage;
      wsRef.current.onerror = handleError;

      wsRef.current.onclose = (event: CloseEvent) => {
        console.log("🔌 [FANO] Connection closed:", event.code, event.reason);
        clearTimeouts();

        const updates: Partial<ConnectionStatus> = {
          state: "disconnected",
        };
        if (event.code !== 1000) {
          updates.error = `Connection closed: ${event.reason || `Code ${event.code}`}`;
        }
        updateConnectionStatus(updates);

        onDisconnect?.();

        // Attempt to reconnect unless manually closed
        if (!isManuallyClosedRef.current && scheduleReconnectRef.current) {
          console.log("🔄 [FANO] Connection lost - initiating reconnection");
          scheduleReconnectRef.current();
        } else {
          console.log("🔌 [FANO] Manual disconnect - no reconnection");
        }
      };
    } catch (error) {
      console.error("❌ [FANO] Failed to create connection:", error);
      updateConnectionStatus({
        state: "error",
        error: error instanceof Error ? error.message : "Failed to connect",
      });
      onError?.(
        error instanceof Error ? error : new Error("Failed to connect"),
      );
    }
  }, [
    url,
    updateConnectionStatus,
    handleOpen,
    handleMessage,
    handleError,
    clearTimeouts,
    onDisconnect,
    onError,
  ]);

  // Create the reconnect function and store it in ref
  scheduleReconnectRef.current = useCallback(() => {
    if (isManuallyClosedRef.current) {
      console.log("🔌 [FANO] Skipping reconnect - manually disconnected");
      return;
    }

    const maxAttempts = 5;
    const currentAttempts = reconnectAttemptsRef.current;

    if (currentAttempts >= maxAttempts) {
      console.log(
        `❌ [FANO] Max reconnection attempts (${maxAttempts}) reached`,
      );
      updateConnectionStatus({
        state: "error",
        error: `Failed to reconnect after ${maxAttempts} attempts`,
      });
      return;
    }

    // Exponential backoff: 1s, 2s, 4s, 8s, 16s (max 30s)
    const delay = Math.min(1000 * Math.pow(2, currentAttempts), 30000);
    reconnectAttemptsRef.current = currentAttempts + 1;

    console.log(
      `🔄 [FANO] Reconnecting in ${delay}ms (attempt ${currentAttempts + 1}/${maxAttempts})`,
    );

    updateConnectionStatus({
      state: "reconnecting",
      reconnectAttempts: reconnectAttemptsRef.current,
    });

    reconnectTimeoutRef.current = setTimeout(() => {
      console.log(
        `🔄 [FANO] Attempting reconnection (${reconnectAttemptsRef.current}/${maxAttempts})`,
      );
      createWebSocketConnection();
    }, delay);
  }, [updateConnectionStatus, createWebSocketConnection]);

  const connect = useCallback(() => {
    if (
      wsRef.current?.readyState === WebSocket.OPEN ||
      wsRef.current?.readyState === WebSocket.CONNECTING
    ) {
      console.log("🔌 [FANO] Already connected or connecting");
      return;
    }

    isManuallyClosedRef.current = false;
    reconnectAttemptsRef.current = 0;
    clearTimeouts();

    createWebSocketConnection();
  }, [clearTimeouts, createWebSocketConnection]);

  const disconnect = useCallback(() => {
    console.log("🔌 [FANO] Manually disconnecting");
    isManuallyClosedRef.current = true;
    reconnectAttemptsRef.current = 0;
    clearTimeouts();

    if (wsRef.current) {
      wsRef.current.close(1000, "Manual disconnect");
      wsRef.current = null;
    }

    messageQueueRef.current = [];
    updateConnectionStatus({
      state: "disconnected",
      reconnectAttempts: 0,
    });
  }, [updateConnectionStatus, clearTimeouts]);

  const sendMessage = useCallback(
    (message: FanoSTTRequest) => {
      console.log("📤 [FANO] Sending message:", message);

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        try {
          wsRef.current.send(JSON.stringify(message));
        } catch (error) {
          console.error("❌ [FANO] Failed to send message:", error);
          messageQueueRef.current.push(message);
          onError?.(
            error instanceof Error
              ? error
              : new Error("Failed to send message"),
          );
        }
      } else {
        console.log("📥 [FANO] Queueing message - not connected");
        messageQueueRef.current.push(message);
      }
    },
    [onError],
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isManuallyClosedRef.current = true;
      clearTimeouts();
      if (wsRef.current) {
        wsRef.current.close(1000, "Component unmount");
      }
    };
  }, [clearTimeouts]);

  return {
    connectionStatus,
    sendMessage,
    connect,
    disconnect,
    lastMessage: lastMessage || undefined,
  };
}

export default useWebSocket;
