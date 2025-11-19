import { useCallback, useEffect, useRef, useState } from "react";
import {
  UseWebSocketReturn,
  ConnectionStatus,
  ConnectionState,
  FanoSTTRequest,
  FanoSTTResponse,
  WebSocketConfig,
  FanoAuth,
  WEBSOCKET_URL,
  AUTH_TOKEN,
} from "@/types";

interface UseWebSocketOptions {
  url?: string;
  auth?: FanoAuth;
  reconnectAttempts?: number;
  reconnectInterval?: number;
  heartbeatInterval?: number;
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
  reconnectAttempts = 5,
  reconnectInterval = 3000,
  heartbeatInterval = 30000,
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
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const heartbeatTimeoutRef = useRef<NodeJS.Timeout>();
  const reconnectCountRef = useRef(0);
  const isManuallyClosedRef = useRef(false);
  const messageQueueRef = useRef<FanoSTTRequest[]>([]);
  const pingIntervalRef = useRef<NodeJS.Timeout>();

  const updateConnectionStatus = useCallback(
    (updates: Partial<ConnectionStatus>) => {
      setConnectionStatus((prev) => ({ ...prev, ...updates }));
    },
    [],
  );

  const clearTimeouts = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = undefined;
    }
    if (heartbeatTimeoutRef.current) {
      clearTimeout(heartbeatTimeoutRef.current);
      heartbeatTimeoutRef.current = undefined;
    }
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = undefined;
    }
  }, []);

  const startHeartbeat = useCallback(() => {
    if (heartbeatInterval && wsRef.current?.readyState === WebSocket.OPEN) {
      pingIntervalRef.current = setInterval(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          // Send ping message
          wsRef.current.send(
            JSON.stringify({
              event: "ping",
              timestamp: Date.now(),
            }),
          );
        }
      }, heartbeatInterval);
    }
  }, [heartbeatInterval]);

  const processMessageQueue = useCallback(() => {
    if (
      wsRef.current?.readyState === WebSocket.OPEN &&
      messageQueueRef.current.length > 0
    ) {
      const messages = [...messageQueueRef.current];
      messageQueueRef.current = [];

      messages.forEach((message) => {
        try {
          wsRef.current?.send(JSON.stringify(message));
        } catch (error) {
          console.error("Failed to send queued message:", error);
          // Re-queue the message if connection is still open
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            messageQueueRef.current.unshift(message);
          }
        }
      });
    }
  }, []);

  const handleOpen = useCallback(() => {
    console.log("WebSocket connected");
    reconnectCountRef.current = 0;

    updateConnectionStatus({
      state: "connected",
      lastConnected: new Date(),
      reconnectAttempts: 0,
    });

    // Process any queued messages
    processMessageQueue();

    // Start heartbeat
    startHeartbeat();

    onConnect?.();
  }, [updateConnectionStatus, processMessageQueue, startHeartbeat, onConnect]);

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      try {
        const message: FanoSTTResponse = JSON.parse(event.data);

        // Handle pong responses
        if (
          message.event === "response" &&
          message.data &&
          typeof message.data === "object" &&
          "pong" in message.data
        ) {
          const timestamp = (message.data as any).timestamp;
          if (typeof timestamp === "number") {
            updateConnectionStatus({
              latency: Date.now() - timestamp,
            });
          }
          return;
        }

        setLastMessage(message);
        onMessage?.(message);
      } catch (error) {
        console.error("Failed to parse WebSocket message:", error);
        const parseError = new Error(`Failed to parse message: ${error}`);
        onError?.(parseError);
      }
    },
    [updateConnectionStatus, onMessage, onError],
  );

  const handleError = useCallback(
    (event: Event) => {
      console.error("WebSocket error:", event);
      const error = new Error("WebSocket connection error");

      updateConnectionStatus({
        state: "error",
        error: error.message,
      });

      onError?.(error);
    },
    [updateConnectionStatus, onError],
  );

  const handleClose = useCallback(
    (event: CloseEvent) => {
      console.log("WebSocket closed:", event.code, event.reason);

      clearTimeouts();

      const updates: Partial<ConnectionStatus> = {
        state: "disconnected",
      };
      if (event.code !== 1000) {
        updates.error = `Connection closed: ${event.reason || event.code}`;
      }
      updateConnectionStatus(updates);

      onDisconnect?.();

      // Attempt reconnection if not manually closed
      if (
        !isManuallyClosedRef.current &&
        reconnectCountRef.current < reconnectAttempts
      ) {
        reconnectCountRef.current++;

        updateConnectionStatus({
          state: "reconnecting",
          reconnectAttempts: reconnectCountRef.current,
        });

        const delay = Math.min(
          reconnectInterval * Math.pow(1.5, reconnectCountRef.current - 1),
          30000,
        );

        reconnectTimeoutRef.current = setTimeout(() => {
          if (!isManuallyClosedRef.current) {
            connect();
          }
        }, delay);
      }
    },
    [
      clearTimeouts,
      updateConnectionStatus,
      onDisconnect,
      reconnectAttempts,
      reconnectInterval,
    ],
  );

  const connect = useCallback(() => {
    if (
      wsRef.current?.readyState === WebSocket.OPEN ||
      wsRef.current?.readyState === WebSocket.CONNECTING
    ) {
      return;
    }

    isManuallyClosedRef.current = false;
    clearTimeouts();

    updateConnectionStatus({
      state: "connecting",
    });

    try {
      // Create WebSocket with auth header
      const wsUrl = new URL(url);
      wsRef.current = new WebSocket(wsUrl.toString());

      // Set auth header if supported by the browser
      // Note: Some browsers don't support custom headers in WebSocket constructor
      // In that case, auth should be handled via query params or after connection

      wsRef.current.onopen = handleOpen;
      wsRef.current.onmessage = handleMessage;
      wsRef.current.onerror = handleError;
      wsRef.current.onclose = handleClose;

      // Send auth message after connection opens
      wsRef.current.addEventListener("open", () => {
        if (auth && wsRef.current) {
          const authMessage = {
            event: "auth" as const,
            data: {
              [auth.header_name]: `${auth.type === "bearer" ? "Bearer " : ""}${auth.token}`,
            },
          };
          wsRef.current.send(JSON.stringify(authMessage));
        }
      });
    } catch (error) {
      console.error("Failed to create WebSocket connection:", error);
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
    auth,
    clearTimeouts,
    updateConnectionStatus,
    handleOpen,
    handleMessage,
    handleError,
    handleClose,
    onError,
  ]);

  const disconnect = useCallback(() => {
    isManuallyClosedRef.current = true;
    clearTimeouts();

    if (wsRef.current) {
      wsRef.current.close(1000, "Manual disconnect");
      wsRef.current = null;
    }

    // Clear message queue
    messageQueueRef.current = [];

    updateConnectionStatus({
      state: "disconnected",
    });
  }, [clearTimeouts, updateConnectionStatus]);

  const sendMessage = useCallback(
    (message: FanoSTTRequest) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        try {
          wsRef.current.send(JSON.stringify(message));
        } catch (error) {
          console.error("Failed to send message:", error);
          // Queue the message for retry
          messageQueueRef.current.push(message);
          onError?.(
            error instanceof Error
              ? error
              : new Error("Failed to send message"),
          );
        }
      } else {
        // Queue the message if not connected
        messageQueueRef.current.push(message);

        // Auto-connect if disconnected
        if (connectionStatus.state === "disconnected") {
          connect();
        }
      }
    },
    [connectionStatus.state, connect, onError],
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

  // Auto-reconnect on network recovery
  useEffect(() => {
    const handleOnline = () => {
      if (
        connectionStatus.state === "disconnected" &&
        !isManuallyClosedRef.current
      ) {
        setTimeout(() => connect(), 1000);
      }
    };

    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [connectionStatus.state, connect]);

  return {
    connectionStatus,
    sendMessage,
    connect,
    disconnect,
    lastMessage: lastMessage || undefined,
  };
}

export default useWebSocket;
