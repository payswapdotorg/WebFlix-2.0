# M2.3 TERMS / PRIVACY EVIDENCE REVIEW — the public documents read (TL, evidence-only)

Work order: `docs/plans/work-orders/WFX2-TIKTOK-MAIN-INTERFACE-RELIABILITY-1.md` §4 M2 item 3 ("Review Apify General Terms, Actor Terms, the exact community actor's privacy policy/data handling and the TikTok terms/policies applicable to the observed collection. Record evidence and obtain an operator/legal decision.")
Window: 2026-11-09 · Reviewer: TL (Z.ai Code) · Pinned base: `e97d021`
Policy frame: ADR 0014 **D2 stays CLOSED / OPERATOR-GATED** — this document is EVIDENCE FOR the operator's decision, **NOT a decision, NOT a legal opinion**. Every excerpt is a verbatim quote (the documents themselves remain the authority; the operator/legal reader should read the full texts). Zero spend, zero actor runs, zero tokens: all access was read-only public HTTP GETs (the same access class Worker C's §5 recorded and the dispatch allowed).

## 1. Document inventory (all fetched 2026-11-09, all HTTP 200)

| Document | URL | Size |
|---|---|---|
| Status actor storefront (embeds Master ToS v4.0 + the actor-specific Addendum) | `https://apify.com/unseenuser/tiktok-live-status-scraper` | ~710 KB HTML |
| Playback actor storefront (no embedded ToS found — recorded as its own fact) | `https://apify.com/automation-lab/tiktok-live-room-stream-urls` | ~535 KB HTML |
| Apify General Terms and Conditions | `https://docs.apify.com/legal/general-terms-and-conditions` | ~89 KB HTML |
| Apify Acceptable Use Policy | `https://docs.apify.com/legal/acceptable-use-policy` | ~39 KB HTML |
| Actor developer's privacy policy (the status actor's own data-handling doc) | `https://scrapecreators.com/privacy` | ~59 KB HTML |
| TikTok Terms of Service (global, en) — the exact URL the actor ToS §5 itself cites | `https://www.tiktok.com/legal/page/global/terms-of-service/en` | ~812 KB HTML |
| Euler Stream Terms of Service (the TikTok-Live-Connector signing row) | `https://www.eulerstream.com/terms` (via 302 → www) | ~102 KB HTML |

## 2. The UnseenUser Master ToS v4.0 (effective 2026-05-05) + actor Addendum — the binding publisher agreement

### 2.1 The responsibility structure pushes EVERYTHING to the user

> §5 SOURCE PLATFORM TERMS — YOUR RESPONSIBILITY: "You are solely responsible for ensuring your downstream use of data obtained through the Actor complies with the Source Platform's Terms of Service. The Publisher makes no representation that any specific use is permitted under any Source Platform's terms."

> §1: "The Actor is not a scraping tool the Publisher operates, not a data storage service, not affiliated with or endorsed by any source platform, and not a licensed access channel to TikTok or any other source platform."

> §2 warranty: "you will independently comply with the Terms of Service of any source platform whose data you obtain, you will respect data subject rights"

### 2.2 The publisher's OWN disclosure about TikTok

> Addendum §E: "TikTok's Terms of Service prohibit automated extraction. Live stream rebroadcasting is particularly sensitive (multiple overlapping rights)."

The actor's own publisher states the underlying collection is prohibited by TikTok's ToS. This is the single most decision-relevant sentence in the whole review: the D2 question is not "is the actor's collection gray?" — the publisher themselves say the source platform prohibits it.

### 2.3 Prohibitions that touch WebFlix's actual LIVE lane design

> Addendum §D: "you may NOT: **Build TikTok-replacement live-stream players that serve TikTok streams in your own UI without authorization**; Record and rebroadcast live streams without creator authorization; **Build mass-monitoring tools that surveil specific creators' live activity over time without their knowledge**; Use live status data to coordinate mass-DMing or brigading of creators who are currently live; Use stream URLs to bypass TikTok's geo-restrictions or commerce restrictions; Train commercial AI on live-stream content extracted via this Actor"

> Addendum §F (stream URLs — capability, not authorization): "You may use the URLs for real-time viewing in your own monitoring dashboards, status checking, and personal use. You may NOT rebroadcast, record and republish, **aggregate streams into a 'TikTok live stream aggregator' product**, or strip TikTok branding when displaying stream content."

> Addendum §G (real-time surveillance): "Don't use this Actor for surveillance of specific individuals. OK: 'Is creator X live RIGHT NOW so we can engage with their stream?' / OK: Batch checking 50 brand ambassadors … / NOT OK: Logging every time creator X goes live for the last 6 months (surveillance, even if data is public)"

