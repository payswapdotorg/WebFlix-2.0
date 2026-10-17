/// <reference types="bun-types" />
/**
 * WFX2-P23-C — the sound-disc + sound-page data layer. FIXTURES ONLY (no
 * live network; never the player endpoint).
 *
 * Fixtures:
 * - tests/fixtures/yt/reel_sequence_sound_synth.json — SYNTHETIC-BUT-SHAPED-
 *   FROM-REAL reel_watch_sequence (the real captures ride
 *   evidence/wfx2p23c/reel_sequence_web_sound{,_p2}.json; the shapes were
 *   copied from those real responses — original sound, a live-sound entry
 *   with NO grid token, a bare entry, the named-sound form).
 * - tests/fixtures/yt/browse_audio_pivot.json — the REAL captured
 *   audio-pivot browse continuation (page 1 of the lofi sound's grid).
 */
import { describe, expect, test } from "bun:test";
import {
  extractSoundFromReelEntry,
  mapReelSequence,
} from "@/lib/youtube/shorts";
import {
  mapSoundCard,
  mapSoundPageResponse,
  soundKeyToToken,
  soundTokenToKeyLink,
} from "@/lib/youtube/sound";

const seqSound = await Bun.file(
  "tests/fixtures/yt/reel_sequence_sound_synth.json",
).json();
const browseAudioPivot = await Bun.file(
  "tests/fixtures/yt/browse_audio_pivot.json",
).json();

const TOKEN_1 =
  "4qmFsgKIARISRkVzZnZfYXVkaW9fcGl2b3QaVENBRHlCVG9LTmhJbkNndElNMDlPWnpkVFVGTlhWUklMU0ROUFRtYzNVMUJUVjFVYUMwZ3pUMDVuTjFOUVUxZFZHZw";

describe("extractSoundFromReelEntry — the pivot disc data (measured shape)", () => {
  test("the original-sound entry maps {soundId, soundTitle, soundImageUrl}", () => {
    const sound = extractSoundFromReelEntry(seqSound.entries[0]);
    expect(sound).not.toBeNull();
    expect(sound!.soundId).toBe(TOKEN_1);
    expect(sound!.soundTitle).toBe("Original Sound");
    // the LAST source = the largest artwork (3 sizes measured: 48/88/176)
    expect(sound!.soundImageUrl).toBe("https://yt3.ggpht.com/sound176.jpg");
  });

  test("title without the audio-pivot grid token → NO disc (never a dead link)", () => {
    // the live-sound entry: a pivot title but an EMPTY panel (no token)
    const sound = extractSoundFromReelEntry(seqSound.entries[1]);
    expect(sound).toBeNull();
  });

  test("the bare entry (no unserializedPrefetchData) → null — honest absence", () => {
    expect(extractSoundFromReelEntry(seqSound.entries[2])).toBeNull();
  });

  test("garbage input never throws", () => {
    expect(extractSoundFromReelEntry(null)).toBeNull();
    expect(extractSoundFromReelEntry("nope")).toBeNull();
    expect(extractSoundFromReelEntry({ command: {} })).toBeNull();
    expect(
      extractSoundFromReelEntry({
        command: { reelWatchEndpoint: { unserializedPrefetchData: {} } },
      }),
    ).toBeNull();
  });
});

describe("mapReelSequence — the sound rides the sequence DTO (P23-C G5)", () => {
  const feed = mapReelSequence(seqSound);

  test("the carrying entry maps its sound fields onto the DTO", () => {
    const first = feed.items[0];
    expect(first.id).toBe("H3ONg7SPSWU");
    expect(first.soundId).toBe(TOKEN_1);
    expect(first.soundTitle).toBe("Original Sound");
    expect(first.soundImageUrl).toBe("https://yt3.ggpht.com/sound176.jpg");
  });

  test("entries without sound data carry NO sound fields (disc hides)", () => {
    expect(feed.items[1].soundId).toBeUndefined();
    expect(feed.items[2].soundId).toBeUndefined();
    expect(feed.items[2].soundTitle).toBeUndefined();
  });

  test("the sequence's own contracts hold (live flag + next cursor)", () => {
    expect(feed.items).toHaveLength(3);
    expect(feed.items[1].isLive).toBe(true); // REEL_PLAYER_OVERLAY_STYLE_LIVE
    expect(feed.items[0].isLive).toBe(false);
    expect(feed.nextCursor).toBe("NEXT_SEQUENCE_TOKEN_FIXTURE");
  });
});

describe("mapSoundCard — the browse continuation's pageHeaderViewModel", () => {
  const card = mapSoundCard(browseAudioPivot);

  test("the REAL capture maps the sound title", () => {
    expect(card.title).toBe(
      "Chill Lofi Coffee Vibes | Relaxing Lofi Hip Hop Beats to Study/Work to",
    );
  });

  test("the card image (contentPreviewImageViewModel, 2:3 preview)", () => {
    expect(card.imageUrl).toMatch(/^https:\/\/i\.ytimg\.com\/vi\//);
  });

  test("the owner channel row (avatarStack: id + @handle + avatar)", () => {
    expect(card.channel).not.toBeNull();
    expect(card.channel!.id).toBe("UCS0BLnvAbBuAhM3RC1mZ6Ew");
    expect(card.channel!.handle).toBe("LofiCafeChillMRelax");
    expect(card.channel!.avatarUrl).toMatch(/^https:\/\/yt3\.ggpht\.com\//);
  });

  test("an empty response degrades to the honest empty card", () => {
    const card = mapSoundCard({});
    expect(card.title).toBe("");
    expect(card.imageUrl).toBeNull();
    expect(card.channel).toBeNull();
  });
});

describe("mapSoundPageResponse — the sound grid (measured shape)", () => {
  const grid = mapSoundPageResponse(browseAudioPivot);

  test("the REAL capture maps 15 shorts lockups in feed order", () => {
    expect(grid.items).toHaveLength(15);
    expect(grid.items[0].id).toBe("vzpP7orCbxQ");
    expect(grid.items[0].title).toBeTruthy();
    expect(grid.items[0].viewsText).toBeTruthy();
    expect(grid.items[0].thumbnailUrl).toMatch(/^https:\/\/i\.ytimg\.com\//);
  });

  test("the next browse continuation token maps (paging)", () => {
    expect(grid.nextCursor).toBeTruthy();
    expect(grid.nextCursor!.startsWith("4qmF")).toBe(true);
  });

  test("an empty/garbage response maps the honest empty grid", () => {
    expect(mapSoundPageResponse({}).items).toEqual([]);
    expect(mapSoundPageResponse({ onResponseReceivedActions: [] }).nextCursor).toBeNull();
  });
});

describe("the /sound/<key> codec (the token carries literal %3D)", () => {
  test("soundTokenToKeyLink percent-encodes; soundKeyToToken is the identity", () => {
    const token = "abc%3D%3Dtail";
    const link = soundTokenToKeyLink(token);
    expect(link).toBe(`/sound/abc%253D%253Dtail`);
    // the route param decodes exactly once → the raw token back; a second
    // decode here would mangle it ("Q==" corruption) — identity is correct
    expect(soundKeyToToken(token)).toBe(token);
    expect(soundKeyToToken(decodeURIComponent("abc%253D%253Dtail"))).toBe(token);
  });

  test("the real measured token round-trips through the link form", () => {
    const link = soundTokenToKeyLink(TOKEN_1);
    expect(link.startsWith("/sound/")).toBe(true);
    // what the route would receive after ITS single decode:
    expect(decodeURIComponent(link.slice("/sound/".length))).toBe(TOKEN_1);
  });
});
