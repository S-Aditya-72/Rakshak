# RAKSHAK Android app

One app, one role per phone. The laptop runs the inference service (RoBERTa + Qwen, or the rules fallback) and the
sync relay; the phones carry the story.

```
                    ┌──────────────── laptop ────────────────┐
 Kabir's phone ────▶│ npm run server:lan  :8787               │◀── projector: http://127.0.0.1:5280/#/engine
 Meera's phone ────▶│   /api/*  analysis, case memory         │    (engine + "what each phone received")
 Amma's phone  ────▶│   /api/sync  relay (guardians: alert    │
 Ms. Rao (temp) ───▶│              summaries only)            │
                    └─────────────────────────────────────────┘
```

| Phone | What it is |
|---|---|
| **Meera's phone** | A messenger protected by RAKSHAK: private nudges, *Pause before you send* on photos to a flagged contact, contact profile ("Not in your contacts · account created 3 days ago"), SOS. |
| **Kabir's phone** | A plain messenger. Nothing on it mentions RAKSHAK. Live typing dots, read receipts, *Not delivered* once blocked. |
| **Amma's phone** | RAKSHAK Guardian: a lock screen that wakes up for alerts, **real Android notifications**, Home / Alerts / Report / Settings, temporary guardians. Never receives Meera's messages. |
| **Temporary guardian** | A teacher or relative who scanned Amma's invite QR: alerts until a time Amma chose (optionally critical only), then access ends by itself. |
| **Offline demo** | No server: one phone plays the labelled presentation preview. Fallback only. |

Each phone remembers its role and opens straight into it. *Settings → Set up this phone again* (guardian) or the
connection banner (chat phones) returns to setup.

---

## 1. Install the app on each phone

Every phone needs the same build as the laptop: an older app ignores a newer laptop (and the other way round) instead
of misbehaving, so after pulling new code reinstall the APK on every phone.

1. Copy `apk/RAKSHAK-debug.apk` to the phone (Google Drive, WhatsApp "document", USB, …) and open it. If an older
   RAKSHAK is installed, tap **Update** (or uninstall it first if Android refuses).
2. Android asks to allow installs from that app (Files / Drive / WhatsApp): allow it.
3. Play Protect may warn about an unknown developer: choose *Install anyway*. It is a debug build signed on our laptop.

Android 7.0 or newer. Portrait only. The guardian's phone asks for notification permission; the setup screen asks for
the camera (QR codes only, decoded on the phone).

## 2. Start the laptop

First time after pulling these changes:

```powershell
cd rakshak
npm install
apps\server\.venv\Scripts\python.exe -m pip install -r apps\server\requirements.txt
```

Every time (restart the server after pulling new code: it does not reload by itself):

```powershell
ollama serve                 # if the Ollama app is not already running
npm run server:lan           # instead of `npm run server`
npm run dev                  # web UI on http://127.0.0.1:5280
```

Windows Firewall asks about Python the first time: allow **Private networks**.

Open **http://127.0.0.1:5280/#/engine** on the laptop (the projector view). *Drawn phones* in the header switches
back to the three drawn phones if there are no real phones.

## 3. Connect the phones (QR)

1. Laptop: **Connect phones** (top right). A QR code appears, with the address and code underneath. If two addresses
   are listed, try the other one when a phone can't connect.
2. Each phone: RAKSHAK → **Scan QR code** → point at the laptop. Then **Who uses this phone?** → Meera / Kabir / Amma.
3. The laptop's **Devices** panel lists each phone and what it received.

No camera? *Enter address and code by hand* takes the same details.

## 4. Run the demo

The laptop picks the mode at the top (**A / B / C**) and the case in the **Studio** panel on the left (S toggles it).
Switching modes never changes the case; only a Studio button (or Reset) replaces it, and the phones follow.

- **C · Free Chat:** Studio → *Start new conversation*. Type on Kabir's phone; Meera replies on hers. Every saved
  message, Meera's included, is analysed on the laptop (Qwen 3–8 s, rules fallback instantly). Alerts appear on
  Meera's phone (nudge) and Amma's phone (lock screen + notification).
- **B · Continue the Conversation:** Studio → pick an earlier conversation → a starting point → *Load history and
  continue*. Both chat phones show the history; the laptop analyses it (alerts found in history are listed on Amma's
  phone but not pushed as notifications), then you type the next messages live.
- **A · Guided Demo:** Studio → pick an example or case study → Play. The phones play the script: Kabir's keyboard
  types each line, Meera's phone shows the typing dots, alerts arrive as in live chat. *Continue live from here*
  turns the played case into a live one.
- **Reset** (↺ in the dock, or R) restarts the current case from its own starting point, including un-blocking Kabir.

Phones type only in B and C, once the history has finished loading. In A the composer says *Demo playing…*.

### What the buttons do

Every press is shared with the other phones and listed under *Responses* in the engine.

