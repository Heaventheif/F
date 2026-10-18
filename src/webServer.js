"use strict";

import { createServer } from "node:http";

function startWebServer() {
  const port = Number.parseInt(process.env.PORT || "10000", 10);
  const server = createServer((request, response) => {
    const pathname = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`).pathname;
    const ready = pathname === "/ready";
    const healthy = pathname === "/health" || pathname === "/";
    const isReady = !global.botFatal;
    const status = ready && !isReady ? 503 : 200;
    const body = ready ? (isReady ? "ready" : "starting") : healthy ? "ok" : ".";

    response.writeHead(status, {
      "content-type": "text/plain; charset=utf-8",
      "content-length": Buffer.byteLength(body),
      "cache-control": "no-store",
    });
    response.end(body);
  });

  server.on("error", (error) => {
    console.error(`[WEB] خطأ في الخادم: ${error?.message ?? error}`);
  });
  server.listen(port, "0.0.0.0", () => {
    console.log(`[SUCCESS] 🌐 خادم Node يعمل على المنفذ ${port}`);
  });
  global.nodeServer = server;
  return server;
}

export { startWebServer };
