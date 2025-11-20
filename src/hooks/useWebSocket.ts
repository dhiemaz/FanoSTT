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

// JWT token validation utility
function decodeJWT(token: string) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) {
      throw new Error("Invalid JWT format");
    }

    const header = parts[0];
    const payload = parts[1];
    if (!header || !payload) {
      throw new Error("Invalid JWT header or payload");
    }

    const decoded = JSON.parse(
      atob(payload.replace(/-/g, "+").replace(/_/g, "/")),
    );

    return {
      header: JSON.parse(atob(header.replace(/-/g, "+").replace(/_/g, "/"))),
      payload: decoded,
      isExpired: decoded.exp ? Date.now() / 1000 > decoded.exp : false,
      expiresAt: decoded.exp ? new Date(decoded.exp * 1000) : null,
      issuedAt: decoded.iat ? new Date(decoded.iat * 1000) : null,
    };
  } catch (error) {
    return {
      error: `Failed to decode JWT: ${error}`,
      isValid: false,
    };
  }
}

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
    const timestamp = new Date().toISOString();
    console.log(
      `[FANO] ${timestamp} - WebSocket connection opened successfully`,
    );
    console.log("[FANO] Connected via proxy with Authorization header");
    console.log(`[FANO] Connection URL: ${url}`);
    console.log(`[FANO] Auth token used: ${auth.token.substring(0, 50)}...`);

    // Reset reconnection attempts on successful connection
    reconnectAttemptsRef.current = 0;

    updateConnectionStatus({
      state: "connected",
      lastConnected: new Date(),
      reconnectAttempts: 0,
    });

    processMessageQueue();
    onConnect?.();
  }, [updateConnectionStatus, processMessageQueue, onConnect, url, auth.token]);

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      try {
        const timestamp = new Date().toISOString();
        const message: FanoSTTResponse = JSON.parse(event.data);

        console.log(`[FANO] ${timestamp} - Message received`);
        console.log("[FANO] Raw message data:", event.data);
        console.log("[FANO] Parsed message:", message);
        console.log("[FANO] Message type:", typeof message);
        console.log("[FANO] Message keys:", Object.keys(message || {}));

        // Check for specific error patterns
        if (message && typeof message === "object") {
          if ("code" in message) {
            console.log(`[FANO] Response contains code: ${message.code}`);
          }
          if ("message" in message) {
            console.log(`[FANO] Response contains message: ${message.message}`);
          }
          if ("event" in message) {
            console.log(`[FANO] Response event type: ${message.event}`);
          }
          if ("data" in message) {
            console.log(`[FANO] Response data:`, message.data);
          }
        }

        // Special logging for RESOURCE_EXHAUSTED errors
        if (
          message &&
          typeof message === "object" &&
          "code" in message &&
          message.code === 8
        ) {
          console.error("🚫 [FANO] RESOURCE_EXHAUSTED ERROR DETECTED!");
          console.error(
            "[FANO] Full error response:",
            JSON.stringify(message, null, 2),
          );
          console.error("[FANO] Error code:", message.code);
          console.error("[FANO] Error message:", (message as any).message);
          console.error("[FANO] Connection will likely close after this error");
        }

        setLastMessage(message);
        onMessage?.(message);
      } catch (error) {
        const timestamp = new Date().toISOString();
        console.error(
          `❌ [FANO] ${timestamp} - Failed to parse message:`,
          error,
        );
        console.error(
          "[FANO] Raw message data that failed to parse:",
          event.data,
        );
        console.error("[FANO] Raw message type:", typeof event.data);
        console.error("[FANO] Raw message length:", event.data?.length);
        onError?.(new Error(`Failed to parse message: ${error}`));
      }
    },
    [onMessage, onError],
  );

  const handleError = useCallback(
    (event: Event) => {
      console.error("[FANO] Connection error:", event);
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
    const timestamp = new Date().toISOString();
    console.log(`[FANO] ${timestamp} - createWebSocketConnection called`);
    console.log(`[FANO] Current WebSocket state:`, wsRef.current?.readyState);
    console.log(
      `[FANO] Auth token being used:`,
      auth.token.substring(0, 50) + "...",
    );

    if (
      wsRef.current?.readyState === WebSocket.OPEN ||
      wsRef.current?.readyState === WebSocket.CONNECTING
    ) {
      console.log(
        `[FANO] ${timestamp} - Connection already exists or connecting, skipping`,
      );
      console.log(
        `[FANO] Current state: ${wsRef.current?.readyState === WebSocket.OPEN ? "OPEN" : "CONNECTING"}`,
      );
      return;
    }

    updateConnectionStatus({
      state: "connecting",
    });

    try {
      console.log(`[FANO] ${timestamp} - Creating new WebSocket connection`);
      console.log("[FANO] Connecting via proxy server with URL : ", url);
      console.log("[FANO] Full auth config:", {
        ...auth,
        token: auth.token.substring(0, 50) + "...",
      });

      // Validate JWT token
      const tokenInfo = decodeJWT(auth.token);
      console.log("[FANO] JWT Token Analysis:");
      if (tokenInfo.error) {
        console.error("[FANO] ❌ JWT Token Error:", tokenInfo.error);
      } else {
        console.log("[FANO] ✅ JWT Token successfully decoded");
        console.log("[FANO] Token Header:", tokenInfo.header);
        console.log("[FANO] Token Payload:", tokenInfo.payload);
        console.log("[FANO] Is Expired:", tokenInfo.isExpired);
        console.log("[FANO] Expires At:", tokenInfo.expiresAt?.toISOString());
        console.log("[FANO] Issued At:", tokenInfo.issuedAt?.toISOString());

        if (tokenInfo.isExpired) {
          console.error("🚨 [FANO] WARNING: JWT Token is EXPIRED!");
          console.error(
            `[FANO] Token expired at: ${tokenInfo.expiresAt?.toISOString()}`,
          );
          console.error(`[FANO] Current time: ${new Date().toISOString()}`);
        }

        if (tokenInfo.payload?.aud) {
          console.log("[FANO] Token Audience:", tokenInfo.payload.aud);
        }
        if (tokenInfo.payload?.sub) {
          console.log("[FANO] Token Subject:", tokenInfo.payload.sub);
        }
        if (tokenInfo.payload?.iss) {
          console.log("[FANO] Token Issuer:", tokenInfo.payload.iss);
        }
      }

      wsRef.current = new WebSocket(url);

      wsRef.current.onopen = handleOpen;
      wsRef.current.onmessage = handleMessage;
      wsRef.current.onerror = handleError;

      wsRef.current.onclose = (event: CloseEvent) => {
        const timestamp = new Date().toISOString();
        console.log(`[FANO] ${timestamp} - Connection closed`);
        console.log("[FANO] Close code:", event.code);
        console.log("[FANO] Close reason:", event.reason);
        console.log("[FANO] Was clean:", event.wasClean);
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
        // DISABLED: Don't reconnect when FANO sends error response and closes connection
        /*
        if (!isManuallyClosedRef.current && scheduleReconnectRef.current) {
          console.log("[FANO] Connection lost - initiating reconnection");
          scheduleReconnectRef.current();
        } else {
          console.log("[FANO] disconnect ");
        }
        */
        console.log("[FANO] disconnect - no reconnection attempt");
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
  // DISABLED: Commenting out entire reconnection logic
  /*
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
      `[FANO] Reconnecting in ${delay}ms (attempt ${currentAttempts + 1}/${maxAttempts})`,
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
  */

  const connect = useCallback(() => {
    const timestamp = new Date().toISOString();
    console.log(`[FANO] ${timestamp} - connect() function called`);
    console.log(`[FANO] Current connection state:`, connectionStatus.state);
    console.log(`[FANO] WebSocket readyState:`, wsRef.current?.readyState);

    if (
      wsRef.current?.readyState === WebSocket.OPEN ||
      wsRef.current?.readyState === WebSocket.CONNECTING
    ) {
      console.log(
        `[FANO] ${timestamp} - Already connected or connecting, skipping connect()`,
      );
      console.log(
        `[FANO] State: ${wsRef.current?.readyState === WebSocket.OPEN ? "OPEN" : "CONNECTING"}`,
      );
      return;
    }

    console.log(`[FANO] ${timestamp} - Proceeding with new connection`);
    isManuallyClosedRef.current = false;
    reconnectAttemptsRef.current = 0;
    clearTimeouts();

    createWebSocketConnection();
  }, [clearTimeouts, createWebSocketConnection, connectionStatus.state]);

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
      const timestamp = new Date().toISOString();
      console.log(`[FANO] ${timestamp} - sendMessage called`);
      console.log("[FANO] Message to send:", message);
      console.log(
        `[FANO] WebSocket state: ${wsRef.current?.readyState} (${
          wsRef.current?.readyState === WebSocket.OPEN
            ? "OPEN"
            : wsRef.current?.readyState === WebSocket.CONNECTING
              ? "CONNECTING"
              : wsRef.current?.readyState === WebSocket.CLOSED
                ? "CLOSED"
                : wsRef.current?.readyState === WebSocket.CLOSING
                  ? "CLOSING"
                  : "UNKNOWN"
        })`,
      );

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        try {
          const messageStr = JSON.stringify(message);
          console.log(
            `[FANO] ${timestamp} - Sending message of length: ${messageStr.length}`,
          );
          wsRef.current.send(messageStr);
        } catch (error) {
          console.error(
            `❌ [FANO] ${timestamp} - Failed to send message:`,
            error,
          );
          messageQueueRef.current.push(message);
          onError?.(
            error instanceof Error
              ? error
              : new Error("Failed to send message"),
          );
        }
      } else {
        console.log(
          `📥 [FANO] ${timestamp} - Queueing message - not connected`,
        );
        console.log(
          `[FANO] Current queue length: ${messageQueueRef.current.length}`,
        );
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
