const WebSocket = require("ws");
const http = require("http");

// Configuration from environment variables
const PROXY_PORT = process.env.PROXY_PORT || 8080;
const FANO_URL =
  process.env.FANO_URL || "wss://ocbc-poc.fano.ai/speech/streaming-recognize";
const AUTH_TOKEN =
  process.env.AUTH_TOKEN ||
  "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJmYW5vX2RlbmllZF9hY2Nlc3MiOlsiY2FsbGludGVyOndvcmtzcGFjZS0qIiwiY2FsbGludGVyOnZvaWNlcHJpbnQtKiIsImNhbGxpbnRlcjp3b3JkLWNsb3VkLSoiLCJjYWxsaW50ZXI6cHJvLXNlYXJjaC1hbmQtc2F2ZS1xdWVyeSIsImNhbGxpbnRlcjp3b3Jrc3BhY2Utbm90aWZpY2F0aW9uLXRhcmdldCIsImNhbGxpbnRlcjpub3RpZmljYXRpb24tdGFyZ2V0IiwiSW50ZW50OioiLCJQb3J0YWw6c3VwZXItdXNlciJdLCJmYW5vX3NwZWVjaF9kaWFyaXplX3F1b3RhX3N0cmF0ZWd5IjoiZGVmYXVsdCIsImZhbm9fc3BlZWNoX2dlbmVyYXRlX3ZvaWNlcHJpbnRfcXVvdGFfc3RyYXRlZ3kiOiJkZWZhdWx0IiwiZmFub19zcGVlY2hfcmVjb2duaXplX3F1b3RhX3N0cmF0ZWd5IjoiZGVmYXVsdCIsImZhbm9fc3BlZWNoX3N0cmVhbWluZ19kZXRlY3RfYWN0aXZpdHlfcXVvdGFfc3RyYXRlZ3kiOiJkZWZhdWx0IiwiZmFub19zcGVlY2hfc3RyZWFtaW5nX3JlY29nbml6ZV9xdW90YV9zdHJhdGVneSI6ImRlZmF1bHQiLCJmYW5vX3NwZWVjaF9yZXBsYWNlX3BocmFzZXNfcXVvdGFfc3RyYXRlZ3kiOiJkZWZhdWx0IiwiZmFub19zcGVlY2hfc3ludGhlc2l6ZV9zcGVlY2hfcXVvdGFfc3RyYXRlZ3kiOiJkZWZhdWx0IiwiaWF0IjoxNzYyNzM4ODg3LCJleHAiOjE3NjUzODI0MDAsImF1ZCI6InRlbXAtb2NiYy1ydHN0dC1wb2MiLCJzdWIiOiJPQ0JDIiwiaXNzIjoiaHR0cHM6Ly9hdXRoLmZhbm8uYWkifQ.Gj3qIyhD2aZvNADKSlOPKnI4w8dMgEDcgiybx8vGn5xTSdYeBw_d9AiyoCjOQb0m-FAJRRL73ykXYLV_Q5EjzvCt4Kmigdb40N5aFCssQ2rq0yUry2rxhT84eBNptfwOy6SJPoZOTkrTm026W8DkFOzNO_NxFWJLmjMZiRfJAGhOBmfEZlDJxmfTaVNKWC-qD2b-p09JoXsRU7hOcvHrmST7igbEwiHunA9ig1T9dfFoxPulMCsIDl7VsCK_AbbjWWpAJ2mkqjyDyzMLlTxBKbVIKX_s8V9dG9VgiHzCGTBiV4uuoiAsoupJ7GOdov6xmvdG2UMVuUv1yh3D78JTSA";

// Create HTTP server with health check endpoint
const server = http.createServer((req, res) => {
  if (req.url === "/health" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        timestamp: new Date().toISOString(),
        service: "fano-stt-proxy",
        version: "1.0.0",
      }),
    );
  } else {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  }
});

// Create WebSocket server
const wss = new WebSocket.Server({ server });

