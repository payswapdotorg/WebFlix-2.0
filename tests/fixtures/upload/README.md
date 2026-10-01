# tests/fixtures/upload — the SYNTHETIC upload fixture

**Provenance: SYNTHETIC — generated, never scraped.** This directory contains
no third-party content of any kind.

## `synthetic-480p-1s-webflix-fixture.mp4`

A real, decodable ~1 second 480p (854×480) H.264 MP4 used by
`tests/upload-flow.test.ts` as the staged-file payload for the
WFX2-P3-UP upload-flow tests (staging round-trip + the broker-drive
contract). The filename carries the provenance mark (`synthetic`) per the
lane's fixture law.

Regenerate locally (ffmpeg, testsrc — the SMPTE-style synthetic generator):

```sh
ffmpeg -f lavfi -i "testsrc=duration=1:size=854x480:rate=30" \
  -c:v libx264 -pix_fmt yuv420p -movflags +faststart \
  -y tests/fixtures/upload/synthetic-480p-1s-webflix-fixture.mp4
```

- Video: H.264, 854×480, 30 fps, 1.0 s
- Container: MP4 (`ftyp` box first — `+faststart`), no audio track
- Content: ffmpeg's own `testsrc` pattern (color bars + running counter) —
  machine-generated pixels, public-domain-equivalent, no copyright surface