WebFlix-relevance (recorded as FACTS about the product's current shape, NOT as conclusions): WebFlix's LIVE room plays the actor-resolved HLS stream inside WebFlix's own UI (the in-app player), and the LIVE board polls the tracked creator universe on the TTL cadence. Whether that constitutes a "TikTok-replacement live-stream player … without authorization", a "TikTok live stream aggregator product", or permitted "real-time viewing in your own monitoring dashboards" is precisely the judgment the operator/legal reader must make — this review records only that the addendum's own words sit directly on these questions.

### 2.4 Data protection + retention (fills the decision table's previously-"unknown" cells)

> Master ToS §6: "You (the User) are the Data Controller of any personal data you obtain through the Actor … The Publisher acts solely as a software vendor, not as a data controller or processor, because the Publisher does not store, retain, or substantively process personal data."

> Addendum §A (Data Retention): "Requests are made through the Publisher's Scrape Creators account. Scrape Creators has confirmed in writing that full copies of responses linked to that account are designed to expire within 31 days. Scrape Creators also keeps request, usage, security and operational records … Its privacy policy does not set a fixed retention period for these records, and **usage logs may be kept indefinitely** … Scrape Creators does not currently offer automatic deletion on a shorter schedule."

> Addendum §B (nature of data): the actor returns live status, room info, viewer counts, and multi-quality FLV/HLS/CMAF playback URLs; where output includes people's names/photos it is personal data "but only in your hands as the data controller".

WebFlix side (unchanged, already recorded): status cached 30s–1h (production `TIKTOK_LIVE_STATUS_TTL_MS=300000`), offline 300s, playback 120s; no TikTok media bytes stored; signed CDN URLs never persisted.

## 3. The actor developer's privacy policy (Scrape Creators / Web Scraping Guy LLC)

> "04 · API response data: We may store the content returned by API responses. The Service retrieves publicly available information on demand and may retain response data, request metadata, usage logs, and operational data to provide the Service, debug issues, prevent abuse, improve reliability, and support customers."
> "10 · Data retention: We retain account data, usage logs, API response data, and operational data as long as necessary to operate the Service and comply with legal obligations."
> "02 · Usage data: Usage logs may be retained indefinitely."
> "07 · Information sharing: We may share information only with: Payment processors (Stripe) / Analytics providers / Service providers needed to operate the platform / Legal authorities if required by law."

Corroborates the addendum's retention statements from the developer's own side. Note the actor page ALSO links `https://scrapecreators.com/privacy` as its privacy disclosure — the developer identity chain (UnseenUser → Scrape Creators → Web Scraping Guy LLC, "Built in Austin, TX") is now recorded.

## 4. Apify platform terms — the platform does NOT authorize the underlying collection

> General Terms §6.2: "You must use the Services to process only the Customer Data that you are authorized to access and that is in compliance with all applicable laws and regulations."

> Acceptable Use Policy §2.1 (the Prohibited Activities list): the closest clause is "engaging in activities that contravene applicable laws, regulations, or the rights of any third party" — **the AUP contains NO clause authorizing source-platform scraping, and NO clause that would shift TikTok-side compliance away from the user.**

> General Terms §13.x liability cap: "OUR TOTAL AGGREGATE LIABILITY SHALL NOT EXCEED $1,000.00".

Recorded finding: the platform's terms are neutral-infrastructure terms. Work order M2 item 3's warning ("Do not assume Apify's platform terms authorize the actor's underlying source collection") is CONFIRMED by the documents' own text.

## 5. The playback actor (automation-lab) storefront

- Developer: "Automation Lab", Maintained by: Community, total users 6, last modified 2 months ago.
- **No embedded Actor Terms/Addendum found on the storefront page** (searched for the ToS blocks the status actor embeds) — recorded as its own fact: the playback actor currently carries NO publisher-side terms document discoverable on its listing, so the default Apify platform terms + general law govern.
- Storefront pricing shape: "$1.82 / 1,000 results" (corroborating shape only — the P103-measured ~$0.00006/run record stays the cited price datapoint; near-free compute).

## 6. TikTok Terms of Service — the display/copy prohibition (verbatim, 4 occurrences in the document)

> "Use of the TikTok Content or materials on the Services for any purpose not expressly permitted by these Terms is strictly prohibited. Such content may not be downloaded, copied, reproduced, distributed, transmitted, broadcast, **displayed**, sold, licensed or otherwise exploited for any purpose whatsoever without our or, where applicable, our licensors' prior written consent."

On its face this clause reaches the display of TikTok content outside TikTok's own Services without prior written consent — the same display question the actor addendum §D/§F touches. (The Developer-Terms competition/replication clause is separately recorded in ADR 0014 D1 and stands unchanged.)

## 7. Euler Stream (the TikTok-Live-Connector signing row) — materially different publisher stance

> §1.3: "You must not use the Service to carry on any illegal or unauthorized activities (including but not limited to copyright, trademark infringements, or spam of TikTok)." · §1.5: "You may not violate TikTok copyright. You will be banned from the Service if you are reported to have violated TikTok or TikTok creators' copyright."

> §7.3 Permitted use: "…does not restrict you from building an application, dashboard, overlay, report, or other product that incorporates Output and is made available to your customers or end users, provided that (i) Output is presented as part of your product's own functionality and not as raw or substantially raw API access, (ii) your customers cannot query the API directly …, and (iii) you remain solely responsible…"

> §7.2(e) prohibits using the API/Output "to develop, train, market, or operate any product or service that competes with the API or any other Euler Stream service"; freemium tier exists ("Beyond the public free limits, you must enter a valid credit card").

Recorded finding: unlike the UnseenUser addendum, Euler's OWN terms explicitly contemplate WebFlix-shaped integrations (§7.3) — but the underlying TikTok-content question (§6's display prohibition, the D1 product gate) is vendor-independent: no signing vendor can authorize TikTok's content.