console.log(`FANO STT Proxy Server starting on port ${PROXY_PORT}`);
console.log(`Proxying to: ${FANO_URL}`);
console.log(`Using Authorization: Bearer ${AUTH_TOKEN.substring(0, 50)}...`);

wss.on("connection", (clientWs, request) => {
  console.log("Client connected from:", request.socket.remoteAddress);

  let fanoWs = null;

  try {
    // Connect to FANO STT with Authorization header
    fanoWs = new WebSocket(FANO_URL, {
      headers: {
        Authorization: `Bearer ${AUTH_TOKEN}`,
        "User-Agent": "FANO-STT-Proxy/1.0",
        Origin: "https://proxy.local",
      },
    });

    console.log("Connecting to FANO STT with Authorization header...");

    fanoWs.on("open", () => {
      console.log("Connected to FANO STT with Authorization header");
    });

    fanoWs.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());
        console.log("[FANO → CLIENT]:", {
          event: message.event,
          hasResults: !!message.data?.results,
          hasError: !!message.data?.error,
        });

        // Forward message to client
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(data.toString());
        }
      } catch (error) {
        console.error("❌ Error processing FANO message:", error);
        // Still forward the raw message
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(data.toString());
        }
      }
    });

    fanoWs.on("error", (error) => {
      console.error("❌ FANO STT connection error:", error.message);
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(
          JSON.stringify({
            event: "error",
            data: {
              error: { message: `FANO connection error: ${error.message}` },
            },
          }),
        );
      }
    });

    fanoWs.on("close", (code, reason) => {
      console.log(`FANO STT connection closed: ${code} ${reason}`);
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.close(code, reason || "FANO connection closed");
      }
    });
  } catch (error) {
    console.error("❌ Failed to connect to FANO STT:", error);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(
        JSON.stringify({
          event: "error",
          data: {
            error: { message: `Proxy connection error: ${error.message}` },
          },
        }),
      );
      clientWs.close(1011, "Proxy connection failed");
    }
    return;
  }

  // Handle client messages
  clientWs.on("message", (data) => {
    try {
      const message = JSON.parse(data.toString());

      // Skip auth messages since we handle auth via headers
      if (message.event === "auth") {
        console.log("🔐 Skipping auth message (handled via header)");
        return;
      }

      console.log("📤 [CLIENT → FANO]:", {
        event: message.event,
        hasStreamingConfig: !!message.data?.streamingConfig,
        hasAudioContent: !!message.data?.audioContent,
        isEOF: message.data === "EOF",
      });

      // Forward message to FANO STT
      if (fanoWs && fanoWs.readyState === WebSocket.OPEN) {
        fanoWs.send(data.toString());
      } else {
        console.warn("FANO connection not ready, dropping message");
      }
    } catch (error) {
      console.error("❌ Error processing client message:", error);
    }
  });

  clientWs.on("close", (code, reason) => {
    console.log(`Client disconnected: ${code} ${reason}`);
    if (fanoWs && fanoWs.readyState === WebSocket.OPEN) {
      fanoWs.close(1000, "Client disconnected");
    }
  });

  clientWs.on("error", (error) => {
    console.error("❌ Client connection error:", error);
    if (fanoWs && fanoWs.readyState === WebSocket.OPEN) {
      fanoWs.close(1011, "Client error");
    }
  });
});

// Start server
server.listen(PROXY_PORT, () => {
  console.log(`FANO STT Proxy Server running on ws://localhost:${PROXY_PORT}`);
  console.log(
    `Update your frontend to connect to: ws://localhost:${PROXY_PORT}`,
  );
  console.log("");
  console.log("Usage:");
  console.log("1. Run: node proxy-server.js");
  console.log("2. Update WEBSOCKET_URL to: ws://localhost:8080");
  console.log(
    "3. Your frontend will connect through this proxy with proper Authorization header",
  );
  console.log("");
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("Shutting down proxy server...");
  server.close(() => {
    console.log("Proxy server stopped");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("Shutting down proxy server...");
  server.close(() => {
    console.log("Proxy server stopped");
    process.exit(0);
  });
});
