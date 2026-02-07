import { connect } from 'cloudflare:sockets';

const UUID = "d342d11e-d424-4583-b36e-524ab1f0afa4";

export default {
  async fetch(request) {
    try {
      const url = new URL(request.url);

      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("VLESS Worker Ready ✅");
      }

      return await handle(request);

    } catch (e) {
      return new Response("Worker error: " + e.toString(), { status: 500 });
    }
  }
};

async function handle(request) {
  const pair = new WebSocketPair();
  const [client, ws] = Object.values(pair);
  ws.accept();

  ws.addEventListener("message", async (msg) => {
    try {
      const data = new Uint8Array(msg.data);
      const port = (data[22] << 8) + data[23];
      const addr = data.slice(24, 28).join(".");

      const socket = connect({ hostname: addr, port });

      const writer = socket.writable.getWriter();
      await writer.write(data.slice(26));
      writer.releaseLock();

      socket.readable.pipeTo(new WritableStream({
        write(chunk) {
          ws.send(chunk);
        }
      }));

    } catch {
      ws.close();
    }
  });

  return new Response(null, { status: 101, webSocket: client });
		}
