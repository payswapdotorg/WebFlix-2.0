/**
 * P46 — packs the WebFlix Bridge extension into public/netflix-bridge.zip
 * (the download the app's automatic sign-in panel serves) and generates the
 * icon set (a Netflix-red tile with a white bridge arc — pure pixel math,
 * no image deps). Run: bun scripts/pack-bridge.mjs
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extDir = join(root, "extension", "webflix-bridge");
const outZip = join(root, "public", "netflix-bridge.zip");

// ---- minimal PNG writer (RGBA, no interlace) ----
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size, pixel) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0; // filter none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x / (size - 1), y / (size - 1));
      const o = rowStart + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// red tile + rounded corners + a white arc (the bridge)
const iconPixel = (u, v) => {
  const edge = Math.min(u, v, 1 - u, 1 - v);
  const alpha = edge < 0.06 ? 0 : 255;
  const cx = u - 0.5, cy = v - 0.78; // arc center below the tile top
  const d = Math.sqrt(cx * cx + cy * cy);
  const onArc = d > 0.32 && d < 0.45 && cy < 0.15;
  if (onArc) return [255, 255, 255, alpha];
  return [229, 9, 20, alpha];
};

mkdirSync(join(extDir, "icons"), { recursive: true });
for (const size of [16, 48, 128]) {
  writeFileSync(join(extDir, "icons", `icon${size}.png`), png(size, iconPixel));
}

// ---- sanity: manifest parses + references exist ----
const manifest = JSON.parse(readFileSync(join(extDir, "manifest.json"), "utf8"));
for (const p of Object.values(manifest.icons ?? {})) {
  if (!existsSync(join(extDir, p))) throw new Error(`missing icon ${p}`);
}

// ---- zip ----
mkdirSync(dirname(outZip), { recursive: true });
execFileSync("zip", ["-r", "-X", "-q", outZip, "."], { cwd: extDir });
console.log(`[pack-bridge] ${outZip} (${manifest.version})`);
