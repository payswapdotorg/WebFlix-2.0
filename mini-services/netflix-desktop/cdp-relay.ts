/**
 * WebFlix Netflix Desktop — CDP relay (runs INSIDE the sandbox).
 *
 * Chrome's DevTools endpoint rejects proxied Host headers; this relay listens
 * on 0.0.0.0:9223, forwards raw TCP to 127.0.0.1:9222 and rewrites the first
 * Host header of each client connection. Python stdlib only.
 */
export const CDP_RELAY_PY = String.raw`
import asyncio

UPSTREAM = ("127.0.0.1", 9222)

async def pump(reader, writer, rewrite_host):
    rewritten = not rewrite_host
    try:
        while True:
            data = await reader.read(65536)
            if not data:
                break
            if not rewritten:
                head, sep, rest = data.partition(b"\r\n\r\n")
                lines = head.split(b"\r\n")
                out = []
                for ln in lines:
                    if ln[:5].lower() == b"host:":
                        out.append(b"Host: 127.0.0.1:9222")
                    else:
                        out.append(ln)
                data = b"\r\n".join(out) + sep + rest
                rewritten = True
            writer.write(data)
            await writer.drain()
    except Exception:
        pass
    finally:
        try:
            writer.close()
        except Exception:
            pass

async def handle(client_reader, client_writer):
    try:
        up_reader, up_writer = await asyncio.open_connection(*UPSTREAM)
    except Exception:
        try:
            client_writer.close()
        except Exception:
            pass
        return
    await asyncio.gather(
        pump(client_reader, up_writer, True),
        pump(up_reader, client_writer, False),
    )

async def main():
    server = await asyncio.start_server(handle, "0.0.0.0", 9223)
    async with server:
        await server.serve_forever()

asyncio.run(main())
`;
