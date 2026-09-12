# RetroVerse feature backlog — ownership + specs

Split of the feature list between the two agents working 2026-09-11. **One writer
per file.** Netplay internals (`NP`, `np*()`, `handlePingReply`, `acceptInvite`,
`/np/*`, `/play/invite*`) belong to the **netplay agent**; UI/library/app-shell
work belongs to the **layout agent**. Coordinate through this file + `AGENTS.md`
+ `NETPLAY-UI-CONTRACT.md`.

## Assigned to the netplay agent (you own NP; keep `NETPLAY-UI-CONTRACT.md` current)

1. **Voice chat during netplay** — reuse the existing `RTCPeerConnection`: add a
   mic audio track (`getUserMedia({audio:true})`), a mute/push-to-talk button in
   the netplay sheet, and mix it into the same peer connection. Show a small
   "🎙" state. Biggest single UX win for playing with a friend.
2. **Rollback / input-delay netcode** — the host currently re-pushes a savestate
   every ~6s to mask drift (§15). Add a per-game "netcode: delay / rollback"
   setting; start with 1–3 frames of input delay, then a savestate+frame-count
   rollback using `gameManager.getFrameNum()` + `Module.postMainLoop`.
3. **Role-aware auto-reconnect** — a host that reloads/backgrounds must re-host
   the same room, not rejoin as Player 2. Persist the host room (+ game) and
   restore it; the guest path already re-joins via `ssw:joinNp`.
4. **Netplay lobby polish** — show live RTT/ping and a "both ready" gate in the
   netplay sheet; surface reconnect/leave as a persistent status, not a 5s toast.
5. **Watch-party transport** — frames are JPEG PUTs every 160ms. Move to a
   WebRTC video track so spectating is smooth and the watcher hears the game.
6. **Native push invite (with the app repo)** — deliver `/play/invite` as an
   Android notification via the existing `SSMedia`/webview bridge so an invite
   works when the app is backgrounded. Requires an APK build (Dart/Kotlin).

## Owned by the layout agent (this session)

- ✅ In-game chrome reorg, landscape toggle, netplay-in-bar, 2× reveal handle,
  hamburger → control bar, preview sound (v2.45–2.48).
- 🔄 **Invites**: shareable `?join=<room>` deep-link, "Copy invite link", and
  auto-join on open (this change).
- ⏳ **#4 Library**: "Continue playing" row + "▶ Playable only" filter.
- ⏳ **#5 Per-system touch-pad layout presets** (size/pos/opacity per console).
- ⏳ Accessibility pass, offline-download UI, backup/restore of favorites+saves.

### ⚠️ Home header — done by the netplay agent at the user's direct request (2.22.15)

This is app-shell territory, so flagging it here to avoid duplicate work. I only
touched:
- `style.css`: `.brand .logo` mobile heights (46 px ≤560, 40 px ≤420).
- `app.js` `renderAcctChip()`: `#acct-chip` now `prepend`s into `.bar-left`
  (leftmost) instead of `.bar-right`.
- `app.js` `heroShowcase()`: `mode` starts at `"video"` always; `setMode(m,
  persist)` so a video error (`vd.onerror`) falls back to art without writing
  `scMode`.

If you were mid-edit on `.bar` / `.brand` / `#acct-chip`, re-read before writing.


## Do not
- Re-enable Tailscale Funnel (§4) or EmulatorJS `:8712` lockstep (§12).
- Touch `NP` internals from the layout side, or `.player-bar` button ids
  (`#np-btn`, `#inv-btn`, `#np-sync-btn`) from the netplay side, without a note.