| Where | Button | Effect |
|---|---|---|
| Meera, nudge L1/L2 | Talk to someone / Talk to Amma | Amma's phone: "Meera would like to talk" (no message content) |
| Meera, nudge L3 | SOS to Amma | Pulsing SOS on Amma's phone, ringing sound and vibration |
| Meera, nudge or contact profile | Block | Note in both chats; Kabir's next messages show *Not delivered* and never reach Meera; the engine records the block |
| Meera, 📷 → selfie to a flagged contact | Pause before you send | *Don't send* / *Talk to Amma first* / *Send anyway* (Amma is told a photo was sent, never sees it) |
| Amma, alert | Talk to Meera | Check-in card on Meera's phone; her "Okay 💛" / "Talk now" comes back to Amma |
| Amma, alert | Block contact | Same as Meera's Block, labelled "Amma blocked Kabir through RAKSHAK" |
| Amma, alert | Loop in counsellor / Trusted adult | Logged in the case; the button turns into a ✓ |
| Amma, alert or CRITICAL | Get help | Full-screen guide: *Understand · Support · Evidence & report · Complaint options* (see below) |
| Amma, CRITICAL | Call 1930 | Opens the phone's dialer with 1930 filled in. **Nothing is dialled until you press call** |
| Amma, CRITICAL | Support Meera / Reporting options | Opens Get help on that tab |
| Get help · Support | Send Meera a check-in · Block Kabir · counsellor note | The same effects as the alert's buttons; helpline numbers open the dialer |
| Get help · Complaint | Call 1930 · cybercrime.gov.in · Take It Down | Real dialer / websites (open outside the app). Nothing is submitted for you |
| Get help · Complaint (L3) | Mark as handled | Closes CRITICAL on every phone; the case stays in Alerts and Report |
| Amma, Report | Share | Android share sheet with a text summary (cue types, days, actions; no message content) |

**Get help on Amma's phone works from the alert summary only.** *Understand* lists what was detected and when, and the
risk level with its rule trace; *Evidence & report* says the evidence stays on Meera's phone. Excerpts, the redacted
report and its download are on the laptop (the drawn guardian phone, or any alert's Get help there).

**Withdrawn alerts.** When a fuller reading of the chat no longer supports an alert, it is kept in Amma's history,
struck through, and Amma's phone gets a calm "Update: …" notification instead of a new alarm.

### Temporary guardians

Amma → Settings → **Add temporary guardian** → how long (1 hour, 4 hours, today, 3 days) → *Critical alerts only*
(recommended) → **Create invite QR**. On the other phone: RAKSHAK → Scan QR code → enter a name → Accept.

- The QR carries the invite's **own code**, never the master access code. It opens only the alert feed: the server
  refuses every other API with it.
- The server enforces the end time and **Revoke** (trash icon in Amma's Settings): the temporary guardian is
  disconnected and sees *Your temporary access has ended*; the case is wiped from that phone.
- Critical-only guardians get Level 3 alerts and SOS, nothing else.

### Privacy, and how to show it

Guardian phones never receive the conversation. Chat devices send them an **alert summary** (alert titles, cue
types, days, score, actions taken); the relay itself drops any guardian-bound frame that contains message text,
drafts, evidence or model output, and counts it. The engine's **Devices** panel shows each phone's audience and what
it received, ending with *Chat messages delivered to them: 0*.

## Network: use a phone hotspot

Venue and college Wi-Fi often block devices from reaching each other ("client isolation"). Turn on a **hotspot on a
spare phone**, connect the laptop and all demo phones to it, restart `npm run server:lan` and use **Connect phones**.

### Testing from far away (a tunnel)

```powershell
winget install Cloudflare.cloudflared      # once
cloudflared tunnel --url http://127.0.0.1:8787
```

Enter the printed `https://….trycloudflare.com` link and the access code by hand on the phone. The link is public,
which is why the access code is required. Stop the tunnel (Ctrl+C) when done.

## Notifications: what to expect

- Alerts are raised by the app itself when they arrive over the live connection (there is no push service).
- On the guardian's phone RAKSHAK runs a small **background service** ("RAKSHAK Guardian is on" in the notification
  shade) so Android does not freeze the app: alerts keep arriving with the screen off or another app open.
- Battery savers on some phones (Xiaomi, Oppo, Vivo, Samsung "deep sleep") still kill background apps. For the demo,
  keep Amma's phone on the RAKSHAK lock screen, or set RAKSHAK to *Unrestricted* battery use.

## Troubleshooting

| The phone says | Fix |
|---|---|
| *No connection · tap to fix* | Same Wi-Fi/hotspot as the laptop? `npm run server:lan` (not `npm run server`) running? Firewall allowed for Python? Try the other address in Connect phones. |
| *Wrong access code* | Scan the QR again (the code is in `rakshak/data/access-token`). |
| *Temporary access ended* | The invite expired or was revoked. Ask for a new QR. |
| Phones connect but behave like the old version | The laptop's server is still running old code: stop it (Ctrl+C) and start `npm run server:lan` again. |
| No notifications on Amma's phone | Allow notifications for RAKSHAK; *Settings → Send a test notification*. See *Notifications* above for battery savers. |
| Kabir's messages show *Not delivered* | Someone pressed Block. Reset on the laptop. |
| No sound | Phone not on silent; media volume up. Sound starts working after the first tap in the app. |

## Rebuilding the APK

Only needed after changing the web code. Needs Android Studio (its bundled Java 21 and the Android SDK):

```powershell
npm run apk          # → rakshak/apk/RAKSHAK-debug.apk
```

## What this is not

A demo client for synthetic conversations. It does not read real chats on the phone (the messenger is RAKSHAK's
own), does not run the models on the phone, and is not a store-ready release (debug-signed, no Play Store listing).