## 8. Decision-table cells this review FILLS (previously "unknown")

| Table row | Cell | Was | Now (evidence-backed) |
|---|---|---|---|
| status actor | Privacy / data handling | unknown | Publisher stores nothing substantively (Master ToS §6); responses ride the developer's Scrape Creators account; the developer MAY STORE response content, usage logs may be kept indefinitely (their privacy policy §04/§02); User = data controller for personal data in outputs |
| status actor | Retention (provider side) | unknown | Response copies "designed to expire within 31 days" (addendum §A, developer-confirmed in writing); operational/usage records: NO fixed period, possibly indefinite; no automatic shorter-schedule deletion; per-User deletion requests pass through the Publisher |
| status actor | ToS / policy exposure | unapproved + unverified-terms | UNAPPROVED (D2 closed) + the publisher's own addendum §E admits "TikTok's Terms of Service prohibit automated extraction" + §D/§F prohibitions sit directly on WebFlix's LIVE-player/board design questions |
| playback actor | ToS / policy exposure | unverified-terms | UNAPPROVED (D2 closed) + NO publisher terms discoverable on the listing (platform terms + general law govern) |
| TikTok-Live-Connector | ToS / policy exposure | ToS-gray, unverified | Euler ToS §1.3/§1.5 (TikTok compliance enforced by ban), §7.3 integration-permitting, §7.2(e) no competing products; freemium tier exists; the TikTok-content question remains vendor-independent |
| TikTok-Live-Connector | Price | unknown | Free tier exists (limits unknown to this review); paid tiers exist behind credit card — exact per-event pricing not extracted (rate limits "subject to change without notice") |

## 9. What this review does NOT do

1. **No legal decision, no D2 change**: D2 stays CLOSED/OPERATOR-GATED; no actor runs were launched or retried; the lane's circuit-open honest state is untouched.
2. **No legality conclusion**: the WebFlix-relevance notes in §2.3 record WHERE the publishers' own words touch the product's shape; judging them is the operator/legal reader's job (the work order's exact division: "Record evidence and obtain an operator/legal decision").
3. **No full-document replacement**: quotes are verbatim but partial; the linked documents remain the authority.
4. **No claim about TikTok's enforcement behavior** beyond what the documents themselves say.

## 10. The operator's decision packet is now materially stronger

The D2 chooser (keep closed vs approve a provider) can now weigh:
- the publisher's own admission that TikTok's ToS prohibits the collection (§2.2) — the strongest single fact;
- the addendum's §D/§F/§G prohibitions measured against WebFlix's actual room/board design (§2.3);
- the data-handling/retention reality (31-day response copies, possibly-indefinite usage logs) against ADR 0014 D5's provenance/retention principles (§2.4, §3);
- the vendor-independent nature of the TikTok-content question (§6, §7);
- the economics already measured (P103: ~$0.0042/handle, $5/month free credit, cycle ends 2026-12-06; storefront shapes $4.00/1,000 and $1.82/1,000).

Interim product-side facts unchanged: the honest 503 sentences stand (the lane answers "WebFlix's live provider has used up its monthly free quota…"), the TTL knob (`TIKTOK_LIVE_STATUS_TTL_MS=300000`, production-only) is set, the money gate stays CLOSED.
