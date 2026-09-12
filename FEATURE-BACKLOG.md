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

1. **Native push invite (app repo)** — deliver `/play/invite` as an Android
   notification via the `SSMedia`/webview bridge so an invite works when the app
   is backgrounded. Requires an APK build (Dart/Kotlin).
3. **Push-to-talk** — voice is an open mic; add a PTT mode + a mute mic button.

## Do not

- Re-enable Tailscale Funnel (§4) or EmulatorJS `:8712` lockstep (§12).
- Empty `NETPLAY_ICE` — host-only ICE cannot cross the tailnet (mDNS). See
  `NETPLAY-UI-CONTRACT.md`.
- Break the `#np-video` stacking (touch pad must stay above it) or the
  `<details>` Diagnostics in the netplay sheet.
