import { describe, it, expect, afterEach } from "vitest";
import { createServer } from "http";

describe("server bind address", () => {
  let server: ReturnType<typeof createServer> | undefined;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = undefined;
    }
  });

  it("binds to 127.0.0.1 when host is explicitly specified", async () => {
    server = createServer((_req, res) => {
      res.writeHead(200);
      res.end("ok");
    });

    await new Promise<void>((resolve) => {
      server!.listen(0, "127.0.0.1", () => resolve());
    });

    const addr = server.address();
    expect(addr).not.toBeNull();
    expect(typeof addr).toBe("object");
    if (typeof addr === "object" && addr) {
      expect(addr.address).toBe("127.0.0.1");
    }
  });

  it("does NOT bind to 0.0.0.0 (all interfaces) by default", async () => {
    server = createServer((_req, res) => {
      res.writeHead(200);
      res.end("ok");
    });

    await new Promise<void>((resolve) => {
      server!.listen(0, "127.0.0.1", () => resolve());
    });

    const addr = server.address();
    if (typeof addr === "object" && addr) {
      expect(addr.address).not.toBe("0.0.0.0");
      expect(addr.address).not.toBe("::");
    }
  });

  it("is reachable on localhost when bound to 127.0.0.1", async () => {
    server = createServer((_req, res) => {
      res.writeHead(200);
      res.end("ok");
    });

    await new Promise<void>((resolve) => {
      server!.listen(0, "127.0.0.1", () => resolve());
    });

    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    expect(port).toBeGreaterThan(0);

    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toBe("ok");
  });
});
