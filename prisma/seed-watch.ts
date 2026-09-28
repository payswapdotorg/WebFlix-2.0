/**
 * WFX2-W seed — watch vertical domain.
 *
 * Seeds 3 channels, 13 REAL playable videos, a demo viewer + commenter
 * users, memberships, comments (pinned / hearted / member badge / 2-level
 * reply thread with a 3rd level for the "N replies" expander), transcript
 * cues with honest per-film content, playlists, and view/like state.
 *
 * VIDEO SOURCES — honest note: the task's gtv-videos-bucket
 * (commondatastorage.googleapis.com/gtv-videos-bucket/sample) is now
 * bucket-ACL-locked (403 AccessDenied for anonymous callers, verified on
 * both endpoints). The seed therefore uses VERIFIED-PLAYABLE public
 * sources with real matching content:
 *   - media.w3.org              → full Big Buck Bunny (596s, matches the film)
 *   - download.blender.org      → full Elephants Dream (658s), the official
 *                                 Sintel + BBB trailers, the 2013/2015 reels
 *   - vjs.zencdn.net            → Oceans clip (46s)
 *   - mdn.github.io             → flower.mp4 (5s)
 *   - test-videos.co.uk         → 10s reference clips (BBB/Sintel/Jellyfish)
 * Durations, titles, descriptions, chapters and transcripts below match the
 * ACTUAL media. Substitution table: evidence/wfx2w/SCHEMA-MERGE.md.
 *
 * Run: bun prisma/seed-watch.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const thumb = (slug: string) => `https://picsum.photos/seed/${slug}/640/360`;
const avatar = (slug: string) => `https://picsum.photos/seed/${slug}-avatar/88/88`;

const DAY = 86_400_000;
const HOUR = 3_600_000;
const MIN = 60_000;
const now = () => new Date();
const ago = (days: number) => new Date(Date.now() - days * DAY);

// ---------------------------------------------------------------------------
// Channel + user fixtures
// ---------------------------------------------------------------------------

const channels = [
  {
    handle: "blenderstudio",
    name: "Blender Studio",
    avatarUrl: avatar("blender"),
    subscriberCount: 1_254_000,
    verified: true,
  },
  {
    handle: "wildfocus",
    name: "Wild Focus",
    avatarUrl: avatar("wildfocus"),
    subscriberCount: 486_300,
    verified: false,
  },
  {
    handle: "cliplab",
    name: "Clip Lab",
    avatarUrl: avatar("cliplab"),
    subscriberCount: 132_800,
    verified: true,
  },
];

const users = [
  { handle: "demo", name: "Demo Viewer", avatarUrl: avatar("demo") },
  { handle: "pip", name: "Pip Wendergrass", avatarUrl: avatar("pip") },
  { handle: "sintelfan", name: "Sintel Fan", avatarUrl: avatar("sintelfan") },
  { handle: "mocapmike", name: "Mocap Mike", avatarUrl: avatar("mocapmike") },
  { handle: "critic99", name: "Critic 99", avatarUrl: avatar("critic99") },
  { handle: "gwenwatches", name: "Gwen Watches", avatarUrl: avatar("gwen") },
  // channel owner identities (creator comments, heart/pin permissions)
  { handle: "blenderstudio", name: "Blender Studio", avatarUrl: avatar("blender") },
  { handle: "wildfocus", name: "Wild Focus", avatarUrl: avatar("wildfocus") },
  { handle: "cliplab", name: "Clip Lab", avatarUrl: avatar("cliplab") },
];

// ---------------------------------------------------------------------------
// Videos (13 — real playable mp4s; BBB is the primary demo video)
// ---------------------------------------------------------------------------

type VideoSeed = {
  slug: string;
  channel: string;
  title: string;
  description: string;
  videoUrl: string;
  durationSec: number;
  views: number;
  likes: number;
  dislikes: number;
  category: string;
  createdAt: Date;
  transcript: [number, number, string][];
};

const videos: VideoSeed[] = [
  {
    slug: "bigbuckbunny",
    channel: "blenderstudio",
    title: "Big Buck Bunny — Blender Open Movie (Full HD)",
    description:
      "Watch the classic open movie from the Blender Foundation!\n\nA giant rabbit wakes to a beautiful morning in the forest — until three ruthless rodents decide to make his life miserable. Big Buck Bunny plans a gentle, cartoon-style revenge.\n\nWinner of the jury award at the 2008 Animayo festival. Made entirely with free and open source software.\n\n0:00 Intro\n0:52 A peaceful morning\n1:36 The rodent gang\n3:04 Bullying the butterfly\n4:12 Plotting revenge\n5:03 The flying squirrel lesson\n6:40 Justice\n8:20 Credits\n\n#bigbuckbunny #b3d #animation #openmovie",
    durationSec: 596,
    views: 12_845_219,
    likes: 289_305,
    dislikes: 2_141,
    category: "Film & Animation",
    createdAt: ago(470),
    videoUrl: "https://media.w3.org/2010/05/bunny/movie.mp4",
    transcript: [
      [0, 6, "[birds chirping] A sunny morning in the forest"],
      [6, 16, "Big Buck Bunny stretches and wakes up in his burrow"],
      [16, 30, "The giant rabbit steps out into the golden meadow"],
      [30, 52, "Frank, Rinky and Gamera — the rodent gang — watch from the log"],
      [52, 75, "A butterfly lands softly on the bunny's nose"],
      [75, 96, "The rodents throw acorns and laugh at the big rabbit"],
      [96, 132, "They bully the butterfly and the smaller creatures"],
      [132, 184, "Big Buck Bunny decides this ends today — he plots his revenge"],
      [184, 252, "He builds traps from branches and sticky sap"],
      [252, 303, "Gamera the flying squirrel gets launched into the sky"],
      [303, 380, "The rodents flee through the forest, tripping every trap"],
      [380, 460, "Justice is served — the bunny walks away satisfied"],
      [460, 540, "The forest is peaceful again, butterflies everywhere"],
      [540, 596, "Credits — made with Blender, rendered in the Peach open movie project"],
    ],
  },
  {
    slug: "elephantsdream",
    channel: "blenderstudio",
    title: "Elephants Dream — The First Blender Open Movie (Full)",
    description:
      "The world's first open movie, made entirely with open source software.\n\nProog and Emo travel through a gigantic, surreal machine world.\n\n0:00 The machine wakes\n1:15 Proog leads the way\n3:40 The hall of telephones\n6:02 Emo starts to doubt\n8:44 The void\n10:10 Reality breaks\n\n#elephantsdream #blender #surreal #openmovie",
    durationSec: 658,
    views: 8_412_975,
    likes: 112_804,
    dislikes: 1_852,
    category: "Film & Animation",
    createdAt: ago(720),
    videoUrl: "https://download.blender.org/ED/elephantsdream-720-h264-st-aac.mov",
    transcript: [
      [0, 10, "A vast mechanical world grinds to life"],
      [10, 45, "Proog, the elder guide, invites Emo into the machine"],
      [45, 95, "They walk through corridors of moving cables"],
      [95, 190, "The hall of telephones rings around them"],
      [190, 280, "Proog explains the purpose of the machine"],
      [280, 360, "Emo laughs — he sees nothing special here"],
      [360, 440, "A chasm opens; the floor becomes a moving mouth"],
      [440, 520, "Emo doubts the machine even exists"],
      [520, 590, "The void swallows the corridor whole"],
      [590, 658, "Proog snaps — reality breaks apart around them"],
    ],
  },
  {
    slug: "sintel",
    channel: "blenderstudio",
    title: "Sintel — Official Trailer (Blender Open Movie)",
    description:
      "The official trailer for Sintel, the third Blender open movie.\n\nA lonely girl, a wounded baby dragon, and a search that spans years. The full short film is free to watch — but be warned: the ending hits hard.\n\n0:00 The frozen search\n0:12 Scales, the wounded hatchling\n0:28 The quest begins\n0:40 The dragon's den\n0:48 Sintel — the film\n\n#sintel #blender #dragons #trailer",
    durationSec: 52,
    views: 15_320_488,
    likes: 341_772,
    dislikes: 2_930,
    category: "Film & Animation",
    createdAt: ago(380),
    videoUrl: "https://download.blender.org/durian/trailer/sintel_trailer-720p.mp4",
    transcript: [
      [0, 4, "A frozen wasteland; a lone figure crosses the ice"],
      [4, 12, "Sintel searches, exhausted, through the snow"],
      [12, 20, "A wounded baby dragon in an abandoned cage"],
      [20, 28, "Scales grows — the two become inseparable"],
      [28, 36, "Adult dragons descend and carry Scales away"],
      [36, 40, "The quest: mountains, deserts, years"],
      [40, 44, "A giant dragon guards the den — the duel"],
      [44, 48, "Blade drawn, sorrow on her face"],
      [48, 52, "Title card — Sintel, the third open movie"],
    ],
  },
  {
    slug: "bbbtrailer",
    channel: "blenderstudio",
    title: "Big Buck Bunny — Official Trailer",
    description: "The original teaser for the Peach open movie project. One bunny, three rodents, zero mercy.\n\n#bigbuckbunny #trailer #blender",
    durationSec: 33,
    views: 4_105_377,
    likes: 48_211,
    dislikes: 612,
    category: "Film & Animation",
    createdAt: ago(610),
    videoUrl: "https://download.blender.org/peach/trailer/trailer_iphone.m4v",
    transcript: [
      [0, 6, "A peaceful meadow — then something rustles"],
      [6, 12, "Big Buck Bunny turns around slowly"],
      [12, 18, "The rodent gang smirks from the branch"],
      [18, 24, "The bunny cracks a very un-rabbit-like grin"],
      [24, 33, "Title: Big Buck Bunny — coming to a forest near you"],
    ],
  },
  {
    slug: "showreel2013",
    channel: "blenderstudio",
    title: "Blender Studio Showreel 2013",
    description:
      "The 2013 showreel — a montage of open movie shots, rigs and demos from the Blender Foundation.\n\n#blender #showreel #cgianimation",
    durationSec: 200,
    views: 2_634_920,
    likes: 36_144,
    dislikes: 421,
    category: "Film & Animation",
    createdAt: ago(340),
    videoUrl: "https://download.blender.org/demo/movies/Blender_reel_2013.mov",
    transcript: [
      [0, 15, "The reel opens with open movie hero shots"],
      [15, 45, "Character rigs in motion — walk cycles and poses"],
      [45, 80, "Environment shots: forests, cities, machine worlds"],
      [80, 110, "Sculpting and modeling demos fly past"],
      [110, 140, "Fur, hair and cloth simulations"],
      [140, 170, "Lighting and render passes layered up"],
      [170, 200, "Finale montage — the Blender logo"],
    ],
  },
  {
    slug: "cyclesreel2015",
    channel: "blenderstudio",
    title: "Cycles Renderer — Demo Reel 2015",
    description: "What the Cycles render engine could do in 2015: caustics, subsurface scattering, volumetrics.\n\n#cycles #blender #rendering",
    durationSec: 85,
    views: 1_842_066,
    likes: 24_930,
    dislikes: 301,
    category: "Film & Animation",
    createdAt: ago(290),
    videoUrl: "https://download.blender.org/demo/movies/Cycles_Demoreel_2015.mov",
    transcript: [
      [0, 10, "Cycles title — the 2015 demo reel begins"],
      [10, 30, "Glass and caustics: light bends through bottles"],
      [30, 50, "Subsurface scattering on skin and wax"],
      [50, 70, "Volumetric light through fog and rooms"],
      [70, 85, "Final montage of community renders"],
    ],
  },
  {
    slug: "oceans",
    channel: "wildfocus",
    title: "Deep Blue — Ocean Life Short Clip",
    description:
      "A 46-second dive into the deep blue. Schooling fish, light rays, silence.\n\nShot as a reference clip for player demos everywhere.\n\n#ocean #nature #underwater #wildlife",
    durationSec: 47,
    views: 3_512_440,
    likes: 41_205,
    dislikes: 402,
    category: "Pets & Animals",
    createdAt: ago(180),
    videoUrl: "https://vjs.zencdn.net/v/oceans.mp4",
    transcript: [
      [0, 6, "The surface fades to deep blue"],
      [6, 14, "Light rays cut through the water column"],
      [14, 22, "A school of fish turns as one"],
      [22, 30, "Slow drift over a coral shelf"],
      [30, 38, "Something large passes at the edge of the light"],
      [38, 47, "Back toward the surface, bubbles rising"],
    ],
  },
  {
    slug: "jellyfish",
    channel: "wildfocus",
    title: "Jellyfish Drift — 10 Seconds of Calm",
    description: "A jellyfish drifting in dark water. The internet's favorite stress reliever.\n\n#jellyfish #ocean #calm #nature",
    durationSec: 10,
    views: 987_612,
    likes: 12_044,
    dislikes: 98,
    category: "Pets & Animals",
    createdAt: ago(140),
    videoUrl: "https://test-videos.co.uk/vids/jellyfish/mp4/h264/720/Jellyfish_720_10s_1MB.mp4",
    transcript: [
      [0, 3, "A jellyfish pulses slowly out of the dark"],
      [3, 7, "Tentacles trail behind like ribbons"],
      [7, 10, "It folds and drifts away"],
    ],
  },
  {
    slug: "jellyfishhd",
    channel: "wildfocus",
    title: "Jellyfish Drift — High Bitrate Version",
    description: "The same jellyfish, encoded at a higher bitrate. For when you want to see every tentacle.\n\n#jellyfish #encoding #nature",
    durationSec: 10,
    views: 218_933,
    likes: 3_402,
    dislikes: 51,
    category: "Pets & Animals",
    createdAt: ago(135),
    videoUrl: "https://test-videos.co.uk/vids/jellyfish/mp4/h264/720/Jellyfish_720_10s_5MB.mp4",
    transcript: [
      [0, 3, "The jellyfish returns, in higher fidelity"],
      [3, 7, "Every detail of the bell visible now"],
      [7, 10, "It sinks back into the blue"],
    ],
  },
  {
    slug: "flower",
    channel: "wildfocus",
    title: "Flower Bloom — Timelapse",
    description: "Five seconds of a flower opening. That's it. That's the video.\n\n#flower #timelapse #nature #shorts",
    durationSec: 5,
    views: 1_204_551,
    likes: 18_233,
    dislikes: 143,
    category: "Pets & Animals",
    createdAt: ago(96),
    videoUrl: "https://mdn.github.io/shared-assets/videos/flower.mp4",
    transcript: [
      [0, 2, "A closed bud in soft focus"],
      [2, 5, "Petals unfold in timelapse"],
    ],
  },
  {
    slug: "bbbclip720",
    channel: "cliplab",
    title: "Big Buck Bunny — 10s Test Clip (720p)",
    description:
      "The standard 10-second Big Buck Bunny clip used to test video pipelines everywhere. If your player can't handle this, something is wrong.\n\n#testclip #codec #video #bigbuckbunny",
    durationSec: 10,
    views: 2_104_377,
    likes: 24_811,
    dislikes: 402,
    category: "Science & Technology",
    createdAt: ago(220),
    videoUrl: "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/720/Big_Buck_Bunny_720_10s_5MB.mp4",
    transcript: [
      [0, 3, "The bunny surveys the meadow"],
      [3, 7, "The rodents sneer from the log"],
      [7, 10, "The bunny's ears perk — trouble incoming"],
    ],
  },
  {
    slug: "bbbclip1080",
    channel: "cliplab",
    title: "Big Buck Bunny — 10s Test Clip (1080p)",
    description: "The same 10-second clip at 1080p. Compare against the 720p upload to check your scaling.\n\n#testclip #codec #1080p",
    durationSec: 10,
    views: 1_591_847,
    likes: 16_402,
    dislikes: 275,
    category: "Science & Technology",
    createdAt: ago(215),
    videoUrl: "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/1080/Big_Buck_Bunny_1080_10s_5MB.mp4",
    transcript: [
      [0, 3, "Same meadow, more pixels"],
      [3, 7, "The rodents in glorious detail"],
      [7, 10, "Still up to no good"],
    ],
  },
  {
    slug: "sintelclip",
    channel: "cliplab",
    title: "Sintel — 10s Test Clip (360p)",
    description: "Ten seconds of Sintel for player testing. The baby dragon makes an appearance.\n\n#testclip #codec #sintel",
    durationSec: 10,
    views: 455_103,
    likes: 9_112,
    dislikes: 187,
    category: "Science & Technology",
    createdAt: ago(90),
    videoUrl: "https://test-videos.co.uk/vids/sintel/mp4/h264/360/Sintel_360_10s_1MB.mp4",
    transcript: [
      [0, 3, "Snow, wind, and a searching figure"],
      [3, 7, "The baby dragon lifts its head"],
      [7, 10, "They share a quiet moment"],
    ],
  },
];

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

type CommentSeed = {
  video: string;
  author: string;
  body: string;
  likes: number;
  pinned?: boolean;
  hearted?: boolean;
  minutesAgo: number;
  replies?: CommentSeed[];
};

const comments: CommentSeed[] = [
  {
    video: "bigbuckbunny",
    author: "blenderstudio",
    body: "Welcome to the official Big Buck Bunny upload! Fun fact: the entire film was made by a team of 7 artists in 6 months using only free and open source tools. What's your favorite scene?",
    likes: 4821,
    pinned: true,
    minutesAgo: 60 * 24 * 470,
    replies: [
      {
        video: "bigbuckbunny",
        author: "sintelfan",
        body: "The flying squirrel launch never gets old. I've watched this at least 30 times.",
        likes: 412,
        minutesAgo: 60 * 24 * 469,
        replies: [
          {
            video: "bigbuckbunny",
            author: "blenderstudio",
            body: "Fun fact: that shot took 3 weeks to get right — the fur simulation kept exploding!",
            likes: 87,
            minutesAgo: 60 * 24 * 468,
          },
          {
            video: "bigbuckbunny",
            author: "mocapmike",
            body: "The fur sim on the rodents holds up so well even today.",
            likes: 21,
            minutesAgo: 60 * 24 * 467,
          },
        ],
      },
      {
        video: "bigbuckbunny",
        author: "critic99",
        body: "Hard to believe this came out in 2008. The lighting still looks better than some streaming shows.",
        likes: 156,
        minutesAgo: 60 * 24 * 465,
      },
    ],
  },
  {
    video: "bigbuckbunny",
    author: "pip",
    body: "I show this to every animation student on day one. Pure charm, zero dialogue, perfect timing. The part where the butterfly lands on his nose is a masterclass in silent storytelling. If you're learning animation, study the squash-and-stretch on the rodents at 1:36 — it's textbook. Also watch how the camera never overshoots; every cut is motivated by the characters' eyes, not by the edit. This is what open source artistry looks like at its best, and it's free for everyone, forever, which is honestly the most punk rock thing about it.",
    likes: 2044,
    hearted: true,
    minutesAgo: 60 * 24 * 200,
    replies: [
      {
        video: "bigbuckbunny",
        author: "mocapmike",
        body: "The tangent at 1:36 is exactly where I paused it for my class last week.",
        likes: 45,
        minutesAgo: 60 * 24 * 195,
      },
    ],
  },
  {
    video: "bigbuckbunny",
    author: "demo",
    body: "The revenge traps sequence is the best 90 seconds of animation on the internet.",
    likes: 89,
    minutesAgo: 60 * 24 * 30,
    replies: [
      {
        video: "bigbuckbunny",
        author: "sintelfan",
        body: "Agreed! The branch-sap trap especially.",
        likes: 12,
        minutesAgo: 60 * 24 * 29,
      },
    ],
  },
  {
    video: "bigbuckbunny",
    author: "gwenwatches",
    body: "Came for the bunnies, stayed for the justice. No regrets.",
    likes: 3,
    minutesAgo: 60 * 7,
  },
  {
    video: "bigbuckbunny",
    author: "critic99",
    body: "Genuinely one of the most important short films of the internet era. The Peach project proved open pipelines could ship cinema-grade work, and the production files were released so anyone could take the scenes apart and learn from them. That decision alone trained an entire generation of artists.",
    likes: 331,
    minutesAgo: 60 * 24 * 120,
    replies: [
      {
        video: "bigbuckbunny",
        author: "pip",
        body: "The production files are still downloadable from the Blender cloud — go take them apart!",
        likes: 54,
        minutesAgo: 60 * 24 * 118,
      },
      {
        video: "bigbuckbunny",
        author: "sintelfan",
        body: "Doing exactly that for my thesis right now.",
        likes: 9,
        minutesAgo: 60 * 24 * 110,
      },
    ],
  },
  {
    video: "sintel",
    author: "blenderstudio",
    body: "Fair warning: the ending of the full film hits hard. You've been told. The complete short is free on this channel.",
    likes: 2101,
    pinned: true,
    minutesAgo: 60 * 24 * 380,
  },
  {
    video: "sintel",
    author: "sintelfan",
    body: "I watched the full film when it premiered and I still can't watch the last two minutes. That final shot with the scar... devastating.",
    likes: 1834,
    hearted: true,
    minutesAgo: 60 * 24 * 375,
    replies: [
      {
        video: "sintel",
        author: "demo",
        body: "The music does so much heavy lifting in that scene.",
        likes: 77,
        minutesAgo: 60 * 24 * 370,
      },
    ],
  },
  {
    video: "sintel",
    author: "mocapmike",
    body: "The animators said the dragon fight was the hardest sequence they ever blocked. You can feel every frame of that effort.",
    likes: 289,
    minutesAgo: 60 * 24 * 300,
  },
  {
    video: "elephantsdream",
    author: "pip",
    body: "The first open movie ever. The machine world design is still one of the most unsettling environments in animation.",
    likes: 422,
    hearted: true,
    minutesAgo: 60 * 24 * 600,
    replies: [
      {
        video: "elephantsdream",
        author: "critic99",
        body: "The hall of telephones still shows up in my dreams.",
        likes: 31,
        minutesAgo: 60 * 24 * 595,
      },
    ],
  },
  {
    video: "bbbtrailer",
    author: "gwenwatches",
    body: "The grin at 0:12 tells you everything you need to know about this movie.",
    likes: 64,
    minutesAgo: 60 * 24 * 400,
  },
  {
    video: "showreel2013",
    author: "mocapmike",
    body: "This reel still holds up. The rig demos in the middle are required viewing for anyone starting out.",
    likes: 112,
    minutesAgo: 60 * 24 * 210,
    replies: [
      {
        video: "showreel2013",
        author: "blenderstudio",
        body: "The rigs from that reel are still available — go download them!",
        likes: 19,
        minutesAgo: 60 * 24 * 205,
      },
    ],
  },
  {
    video: "cyclesreel2015",
    author: "pip",
    body: "2015 and the glass caustics already looked this good? Wild.",
    likes: 48,
    minutesAgo: 60 * 24 * 160,
  },
  {
    video: "oceans",
    author: "demo",
    body: "That deep blue at 0:30 is stunning. Perfect demo clip too — plays everywhere.",
    likes: 15,
    minutesAgo: 60 * 24 * 100,
  },
  {
    video: "jellyfish",
    author: "gwenwatches",
    body: "Watched this on loop for ten minutes. Zero regrets.",
    likes: 34,
    minutesAgo: 60 * 24 * 55,
    replies: [
      {
        video: "jellyfish",
        author: "wildfocus",
        body: "This is exactly what this channel is for.",
        likes: 8,
        minutesAgo: 60 * 24 * 54,
      },
    ],
  },
  {
    video: "bbbclip720",
    author: "demo",
    body: "The classic test clip. These little reference videos are weirdly iconic — half the internet's video players were debugged on this exact footage.",
    likes: 15,
    minutesAgo: 60 * 24 * 100,
  },
  {
    video: "sintelclip",
    author: "sintelfan",
    body: "Even at 360p and ten seconds, the baby dragon gets me.",
    likes: 22,
    minutesAgo: 60 * 24 * 45,
  },
];

// Viewer's existing engagement state (demo user):
// - likes BigBuckBunny (a VideoLike row that the aggregate already includes)
// - is subscribed to blenderstudio
// - has partial watch progress on sintel (resume demo)

export async function seedWatch(prisma: PrismaClient) {
  console.log("Seeding WFX2-W watch domain…");

  // wipe (idempotent reseeds)
  await prisma.playlistItem.deleteMany();
  await prisma.playlist.deleteMany();
  await prisma.videoReport.deleteMany();
  await prisma.videoSignal.deleteMany();
  await prisma.transcriptCue.deleteMany();
  await prisma.commentLike.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.videoLike.deleteMany();
  await prisma.viewEvent.deleteMany();
  await prisma.subscription.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.video.deleteMany();
  await prisma.user.deleteMany();
  await prisma.channel.deleteMany();

  const userIds: Record<string, string> = {};
  for (const u of users) {
    const created = await prisma.user.create({ data: { ...u } });
    userIds[u.handle] = created.id;
  }
  console.log(`  users: ${users.length}`);

  const channelIds: Record<string, string> = {};
  for (const c of channels) {
    const created = await prisma.channel.create({
      data: { ...c, ownerUserId: userIds[c.handle] },
    });
    channelIds[c.handle] = created.id;
  }
  console.log(`  channels: ${channels.length}`);

  // Pip is a channel member of Blender Studio (member badge variant)
  await prisma.membership.create({
    data: { channelId: channelIds["blenderstudio"], userId: userIds["pip"], level: 2 },
  });

  const videoIds: Record<string, string> = {};
  for (const v of videos) {
    const created = await prisma.video.create({
      data: {
        channelId: channelIds[v.channel],
        title: v.title,
        description: v.description,
        videoUrl: v.videoUrl,

        thumbnailUrl: thumb(v.slug),
        durationSec: v.durationSec,
        views: v.views,
        likes: v.likes,
        dislikes: v.dislikes,
        visibility: "public",
        category: v.category,
        createdAt: v.createdAt,
      },
    });
    videoIds[v.slug] = created.id;

    await prisma.transcriptCue.createMany({
      data: v.transcript.map(([startSec, endSec, text]) => ({
        videoId: created.id,
        startSec,
        endSec,
        text,
      })),
    });
  }
  console.log(`  videos: ${videos.length} (+ transcript cues)`);

  // comments + nested replies
  let commentCount = 0;
  async function insertComments(list: CommentSeed[], parentId?: string) {
    for (const c of list) {
      const created = await prisma.comment.create({
        data: {
          videoId: videoIds[c.video],
          parentId: parentId ?? null,
          userId: userIds[c.author],
          body: c.body,
          likes: c.likes,
          pinned: c.pinned ?? false,
          heartedByCreator: c.hearted ?? false,
          moderation: "approved",
          createdAt: new Date(Date.now() - c.minutesAgo * MIN),
        },
      });
      commentCount++;
      if (c.replies?.length) await insertComments(c.replies, created.id);
    }
  }
  await insertComments(comments);
  console.log(`  comments: ${commentCount}`);

  // demo viewer state
  await prisma.videoLike.create({
    data: { videoId: videoIds["bigbuckbunny"], userId: userIds["demo"], value: "like" },
  });
  await prisma.subscription.create({
    data: { channelId: channelIds["blenderstudio"], userId: userIds["demo"], bell: "all" },
  });
  // partial watch progress on the Sintel trailer (the resume-on-load demo —
  // 24s into a 52s trailer)
  await prisma.viewEvent.create({
    data: {
      videoId: videoIds["sintel"],
      userId: userIds["demo"],
      watchedSec: 24,
      lastPositionSec: 24,
      at: new Date(Date.now() - 2 * HOUR),
    },
  });
  // and an old view event for BBB (the hour-dedupe demo: first page view still
  // counts as a fresh view)
  await prisma.viewEvent.create({
    data: {
      videoId: videoIds["bigbuckbunny"],
      userId: userIds["demo"],
      watchedSec: 596,
      lastPositionSec: 596,
      at: new Date(Date.now() - 30 * DAY),
    },
  });
  // demo user's playlists for the Save dialog
  const wl = await prisma.playlist.create({
    data: { userId: userIds["demo"], name: "Watch later", isWatchLater: true, visibility: "private" },
  });
  await prisma.playlist.create({
    data: { userId: userIds["demo"], name: "Blender classics", isWatchLater: false, visibility: "public" },
  });
  await prisma.playlistItem.create({
    data: { playlistId: wl.id, videoId: videoIds["elephantsdream"] },
  });

  console.log("Done. Demo viewer: @demo (fixed demo identity — see src/lib/watch/session.ts)");
}

if (import.meta.main) {
  seedWatch(prisma)
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
