/**
 * WebFlix 2.0 seed — WebFlix-style demo dataset.
 * Run: bun prisma/seed.ts   (or: bun run db:seed)
 *
 * Media: real playable mp4s from Google's public demo bucket +
 * picsum.photos deterministic stills for thumbnails/avatars/banners.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

// Verified playable public sources (the gtv-videos-bucket is 403-ACL-locked since
// 2026-09-28 — durations below are ffprobe-verified; see evidence/wfx2w/SCHEMA-MERGE.md).
const MEDIA = {
  bunny: "https://media.w3.org/2010/05/bunny/movie.mp4", // 596s — full film
  ed: "https://download.blender.org/ED/elephantsdream-720-h264-st-aac.mov", // 658s — full film
  sintelTrailer: "https://download.blender.org/durian/trailer/sintel_trailer-720p.mp4", // 52s
  reel2013: "https://download.blender.org/demo/movies/Blender_reel_2013.mov", // 200s
  cycles: "https://download.blender.org/demo/movies/Cycles_Demoreel_2015.mov", // 85s
  peach: "https://download.blender.org/peach/trailer/trailer_iphone.m4v", // 33s
  oceans: "https://vjs.zencdn.net/v/oceans.mp4", // 47s
  flower: "https://mdn.github.io/shared-assets/videos/flower.mp4", // 5s
  jelly1: "https://test-videos.co.uk/vids/jellyfish/mp4/h264/720/Jellyfish_720_10s_1MB.mp4", // 10s
  jelly5: "https://test-videos.co.uk/vids/jellyfish/mp4/h264/720/Jellyfish_720_10s_5MB.mp4", // 10s
  bbb10: "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/720/Big_Buck_Bunny_720_10s_5MB.mp4", // 10s
  bbb1080: "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/1080/Big_Buck_Bunny_1080_10s_5MB.mp4", // 10s
  sintel10: "https://test-videos.co.uk/vids/sintel/mp4/h264/360/Sintel_360_10s_1MB.mp4", // 10s
} as const;
const pic = (seed: string, w: number, h: number) =>
  `https://picsum.photos/seed/${seed}/${w}/${h}`;

const now = new Date();
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);

type SeededVideo = {
  key: string;
  slug: string;
  title: string;
  channel: string; // channel handle
  category: string;
  views: number;
  likes: number;
  dislikes: number;
  durationSec: number;
  mp4: string;
  createdAt: Date;
  description?: string;
  isMembersOnly?: boolean;
  membersTier?: string;
  isLive?: boolean;
  premieredAt?: Date;
  isShort?: boolean;
};

async function main() {
  // ---- wipe (FK-safe order) -----------------------------------------------
  await db.videoSignal.deleteMany();
  await db.thumbnailTest.deleteMany()
  await db.liveChatMessage.deleteMany()
  await db.membership.deleteMany()
  await db.membershipTier.deleteMany()
  await db.notification.deleteMany()
  await db.playlistItem.deleteMany()
  await db.playlist.deleteMany()
  await db.commentLike.deleteMany()
  await db.comment.deleteMany()
  await db.viewEvent.deleteMany()
  await db.videoLike.deleteMany()
  await db.video.deleteMany()
  await db.subscribe.deleteMany()
  await db.channel.deleteMany()
  await db.user.deleteMany()

  // ---- users ---------------------------------------------------------------
  const you = await db.user.create({
    data: {
      handle: "you",
      name: "Demo Viewer",
      avatarUrl: pic("you-avatar", 88, 88),
      bannerUrl: pic("you-banner", 640, 200),
      description: "The demo account — history, likes and playlists below are yours.",
      createdAt: daysAgo(400),
    },
  });

  const commenter = await db.user.create({
    data: {
      handle: "riverphx",
      name: "River Phoenix",
      avatarUrl: pic("river", 88, 88),
      createdAt: daysAgo(300),
    },
  });
  const commenter2 = await db.user.create({
    data: {
      handle: "mikadev",
      name: "Mika Dev",
      avatarUrl: pic("mika", 88, 88),
      createdAt: daysAgo(280),
    },
  });

  // ---- channels (CodeCraft is owned by the demo user → Creator Studio) ------
  const pixel = await db.channel.create({
    data: {
      handle: "pixel-studios",
      name: "Pixel Studios",
      avatarUrl: pic("pixel-studios-avatar", 88, 88),
      bannerUrl: pic("pixel-studios-banner", 1707, 283),
      description:
        "Open movies, animation breakdowns and behind-the-scenes from the Blender film collective. Home of Big Buck Bunny, Elephants Dream, Sintel and Tears of Steel.",
      verified: true,
      subscriberCount: 2_410_000,
      createdAt: daysAgo(2200),
    },
  });
  const gamevault = await db.channel.create({
    data: {
      handle: "gamevault",
      name: "GameVault",
      avatarUrl: pic("gamevault-avatar", 88, 88),
      bannerUrl: pic("gamevault-banner", 1707, 283),
      description: "Boss fights, tier lists and deep dives. New uploads every week.",
      verified: true,
      subscriberCount: 3_120_000,
      createdAt: daysAgo(1800),
    },
  });
  const wanderlust = await db.channel.create({
    data: {
      handle: "wanderlust-travel",
      name: "Wanderlust Travel",
      avatarUrl: pic("wanderlust-avatar", 88, 88),
      bannerUrl: pic("wanderlust-banner", 1707, 283),
      description: "4K travel documentaries, street food tours and trails from every continent.",
      verified: true,
      subscriberCount: 1_840_000,
      createdAt: daysAgo(1500),
    },
  });
  const soundforge = await db.channel.create({
    data: {
      handle: "sound-forge",
      name: "Sound Forge",
      avatarUrl: pic("soundforge-avatar", 88, 88),
      bannerUrl: pic("soundforge-banner", 1707, 283),
      description: "Mixes, soundscapes and frequencies for focus.",
      verified: true,
      subscriberCount: 1_260_000,
      createdAt: daysAgo(1300),
    },
  });
  const codecraft = await db.channel.create({
    data: {
      handle: "codecraft",
      name: "CodeCraft",
      avatarUrl: pic("codecraft-avatar", 88, 88),
      bannerUrl: pic("codecraft-banner", 1707, 283),
      description:
        "Software engineering deep dives, tech reviews and a weekly live build. Owned by the demo account (you).",
      verified: true,
      subscriberCount: 984_000,
      ownerId: you.id,
      createdAt: daysAgo(1100),
    },
  });

  // ---- subscriptions --------------------------------------------------------
  await db.subscribe.createMany({
    data: [
      { userId: you.id, channelId: pixel.id, bell: "all", createdAt: daysAgo(200) },
      { userId: you.id, channelId: gamevault.id, bell: "personalized", createdAt: daysAgo(150) },
      { userId: you.id, channelId: wanderlust.id, bell: "off", createdAt: daysAgo(90) },
      { userId: you.id, channelId: soundforge.id, bell: "personalized", createdAt: daysAgo(60) },
    ],
  });

  // ---- videos ---------------------------------------------------------------
  const V: SeededVideo[] = [
    {
      key: "bbb",
      slug: "big-buck-bunny-4k",
      title: "Big Buck Bunny — Full Animated Short Film (4K)",
      channel: pixel.handle,
      category: "Comedy",
      views: 12_845_390,
      likes: 892_000,
      dislikes: 4_100,
      durationSec: 596,
      mp4: MEDIA.bunny,
      createdAt: daysAgo(92),
      description:
        "A giant rabbit with a heart bigger than himself follows three rodents to their comeuppance. The classic Blender open movie, remastered in 4K.\n\nChapters:\n00:00 Intro\n00:45 Meet Big Buck Bunny\n08:00 The rodent gang\n11:00 Revenge",
    },
    {
      key: "elephants",
      slug: "elephants-dream-4k",
      title: "Elephants Dream — The First Blender Open Movie (4K Remaster)",
      channel: pixel.handle,
      category: "Comedy",
      views: 8_237_604,
      likes: 511_000,
      dislikes: 3_200,
      durationSec: 658,
      mp4: MEDIA.ed,
      createdAt: daysAgo(245),
      description: "Emo and Proog wander a surreal machine world. The world's first open movie, remastered.",
    },
    {
      key: "sintel",
      slug: "sintel-short-film",
      title: "Sintel — Official Trailer (Blender Foundation)",
      channel: pixel.handle,
      category: "Education",
      views: 6_412_300,
      likes: 398_000,
      dislikes: 2_100,
      durationSec: 52,
      mp4: MEDIA.sintelTrailer,
      createdAt: daysAgo(365),
      description: "A lonely girl searches for the dragon she once befriended — the official trailer for Blender Foundation's third open movie.",
    },
    {
      key: "tears",
      slug: "tears-of-steel-vfx",
      title: "Blender Studio — 2013 Showreel (Tears of Steel VFX)",
      channel: pixel.handle,
      category: "Tech",
      views: 5_120_488,
      likes: 341_000,
      dislikes: 1_800,
      durationSec: 200,
      mp4: MEDIA.reel2013,
      createdAt: daysAgo(152),
      description: "The Blender Institute 2013 showreel — visual-effects and animation highlights, featuring work from Tears of Steel.",
    },
    {
      key: "members-studio",
      slug: "members-studio-tour",
      title: "Members Only: Studio Tour & Render Farm Walkthrough",
      channel: pixel.handle,
      category: "Tech",
      views: 89_412,
      likes: 9_800,
      dislikes: 120,
      durationSec: 658,
      mp4: MEDIA.ed,
      createdAt: daysAgo(14),
      isMembersOnly: true,
      membersTier: "Studio Insider",
      description: "A full walk through the render farm and motion-capture stage. Exclusively for Studio Insiders.",
    },
    {
      key: "iceland",
      slug: "exploring-iceland-4k",
      title: "Exploring Iceland — 4K Travel Documentary",
      channel: wanderlust.handle,
      category: "Travel",
      views: 3_240_900,
      likes: 204_000,
      dislikes: 1_100,
      durationSec: 10,
      mp4: MEDIA.jelly5,
      createdAt: daysAgo(120),
      description: "Ring road, black sand, glaciers and hidden hot springs — 14 days across Iceland in 4K.",
    },
    {
      key: "tokyo",
      slug: "tokyo-street-food",
      title: "Tokyo Street Food Tour — 12 Dishes You Must Try",
      channel: wanderlust.handle,
      category: "Cooking",
      views: 5_830_100,
      likes: 372_000,
      dislikes: 2_400,
      durationSec: 47,
      mp4: MEDIA.oceans,
      createdAt: daysAgo(180),
      description: "From standing sushi to taiyaki — 12 essential bites across Shibuya and Asakusa.",
    },
    {
      key: "ramen",
      slug: "perfect-ramen-at-home",
      title: "How to Make the Perfect Ramen at Home — Brooth to Bowl",
      channel: wanderlust.handle,
      category: "Cooking",
      views: 2_904_700,
      likes: 187_000,
      dislikes: 980,
      durationSec: 10,
      mp4: MEDIA.jelly1,
      createdAt: daysAgo(45),
      description: "A 12-hour tonkotsu broth, noodles from scratch, and the chashu that ties it all together.",
    },
    {
      key: "bangkok",
      slug: "bangkok-night-market",
      title: "Street Food in Bangkok — Night Market Adventure",
      channel: wanderlust.handle,
      category: "Cooking",
      views: 4_112_800,
      likes: 262_000,
      dislikes: 1_500,
      durationSec: 33,
      mp4: MEDIA.peach,
      createdAt: daysAgo(70),
      description: "Mango sticky rice, boat noodles and the legendary pad thai lady of Ratchada night market.",
    },
    {
      key: "hiit",
      slug: "full-body-hiit",
      title: "20-Minute Full Body HIIT Workout (No Equipment)",
      channel: wanderlust.handle,
      category: "Fitness",
      views: 11_230_600,
      likes: 610_000,
      dislikes: 12_000,
      durationSec: 10,
      mp4: MEDIA.sintel10,
      createdAt: daysAgo(400),
      description: "Follow along, no equipment, no excuses. Warm-up, 7 rounds, cool-down.",
    },
    {
      key: "elden",
      slug: "elden-ring-no-hit",
      title: "Elden Ring DLC — Final Boss Fight (No Hit)",
      channel: gamevault.handle,
      category: "Gaming",
      views: 9_634_000,
      likes: 528_000,
      dislikes: 3_300,
      durationSec: 200,
      mp4: MEDIA.reel2013,
      createdAt: daysAgo(13),
      description: "No damage taken, no summons, pure reflexes. Strategy notes in the pinned comment.",
    },
    {
      key: "gta6",
      slug: "gta6-deep-dive",
      title: "GTA 6 Gameplay Deep-Dive — Everything We Know",
      channel: gamevault.handle,
      category: "Gaming",
      views: 4_204_700,
      likes: 288_000,
      dislikes: 4_100,
      durationSec: 10,
      mp4: MEDIA.bbb1080,
      createdAt: daysAgo(31),
      description: "Frame-by-frame on the trailer: physics, wildlife, weather system and the new map.",
    },
    {
      key: "f1",
      slug: "f1-2026-preview",
      title: "F1 2026 Season Preview — Every Team Ranked",
      channel: gamevault.handle,
      category: "Sports",
      views: 1_532_800,
      likes: 96_400,
      dislikes: 870,
      durationSec: 10,
      mp4: MEDIA.jelly5,
      createdAt: daysAgo(21),
      description: "New regulations, new engines, same chaos. We rank all 10 constructors.",
    },
    {
      key: "synthwave",
      slug: "synthwave-retro-drive",
      title: "Synthwave Mix — 1 Hour Retro Drive",
      channel: soundforge.handle,
      category: "Mixes",
      views: 4_412_600,
      likes: 301_000,
      dislikes: 1_200,
      durationSec: 10,
      mp4: MEDIA.jelly1,
      createdAt: daysAgo(33),
      description: "Neon grids, analog warmth, one hour of retrowave. Track list in the description.",
    },
    {
      key: "ambient",
      slug: "ambient-space-scapes",
      title: "Ambient Space Soundscapes — Deep Focus Frequencies",
      channel: soundforge.handle,
      category: "Music",
      views: 2_014_900,
      likes: 143_000,
      dislikes: 620,
      durationSec: 658,
      mp4: MEDIA.ed,
      createdAt: daysAgo(210),
      description: "Long-form ambient textures for deep work sessions.",
    },
    {
      key: "iphone",
      slug: "iphone17-vs-s25",
      title: "iPhone 17 Pro vs Samsung S25 Ultra — The Real Winner",
      channel: codecraft.handle,
      category: "Tech",
      views: 7_730_400,
      likes: 445_000,
      dislikes: 8_800,
      durationSec: 33,
      mp4: MEDIA.peach,
      createdAt: daysAgo(7),
      description: "Cameras, thermals, battery and 3 years of updates — a fair fight, finally.",
    },
    {
      key: "pcbuild",
      slug: "5000-dollar-pc-build",
      title: "Building a $5000 Gaming PC — Ultimate 2026 Guide",
      channel: codecraft.handle,
      category: "Gaming",
      views: 3_901_200,
      likes: 276_000,
      dislikes: 1_900,
      durationSec: 33,
      mp4: MEDIA.peach,
      createdAt: daysAgo(182),
      description: "RTX 6090, 64GB DDR6 and a case that hides cables like a magician.",
    },
    {
      key: "rust",
      slug: "rust-rewrite-backend",
      title: "I Rewrote Our Backend in Rust — Was It Worth It?",
      channel: codecraft.handle,
      category: "Coding",
      views: 1_823_400,
      likes: 141_000,
      dislikes: 720,
      durationSec: 10,
      mp4: MEDIA.sintel10,
      createdAt: daysAgo(20),
      description: "Six months, 40k lines, one blog post everyone argued about. Numbers inside.",
    },
    {
      key: "aiweekly",
      slug: "ai-roundup-weekly",
      title: "Tech Weekly: The AI Roundup — Everything Announced",
      channel: codecraft.handle,
      category: "News",
      views: 2_312_700,
      likes: 158_000,
      dislikes: 1_100,
      durationSec: 10,
      mp4: MEDIA.bbb10,
      createdAt: daysAgo(4),
      description: "All the model drops, the chips, the drama — 47 seconds per item, no fluff.",
    },
    {
      key: "podcast",
      slug: "developer-podcast-412",
      title: "The Developer Podcast — Ep. 412: Shipping Without Fear",
      channel: codecraft.handle,
      category: "Podcasts",
      views: 384_900,
      likes: 31_200,
      dislikes: 140,
      durationSec: 10,
      mp4: MEDIA.jelly1,
      createdAt: daysAgo(5),
      description: "Deploying on Fridays, trunk-based development and the psychology of the green build.",
    },
    {
      key: "live",
      slug: "startup-day-12",
      title: "LIVE: Building a Startup in Public — Day 12",
      channel: codecraft.handle,
      category: "Coding",
      views: 14_208,
      likes: 2_914,
      dislikes: 41,
      durationSec: 47,
      mp4: MEDIA.oceans,
      createdAt: daysAgo(1),
      isLive: true,
      premieredAt: hoursAgo(2),
      description: "Day 12: wiring up payments. Ask anything in live chat.",
    },
    // ---- shorts (vertical) ----
    {
      key: "sh-sintel",
      slug: "sintel-bts",
      title: "Sintel — Behind the Scenes #shorts",
      channel: pixel.handle,
      category: "Education",
      views: 2_904_100,
      likes: 240_000,
      dislikes: 900,
      durationSec: 10,
      mp4: MEDIA.sintel10,
      createdAt: daysAgo(60),
      isShort: true,
    },
    {
      key: "sh-elden",
      slug: "elden-10s-kill",
      title: "Elden Ring — 10-Second Kill #shorts",
      channel: gamevault.handle,
      category: "Gaming",
      views: 8_412_300,
      likes: 705_000,
      dislikes: 2_800,
      durationSec: 10,
      mp4: MEDIA.jelly5,
      createdAt: daysAgo(9),
      isShort: true,
    },
    {
      key: "sh-iceland",
      slug: "iceland-15s",
      title: "Iceland in 15 Seconds #shorts",
      channel: wanderlust.handle,
      category: "Travel",
      views: 5_230_700,
      likes: 431_000,
      dislikes: 1_300,
      durationSec: 10,
      mp4: MEDIA.jelly1,
      createdAt: daysAgo(22),
      isShort: true,
    },
    {
      key: "sh-synth",
      slug: "synthwave-sunset",
      title: "Synthwave Sunset Loop #shorts",
      channel: soundforge.handle,
      category: "Music",
      views: 3_120_400,
      likes: 288_000,
      dislikes: 710,
      durationSec: 10,
      mp4: MEDIA.jelly1,
      createdAt: daysAgo(14),
      isShort: true,
    },
    {
      key: "sh-ts",
      slug: "typescript-satisfies",
      title: "TypeScript Tip: The satisfies Operator #shorts",
      channel: codecraft.handle,
      category: "Coding",
      views: 1_204_800,
      likes: 112_000,
      dislikes: 240,
      durationSec: 10,
      mp4: MEDIA.bbb1080,
      createdAt: daysAgo(4),
      isShort: true,
    },
    {
      key: "sh-bbb",
      slug: "bbb-bloopers",
      title: "Big Buck Bunny — Bloopers #shorts",
      channel: pixel.handle,
      category: "Comedy",
      views: 6_014_200,
      likes: 542_000,
      dislikes: 1_600,
      durationSec: 10,
      mp4: MEDIA.bbb10,
      createdAt: daysAgo(34),
      isShort: true,
    },
  ];

  const channelsByHandle = new Map(
    [pixel, gamevault, wanderlust, soundforge, codecraft].map((c) => [c.handle, c])
  );

  const videos: Record<string, { id: string; durationSec: number }> = {};
  for (const v of V) {
    const created = await db.video.create({
      data: {
        channelId: channelsByHandle.get(v.channel)!.id,
        title: v.title,
        description: v.description ?? "",
        thumbnailUrl: v.isShort
          ? pic(v.slug, 360, 640)
          : pic(v.slug, 640, 360),
        videoUrl: v.mp4,
        durationSec: v.durationSec,
        views: v.views,
        likes: v.likes,
        dislikes: v.dislikes,
        visibility: "public",
        isMembersOnly: v.isMembersOnly ?? false,
        membersTier: v.membersTier ?? null,
        category: v.category,
        isShort: v.isShort ?? false,
        isLive: v.isLive ?? false,
        premieredAt: v.premieredAt ?? null,
        createdAt: v.createdAt,
      },
    });
    videos[v.key] = { id: created.id, durationSec: created.durationSec };
  }

  // ---- memberships ----------------------------------------------------------
  const insider = await db.membershipTier.create({
    data: {
      channelId: pixel.id,
      name: "Studio Insider",
      priceCents: 499,
      perks: "Members-only videos, early access, studio tour livestreams",
    },
  });
  await db.membershipTier.create({
    data: {
      channelId: pixel.id,
      name: "Producer",
      priceCents: 1999,
      perks: "Everything in Insider + name in credits + monthly render review",
    },
  });
  await db.membership.create({
    data: { userId: you.id, tierId: insider.id, since: daysAgo(20) },
  });

  // ---- view events (history + continue watching for the demo user) ----------
  // Ordered by recency; continueWatching = unfinished (>30s, < duration).
  const views: Array<[string, number, Date]> = [
    ["tokyo", 32, daysAgo(1)],      // unfinished → continue watching (most recent)
    ["bbb", 312, daysAgo(5)],       // unfinished → continue watching
    ["sintel", 24, daysAgo(14)],    // unfinished → continue watching
    ["elden", 734, daysAgo(13)],    // finished
    ["gta6", 60, daysAgo(31)],      // finished
    ["elephants", 658, daysAgo(21)],// finished
    ["tears", 734, daysAgo(60)],    // finished
    ["iceland", 594, daysAgo(120)], // finished
    ["hiit", 888, daysAgo(400)],    // finished
    ["sh-elden", 15, daysAgo(9)],   // short (watched)
  ];
  for (const [key, watchedSec, at] of views) {
    await db.viewEvent.create({
      data: { userId: you.id, videoId: videos[key].id, watchedSec, at },
    });
  }

  // ---- likes (the /liked page) -----------------------------------------------
  const likedKeys = ["bbb", "sintel", "iceland", "synthwave", "gta6", "elden", "sh-synth"];
  for (const key of likedKeys) {
    await db.videoLike.create({
      data: { userId: you.id, videoId: videos[key].id, value: "like" },
    });
  }

  // ---- playlists ---------------------------------------------------------------
  const watchLater = await db.playlist.create({
    data: {
      userId: you.id,
      title: "Watch Later",
      visibility: "private",
      isWatchLater: true,
      createdAt: daysAgo(300),
    },
  });
  const blenderPlaylist = await db.playlist.create({
    data: {
      userId: you.id,
      title: "Blender Open Movies",
      visibility: "public",
      createdAt: daysAgo(120),
    },
  });
  const focusPlaylist = await db.playlist.create({
    data: {
      userId: you.id,
      title: "Focus Coding Mix",
      visibility: "private",
      createdAt: daysAgo(80),
    },
  });
  const addTo = (playlistId: string, keys: string[]) =>
    keys.map((key, i) => ({
      playlistId,
      videoId: videos[key].id,
      position: i,
      addedAt: daysAgo(30 - i),
    }));
  await db.playlistItem.createMany({ data: addTo(watchLater.id, ["ambient", "f1", "podcast"]) });
  await db.playlistItem.createMany({
    data: addTo(blenderPlaylist.id, ["bbb", "elephants", "sintel", "tears"]),
  });
  await db.playlistItem.createMany({ data: addTo(focusPlaylist.id, ["synthwave", "ambient"]) });

  // ---- notifications (bell badge for the demo user) ----------------------------
  await db.notification.createMany({
    data: [
      {
        userId: you.id,
        sourceChannelId: codecraft.id,
        kind: "live",
        title: "CodeCraft is live: Building a Startup in Public — Day 12",
        body: "Streaming now — come hang out in live chat.",
        videoId: videos["live"].id,
        read: false,
        createdAt: hoursAgo(2),
      },
      {
        userId: you.id,
        sourceChannelId: pixel.id,
        kind: "video",
        title: "Members Only: Studio Tour & Render Farm Walkthrough",
        body: "Your Studio Insider perk: the full studio tour is up.",
        videoId: videos["members-studio"].id,
        read: false,
        createdAt: daysAgo(2),
      },
      {
        userId: you.id,
        sourceChannelId: gamevault.id,
        kind: "video",
        title: "Elden Ring DLC — Final Boss Fight (No Hit)",
        body: "GameVault uploaded a video you might like.",
        videoId: videos["elden"].id,
        read: false,
        createdAt: daysAgo(13),
      },
      {
        userId: you.id,
        sourceChannelId: gamevault.id,
        kind: "video",
        title: "GTA 6 Gameplay Deep-Dive — Everything We Know",
        body: "GameVault uploaded a video you might like.",
        videoId: videos["gta6"].id,
        read: false,
        createdAt: daysAgo(31),
      },
      {
        userId: you.id,
        sourceChannelId: gamevault.id,
        kind: "video",
        title: "F1 2026 Season Preview — Every Team Ranked",
        body: "GameVault uploaded a video you might like.",
        videoId: videos["f1"].id,
        read: false,
        createdAt: daysAgo(21),
      },
      {
        userId: you.id,
        sourceChannelId: soundforge.id,
        kind: "video",
        title: "Synthwave Mix — 1 Hour Retro Drive",
        body: "Sound Forge uploaded a video you might like.",
        videoId: videos["synthwave"].id,
        read: true,
        createdAt: daysAgo(33),
      },
      {
        userId: you.id,
        sourceChannelId: wanderlust.id,
        kind: "reply",
        title: "mikadev replied to your comment",
        body: "\"Same, the noodle stall at 0:38 is unreal.\"",
        read: true,
        createdAt: daysAgo(40),
      },
    ],
  });

  // ---- comments (a few on the two biggest videos) -------------------------------
  const c1 = await db.comment.create({
    data: {
      videoId: videos["bbb"].id,
      userId: commenter.id,
      body: "The animation on this still holds up in 2026. What an era for open movies.",
      likes: 4200,
      pinned: true,
      heartedByCreator: true,
      moderation: "approved",
      createdAt: daysAgo(90),
    },
  });
  await db.comment.create({
    data: {
      videoId: videos["bbb"].id,
      userId: commenter2.id,
      parentId: c1.id,
      body: "Right? The fur sim alone was groundbreaking.",
      likes: 310,
      moderation: "approved",
      createdAt: daysAgo(89),
    },
  });
  await db.comment.create({
    data: {
      videoId: videos["elden"].id,
      userId: commenter2.id,
      body: "Strategy notes: phase two punish window is after the double sweep — you can see it at 4:12.",
      likes: 8900,
      pinned: true,
      moderation: "approved",
      createdAt: daysAgo(12),
    },
  });
  await db.comment.create({
    data: {
      videoId: videos["elden"].id,
      userId: you.id,
      body: "Watching this made me uninstall out of respect.",
      likes: 1200,
      moderation: "approved",
      createdAt: daysAgo(11),
    },
  });
  await db.commentLike.create({
    data: { userId: you.id, commentId: c1.id, value: "like" },
  });

  // ---- live chat messages (for the live video) -----------------------------------
  await db.liveChatMessage.createMany({
    data: [
      { videoId: videos["live"].id, userId: commenter.id, body: "day 12 already?? insane pace", at: hoursAgo(2) },
      { videoId: videos["live"].id, userId: commenter2.id, body: "are you using stripe or paddle?", at: hoursAgo(1.8) },
      { videoId: videos["live"].id, userId: you.id, body: "wiring payments live is bold", at: hoursAgo(1.5) },
    ],
  });

  const counts = {
    users: await db.user.count(),
    channels: await db.channel.count(),
    videos: await db.video.count(),
    shorts: await db.video.count({ where: { isShort: true } }),
    membersOnly: await db.video.count({ where: { isMembersOnly: true } }),
    live: await db.video.count({ where: { isLive: true } }),
    viewEvents: await db.viewEvent.count(),
    likes: await db.videoLike.count(),
    playlists: await db.playlist.count(),
    notifications: await db.notification.count(),
    unread: await db.notification.count({ where: { read: false } }),
    comments: await db.comment.count(),
  };
  console.log("Seeded webflix2.db:", JSON.stringify(counts, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
