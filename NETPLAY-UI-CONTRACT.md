# Netplay ↔ UI contract (for whoever restyles the in-game layout)

You're removing/replacing the in-game top bar (`.player-bar`). Read this first —
netplay hooks into that DOM and CSS, and the current browser build puts the
Netplay / Invite / Sync controls **in the top bar**.

## What netplay touches (don't break without updating `docs/assets/app.js`)

| Contract | Where in app.js | Notes |
|---|---|---|
| `.player` element must exist while a game is up | `uiRoot()` | Overlays/toasts mount **inside `.player`**, not `body`, because `goLandscape()` puts `.player` in the Fullscreen API top layer. Only descendants render above it. |
| Game canvas container `.player-stage #game` | `routePlayGame()` | EmulatorJS mounts there. |
| `goLandscape()` fullscreens `.player` | top of app.js | If you change the fullscreen target, update `uiRoot()` too. |
| `#toast`, `#help-overlay`, `#invite-overlay`, `#ctrl-panel` | many | `z-index: 400+`, `position: fixed`. Must win over the canvas. |
| Netplay entry buttons | `routePlayGame()`, `openNetplaySheet()` | Desktop: `.pbtn` `#np-btn`, `#inv-btn`, `#np-sync-btn` on `.player-bar`. In-app: `.fab-np`. |
| In-app controls | `.fab-ctrl`, `.fab-exit`, `.fab-pad`, `.chrome-peek` | `controlsPanel`, `toggleTouchPad`; `.chrome-peek` opens the RetroVerse toolbar. |
| EmulatorJS menu | `.ejs_virtualGamepad_open` | Native top-right menu: emulator audio/video/FPS and save import/export. Do not intercept it. |
| `html.in-app.playing .bar, .drawer { display:none }` | `style.css` | the site chrome is hidden in-app during play. |

## The important trap

On **desktop/browser**, Netplay + Invite live in `.player-bar` as `.pbtn`s.
If you delete the top bar you must re-provide those controls (promote them to
FABs, a slim rail, or a menu) **for non-in-app too** — otherwise netplay is
unreachable on desktop. In-app already has the `.fab-np` path.

## Don't touch netplay logic
`NP`, `np*()` functions in `app.js` (host/guest, ICE, chunked state sync,
`npHookInput`, auto-resync). If you need a hook, ask; don't refactor blind —
the sync/link is still being stabilised.

## Still open (netplay bugs, not yours)
- Drift: two independent cores sharing only inputs diverge; host re-pushes a
  savestate every 6 s as a stop-gap. A real fix (host-authoritative video or
  frame-locked lockstep) is under discussion — layout changes should not assume
  the guest always runs its own core.
- Intermittent link failures — the Netplay sheet now shows a `diag …` line plus
  `last:` event; keep those visible when restyling the sheet.

## Restyle applied 2.22.7 (in-game chrome)

- The in-app `.fab-np` was **removed**. Netplay now lives only in the hideable
  `.player-bar` (`#np-btn`), which stays reachable because the reveal handle
  (`.chrome-peek`) was doubled to 112×32 with a chevron: tap the top-centre
  handle, then **Netplay**.
- `.player-bar` button order is exit · rewind/fast-forward · save/save-as/load ·
  netplay/invite/sync/watch · controller/note/report/pad. The smaller title is
  in the following `#player-title` strip. The toolbar is nowrap +
  horizontal-scroll in-app.
- `goLandscape()` is now a toggle: browser path still fullscreens `.player`
  (so `uiRoot()` is unchanged); in-app path posts `SSPlay "0"` / `"1"` to rotate.
- No netplay logic (`NP`, `np*()`) was touched. `#np-btn`, `#inv-btn`,
  `#np-sync-btn` are still `.pbtn`s on `.player-bar` for desktop.

## Netplay fix applied 2.22.8 (connectivity)

- **STUN is back.** `NETPLAY_ICE` = Google + Cloudflare STUN. Host-only ICE was
  a mistake: host candidates for private/tailnet IPs are mDNS `.local` names
  that don't cross the tailnet, so a remote peer had no viable pair ("Connecting
  as Player 2…" 10s+). **Do not empty `NETPLAY_ICE` again.**
- Since netplay now lives in the hideable bar, the guest needs the bar revealed
  to tap Join — keep `.chrome-peek` generously sized.
- Still open: drift (host pushes state every 6s) and occasional link hangs. The
  Netplay sheet's `diag …` / `last:` line is how we diagnose; keep it visible.

## Applied 2.22.9 / 2.22.10 (my round)

- **Host-authoritative video is the default.** Guest shows `#np-video`
  (`position:absolute;inset:0;z-index:1` inside `.player-stage`) — **the EJS
  touch pad must stay above it** (it's at z-index ~999, so don't add a stacking
  context that traps it). Host captures canvas+audio via EJS.
- **Netplay sheet** now: status line, primary action, **Leave netplay**, and the
  raw diag moved into a `<details><summary>Diagnostics</summary>`. If you restyle
  `.help-card`, keep `<details>`/`<summary>` usable and the diag text readable.
- Drift note is now stale: in video mode there is **no** state sync
  (`NP.syncT` is gated on `!NP.video`); input-echo + 6 s resync is only a
  fallback when capture fails.
- Emulator load failure now offers **Retry** (and CDN fallback) — restyle the
  `#player-load` retry button if needed.
