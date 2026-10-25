/**
 * WebFlix Netflix Desktop — CDP relay (runs INSIDE the sandbox).
 *
 * Chrome's DevTools endpoint rejects proxied Host headers; this relay listens
 * on 0.0.0.0:9223, forwards raw TCP to 127.0.0.1:9222 and rewrites the first
 * Host header of each client connection. Python stdlib only.
 *
 * P51-AUDIT (report §3.2 B2): the relay is reachable on the sandbox's PUBLIC
 * host (`9223-<id>.e2b.app`), and raw CDP means full DevTools control of the
 * signed-in Chrome — HttpOnly Netflix cookies included. The relay therefore
 * requires a per-boot shared secret (`RELAY_TOKEN` env, minted by the broker
 * for each sandbox) on every connection's first request head — as the
 * `x-nf-relay-token` header or a `token=` query param — and STRIPS the token
 * from the request line before forwarding (Chrome must see its exact
 * DevTools paths). No token (or a wrong token) → 403 / closed socket.
 * Fail-closed: with no RELAY_TOKEN set the relay refuses to start.
 */
export const CDP_RELAY_PY = String.raw`
import asyncio
import os
import sys
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode

UPSTREAM = ("127.0.0.1", 9222)
RELAY_TOKEN = os.environ.get("RELAY_TOKEN", "")
TOKEN_HEADER = b"x-nf-relay-token:"

if not RELAY_TOKEN:
    sys.stderr.write("cdp-relay: RELAY_TOKEN missing — refusing to start (fail closed)\n")
    sys.exit(1)


def rewrite_first_head(data):
    """Validate the token on the first request head; return (ok, new_data)
    with the token stripped and the Host header rewritten for Chrome."""
    head, sep, rest = data.partition(b"\r\n\r\n")
    lines = head.split(b"\r\n")
    if not lines:
        return False, data
    parts = lines[0].split(b" ")
    if len(parts) < 2:
        return False, data
    try:
        sp = urlsplit(parts[1].decode("latin-1"))
    except ValueError:
        return False, data
    # split the query into the token (consumed) and everything else (kept)
    q_token = None
    kept = []
    for k, v in parse_qsl(sp.query, keep_blank_values=True):
        if k == "token" and q_token is None:
            q_token = v
        else:
            kept.append((k, v))
    h_token = None
    new_lines = []
    for ln in lines[1:]:
        if ln[:5].lower() == b"host:":
            new_lines.append(b"Host: 127.0.0.1:9222")
            continue
        if ln[: len(TOKEN_HEADER)].lower() == TOKEN_HEADER:
            try:
                h_token = ln[len(TOKEN_HEADER):].strip().decode("latin-1")
            except Exception:
                h_token = ""
            continue
        new_lines.append(ln)
    provided = [t for t in (q_token, h_token) if t is not None]
    if not provided:
        return False, data
    if any(t != RELAY_TOKEN for t in provided):
        return False, data
    # rebuild the (token-stripped) request line — Chrome must see its exact
    # DevTools paths; a foreign query param can break the WS origin check
    clean_target = urlunsplit(
        (sp.scheme, sp.netloc, sp.path, urlencode(kept), sp.fragment)
    ).encode("latin-1")
    if len(parts) >= 3:
        new_lines.insert(0, b" ".join([parts[0], clean_target, parts[-1]]))
    else:
        new_lines.insert(0, parts[0] + b" " + clean_target)
    return True, b"\r\n".join(new_lines) + sep + rest


async def pump(reader, writer):
    try:
        while True:
            data = await reader.read(65536)
            if not data:
                break
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
    # P51-AUDIT (B2): validate the token on the connection's FIRST request
    # head BEFORE anything reaches Chrome; a rejection answers 403 on the
    # CLIENT leg and closes (nothing is forwarded upstream).
    try:
        first = await client_reader.read(65536)
    except Exception:
        first = b""
    if not first:
        try:
            client_writer.close()
        except Exception:
            pass
        return
    ok, first = rewrite_first_head(first)
    if not ok:
        try:
            client_writer.write(
                b"HTTP/1.1 403 Forbidden\r\n"
                b"Content-Length: 0\r\n"
                b"Connection: close\r\n\r\n"
            )
            await client_writer.drain()
        except Exception:
            pass
        try:
            client_writer.close()
        except Exception:
            pass
        return
    try:
        up_reader, up_writer = await asyncio.open_connection(*UPSTREAM)
    except Exception:
        try:
            client_writer.close()
        except Exception:
            pass
        return
    # forward the validated (token-stripped) head, then pump the rest raw
    try:
        up_writer.write(first)
        await up_writer.drain()
    except Exception:
        try:
            client_writer.close()
        except Exception:
            pass
        return
    await asyncio.gather(
        pump(client_reader, up_writer),
        pump(up_reader, client_writer),
    )


async def main():
    server = await asyncio.start_server(handle, "0.0.0.0", 9223)
    async with server:
        await server.serve_forever()

asyncio.run(main())
`;
