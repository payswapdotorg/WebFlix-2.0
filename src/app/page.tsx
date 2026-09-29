import fs from "node:fs";
import path from "node:path";

function readDoc(rel: string): string {
  try {
    return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
  } catch {
    return "";
  }
}

interface Claim {
  wave: string;
  lane: string;
  lead: string;
  claimed: string;
  status: string;
}

function parseClaims(): Claim[] {
  const md = readDoc("docs/plans/wave-claims.md");
  const rows: Claim[] = [];
  for (const line of md.split("\n")) {
    if (!line.trim().startsWith("|")) continue;
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length < 7) continue;
    if (!/^\d+$/.test(cells[1])) continue;
    rows.push({
      wave: cells[1],
      lane: cells[2],
      lead: cells[3],
      claimed: cells[4],
      status: cells[6] || "",
    });
  }
  return rows;
}

function parseRoadmap(): { title: string; body: string[] }[] {
  const md = readDoc("docs/plans/2026-09-28-webflix2-roadmap.md");
  const sections: { title: string; body: string[] }[] = [];
  let cur: { title: string; body: string[] } | null = null;
  for (const line of md.split("\n")) {
    if (line.startsWith("## ")) {
      if (cur) sections.push(cur);
      cur = { title: line.slice(3).trim(), body: [] };
    } else if (cur && line.trim() && !line.startsWith("|") && !line.startsWith("#")) {
      cur.body.push(line.replace(/^[-*]\s+/, "").trim());
    }
  }
  if (cur) sections.push(cur);
  return sections;
}

const STATUS_STYLE: Record<string, string> = {
  dispatched: "#fb923c",
  "in-flight": "#facc15",
  landed: "#38bdf8",
  merged: "#4ade80",
  verified: "#4ade80",
};

function statusColor(status: string): string {
  const key = Object.keys(STATUS_STYLE).find((k) =>
    status.toLowerCase().includes(k),
  );
  return key ? STATUS_STYLE[key] : "#a1a1aa";
}

export default function StatusPage() {
  const claims = parseClaims();
  const roadmap = parseRoadmap();
  const builtAt = new Date().toISOString().replace("T", " ").slice(0, 16);

  return (
    <main style={{ background: "#0f0f0f", color: "#f5f5f5", minHeight: "100vh", fontFamily: "system-ui, -apple-system, sans-serif", margin: 0, padding: "48px 20px" }}>
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <header style={{ marginBottom: 40 }}>
          <h1 style={{ fontSize: 28, margin: 0, letterSpacing: -0.5 }}>
            <span style={{ color: "#ef4444", fontWeight: 800 }}>WebFlix</span> 2.0
            <span style={{ color: "#a1a1aa", fontWeight: 400 }}> — build in flight</span>
          </h1>
          <p style={{ color: "#a1a1aa", margin: "10px 0 0", fontSize: 14, lineHeight: 1.6 }}>
            A complete YouTube clone. Interface baseline: ZTube · every interface feature cloned
            feature-for-feature from youtube.com, each with a complete backend. This status page is the
            temporary production deploy — it flips to the real app the moment Wave 1 code merges.
          </p>
        </header>

        <section style={{ marginBottom: 40 }}>
          <h2 style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: 1.2, color: "#ef4444", margin: "0 0 12px" }}>
            Wave ledger — live
          </h2>
          <div style={{ border: "1px solid #27272a", borderRadius: 12, overflow: "hidden" }}>
            {claims.length === 0 ? (
              <div style={{ padding: 20, color: "#a1a1aa" }}>No claims yet.</div>
            ) : (
              claims.map((c, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center",
                    justifyContent: "space-between",
                    padding: "14px 18px",
                    borderTop: i === 0 ? "none" : "1px solid #27272a",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 15 }}>Wave {c.wave} · {c.lane}</div>
                    <div style={{ color: "#71717a", fontSize: 12, marginTop: 3 }}>
                      lead {c.lead} · claimed {c.claimed}
                    </div>
                  </div>
                  <div
                    style={{
                      padding: "4px 12px", borderRadius: 999, fontSize: 12, fontWeight: 600,
                      color: statusColor(c.status),
                      background: "rgba(255,255,255,0.06)",
                      border: `1px solid ${statusColor(c.status)}44`,
                    }}
                  >
                    {c.status.toUpperCase()}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section style={{ marginBottom: 40 }}>
          <h2 style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: 1.2, color: "#ef4444", margin: "0 0 12px" }}>
            Roadmap
          </h2>
          <div style={{ display: "grid", gap: 12 }}>
            {roadmap.map((s, i) => (
              <div key={i} style={{ border: "1px solid #27272a", borderRadius: 12, padding: "14px 18px" }}>
                <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>{s.title}</div>
                {s.body.map((b, j) => (
                  <div key={j} style={{ color: "#a1a1aa", fontSize: 13, lineHeight: 1.7 }}>· {b}</div>
                ))}
              </div>
            ))}
          </div>
        </section>

        <footer style={{ color: "#52525b", fontSize: 12, borderTop: "1px solid #27272a", paddingTop: 16, display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "space-between" }}>
          <span>Deployed from branch <code style={{ color: "#a1a1aa" }}>status</code> · built {builtAt} UTC</span>
          <span>repo: payswapdotorg/webflix-2.0</span>
        </footer>
      </div>
    </main>
  );
}
