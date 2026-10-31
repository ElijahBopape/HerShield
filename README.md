<p align="center">
  <img src="app/logo.svg" alt="HerShield logo" width="140">
</p>

<h1 align="center">HerShield</h1>
<p align="center"><b>The black box for gender-based violence.</b><br>The truth, sealed, so it can't be ignored, edited or made up.</p>

<p align="center">
  <a href="https://hershield-wheat.vercel.app"><b>▶ Try the live demo</b></a> ·
  <a href="HerShield_Report.pdf">Full report (PDF)</a> ·
  <a href="HerShield_Presentation_Script.pdf">Presentation script (PDF)</a>
</p>

---

HerShield is a voice-triggered evidence recorder for women facing abuse. She chooses her own secret everyday phrase (like *"Have you seen my red scarf?"*). When she says it, her phone starts recording in secret, with no need to touch, unlock or even reach it. Every 4 seconds the audio, time and GPS location are fingerprinted and chained together, so **nobody can delete or edit the evidence, not the abuser and not the woman herself**. Police, lawyers and courts can then verify that a recording is genuine.

Built by **Elijah**, a third-year IT (Software Development) student at Rosebank International, Polokwane, for the **Women Empowerment Through Technology (WEtTech) Hackathon 2026** (team 4.1).

## The problem

- During an attack, a woman usually **can't reach or unlock her phone**, so panic-button apps fail when they're needed most.
- Afterwards, it is often **her word against his**. Evidence on her phone gets deleted, or is dismissed as edited.
- The topic is so sensitive that an accusation is sometimes believed **without proof**, which is unfair to an innocent person.

Both problems come from the same gap: **there is no evidence everyone can trust.** HerShield doesn't help anyone accuse. It helps the truth get proven.

## How it works

| Step | What happens |
|---|---|
| 1. Set up | She picks a secret phrase, PIN, optional duress PIN, theme colours and a disguise (a working calculator). |
| 2. Armed | The phone listens on the device only for her phrase. Nothing is recorded or sent while waiting. |
| 3. Triggered | Her phrase, shaking the phone, or triple-tapping the logo starts recording. He has no idea. |
| 4. Covert capture | The screen looks locked. Audio, time and GPS are captured offline. Stopping needs her PIN. |
| 5. Sealed | Every 4-second piece gets a SHA-256 fingerprint that includes the previous seal, forming a chain. |
| 6. Verified | The Verify tool checks if a file is byte-for-byte identical to the sealed original. |

**Fair to both sides:** HerShield stores no accusations, only raw recordings that can't be changed. An edited or fabricated file always fails verification, and a recording that contradicts a claim helps the accused. Only courts decide guilt.

## Try the demo

Open **https://hershield-wheat.vercel.app** on a phone or computer (Chrome works best).

1. Complete the setup. Choose a PIN, for example `1234`, and a duress PIN, for example `0000`.
2. The app opens as a calculator. Type your PIN and press `=`.
3. Say your phrase, or press **Simulate trigger**. Tap the clock 5 times to see pieces being sealed live.
4. Stop with your PIN, then open the **Vault**. There is no delete button, by design.
5. In **Verify**, try **Check original** (✓ AUTHENTIC) and **Check edited copy** (✕ NOT AUTHENTIC).
6. Open a recording and use **Simulate tampering**, then **Check seal integrity**. The chain breaks.
7. Exit, type the duress PIN and `=`. The decoy app is empty.

Everything a visitor records stays in their own browser. Nothing is uploaded.

### Run it locally (works offline)

- **Windows:** double-click `START_DEMO.bat` (requires Python), then open http://localhost:8080
- **Any system:** `cd app` then `python -m http.server 8080`

The microphone only works on `localhost` or `https`, not when you open `index.html` directly as a file.

## What works today vs. what's planned

| Works in the demo | Full version |
|---|---|
| Setup wizard, themes and dark mode, calculator disguise, duress PIN | Always-on offline wake word with the screen off |
| Voice phrase trigger (browser speech), shake, triple-tap | Volume-button pattern, Bluetooth bracelet, smartwatch, iPhone Back Tap and Action Button |
| Real microphone recording with GPS and timestamps | AES-256 encryption at rest, keys in Keystore or Secure Enclave |
| 4-second SHA-256 hash-chain sealing | Trusted timestamps (RFC 3161) and encrypted backup stored in South Africa |
| Vault with no delete, PIN-locked read-only playback, 3 listening policies | Release to SAPS, courts, lawyers and Thuthuzela Care Centres |
| Integrity check, tamper simulation, export package, Verify tool | Verification portal for justice officials |
| South African helplines with tap-to-call | Trusted-person SMS alerts, nearby help map, 8 languages |

## Tech stack

**Demo:** plain HTML, CSS and JavaScript, with no framework and no build step, so it runs in any browser on Android and iPhone.
- MediaRecorder for audio
- Web Speech API for the phrase trigger
- Web Crypto (SHA-256) for fingerprints
- IndexedDB for storage. The code has no delete function.
- Geolocation and Device Motion for GPS and the shake trigger
- A service worker so it works offline
- Hosted on Vercel

**Full product (planned):**
- Flutter (Dart) app, with Kotlin for Android and Swift for iOS
- Offline wake word: openWakeWord / Vosk, or Picovoice
- SQLCipher and AES-256-GCM encryption
- Node.js / TypeScript backend with PostgreSQL
- Storage in a South African cloud region
- RFC 3161 timestamps and an append-only transparency log
- React / Next.js verification portal

## Legal context (South Africa)

- **RICA** (Act 70 of 2002), section 4: a person who is a party to a conversation may generally record it.
- **ECTA** (Act 25 of 2002), section 15: electronic evidence is admissible, and its weight depends on how reliably its integrity was kept, which is what the seal chain is designed to show.
- **Domestic Violence Act** (116 of 1998, amended 2021): the evidence can support protection-order applications.
- **POPIA** (Act 4 of 2013): data stays on the device by default, and any cloud copy is encrypted and stored in South Africa.

*This is a student project's understanding of the law, not legal advice. The design would get formal legal review before any real launch.*

## Repository layout

```
app/                 The demo web app (deployed to Vercel)
  index.html         App shell
  app.js             All screens and logic: triggers, recording, hash chain, vault, verify
  styles.css         Theme (CSS variables, so users can recolour the app)
  sw.js              Service worker for offline use
  logo.svg           The HerShield mark: a waveform that hides an H and a sideways S
report/              HTML sources for the PDFs, plus screenshots of every screen
HerShield_Report.pdf                Concept, design reasoning and a walkthrough of every button
HerShield_Presentation_Script.pdf   Pitch script, judge Q&A, roadmap, challenges, legal notes
START_DEMO.bat       One-click local launcher (Windows)
```

## Get help (South Africa)

GBV Command Centre **0800 428 428** · USSD **\*120\*7867#** · SAPS **10111** · Childline **116**
