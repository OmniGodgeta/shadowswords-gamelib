# RetroVerse feature backlog

**Status 2026-09-11 late:** the layout agent has finished and is gone; the
netplay agent now owns all remaining work. Netplay internals are `NP`, `np*()`,
`handlePingReply`, `acceptInvite`, `/np/*`, `/play/invite*`.

## Done (netplay agent)

1. ✅ **Voice chat** (2.22.17) — mic on the same `RTCPeerConnection`, 🎙 toggle in
   the sheet, `npVoice` pref, `#np-remote-audio` playback, renegotiation via
   `onnegotiationneeded`. The `#np-video` element is video-only now; game audio +
   voices share the audio element.
2. ✅ **Live RTT / persistent status** (2.22.17 + 2.22.12) — 2 s datachannel
   ping/pong shown in the `#np-live` badge and Diagnostic line; link state is a
   badge, not a 5 s toast.
3. ✅ **Host-authoritative video** (2.22.9) — supersedes the old input-echo drift
   fix. `NP.video` path streams canvas + game audio to the guest.
4. ✅ **Role-aware auto-reconnect** (2.22.18) — host persists `ssw:hostNp` and
   re-hosts the same room (server `reuse`); guest re-joins on link loss; explicit
   exit clears it, reload does not.
5. ✅ **"Both ready" gate** (2.22.18) — `{t:"ready"}` handshake, `✓ ready` in the
   badge, both-ready toast.
6. ✅ **Push-to-talk / mic mute** (2.22.19) — `npPTT` pref, floating `#np-ptt`
   (hold-to-talk or tap-to-mute), `MediaStreamTrack.enabled` mute.
7. ✅ **Watch-party WebRTC transport** (2.22.19) — `WNP`: host streams canvas +
   game audio over a signaling room; watcher plays it. JPEG stream kept as
   fallback.

## Superseded / will likely not do

- **Rollback / input-delay netcode** — was item 2. With host-authoritative video
  the guest renders the host's screen, so there is no drift to roll back. Only
  revisit if a future mode runs two cores again (then use
  `gameManager.getFrameNum()` + `Module.postMainLoop`).

## Remaining (netplay agent)

1. **Native push invite — code done (2.22.20), needs an APK build.** Site posts
   `{cid,origin,on}` to the app's `SSNotify`; `MainActivity` polls
   `/play/invites` while backgrounded and deep-links back. Build/test the APK;
   Android 13+ needs the `POST_NOTIFICATIONS` grant.
2. **Push-to-talk — done (2.22.19).**
3. Longer term: invite history, spectator→player promote, TURN relay on `shadow`
   if remote peers ever fail to connect.

## UI pass (2026-09-12, "netplay agent")

Done in 2.22.21, all in `docs/assets` + `build.py`:

- Transparent, larger logo; header icons (menu/search/profile) 2× and matching
  SVGs; `--bar-h` 68 px.
- `build.py` strips the white background from `media/consoles/*.webp`
  (`strip_light_bg`) so console tiles aren't white-boxed.
- Mobile now-playing chip no longer overlaps the Preview/Box-art toggle;
  [View game] centred, next at the right.

Left to do (not started): true box-art for art-less **games** is the existing
generated sleeve (`coverArt` → `.tile-art.noart`) — could be upgraded to a
per-game procedural cover if it still looks flat.

## Follow-up UI batch (2026-09-12)

- The Play landing page now has the curated popular-games backdrop; home has
  Movies and Music shelves; and desktop has a secondary left rail.
- Lounge chat is a deliberately small shared `/chat` feed, including the
  floating party-chat window. Do not add another transport for that feature.
- Tile-art badges are gone. Art-less sports games use the themed generated
  sleeves. In the in-app player, the floating pad control remains the one
  place to hide/show the touch pad; the duplicate top-menu Pad/Portrait items
  were removed and games explicitly enter landscape.

## Do not

- Re-enable Tailscale Funnel (§4) or EmulatorJS `:8712` lockstep (§12).
- Empty `NETPLAY_ICE` — host-only ICE cannot cross the tailnet (mDNS). See
  `NETPLAY-UI-CONTRACT.md`.
- Break the `#np-video` stacking (touch pad must stay above it) or the
  `<details>` Diagnostics in the netplay sheet.

## Planned 2026-09-13 — owner's priorities

Owner decisions: **party calls = native Android** (survives app close, OS
floating bubble); **RetroAchievements = web login now + cheevos unlocks after**;
**graphics = per-console options**.

### A. Party calls (Discord-like) — started
- ✅ Server party room on `arcade-server.mjs`: `/party` (create/join),
  `/party/ping`, `/party/leave`, `/party/sig` (directed/broadcast). Members have
  a 45s heartbeat; empty rooms are GC'd after 30 min.
- ✅ Web `PARTY` mesh (voice, lower CID offers) + call UI at the top of the chat
  panel; watchers join as listeners; room code is posted to chat.
- ✅ Android `PartyService` (foreground, mic type) + draggable overlay bubble,
  notification mute/leave, `partyStart/partyStop/partyMute/canOverlay/
  requestOverlay` bridge, `window.__sswPartyAction`.
- ⏳ **Not done — true persistence after swipe-away.** The call still lives in
  the Activity WebView; pressing back while on a call now backgrounds the app
  (`backgroundApp`/`moveTaskToBack`) so the call + bubble survive, but a
  force-stop/swipe-away still ends it. To finish: host the party call in a
  headless WebView owned by `PartyService`, hand the call over from the Activity
  when it backgrounds, and expose the bubble's mute via the service.
- ✅ Watcher → talker: `🎙 Use microphone` rebuilds the peers with a mic track.
- ✅ In-game access: `💬 Chat & party` in the `⋯` menu shows the panel above the
  game (mounted via `uiRoot()`).
- ⏳ Unify the netplay `#np-*` voice with the party call so a watcher joining a
  netplay session lands on the same call.
- ⏳ Add the party id to the watch/invite payloads so a "watch" invite can also
  drop the guest onto the call.

### B. RetroAchievements
- Done: `raSettingsForm()` (prefs `raEnabled/raUser/raKey`) in profile Settings
  and the in-game Achievements panel, plus a **Test connection** button
  (`raTest()` → `API_GetUserProfile.php`; RA sends CORS `*`, no proxy needed).
- Next: list a game's achievements (needs the RA game id from the ROM MD5:
  `dorequest.php?r=gameid&m=<md5>`, then `API_GetGameInfoAndUserProgress.php`).
- In-game unlocks/popups still need a cheevos-capable emulator build (the
  self-hosted `stable` EJS has none) or rcheevos wasm. Render popups via a
  `uiRoot()` overlay (`raToast({title,desc,points,icon})`).

### C. Per-console graphics — started
- ✅ `gfxFilterFor(sys)`/`saveGfxFilter()` (LS `gfxPresets`, like padPresets),
  applied in `routePlayGame`; `gfxPanel(sys)` from the in-game `🖼 Graphics`
  entry (Pixel-perfect / Smooth / CRT per console).
- Next: per-core internal-resolution + texture-filter options where EJS/core
  exposes them (N64 stays WebGL1).
