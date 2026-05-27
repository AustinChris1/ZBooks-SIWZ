# Demo video script — SIWZ + ZBooks

> **Target length:** 4–5 minutes. The hackathon page says "short walkthrough" — under 5 minutes is the sweet spot. Aim for tight, no filler. The script below is paced to 4:30.

> **Recording setup:** OBS / ScreenStudio. Screen resolution 1920×1080. Browser zoom 110% so the UI reads well. Have ZBooks (`:3000`) and the comments-wall reference app (`:3001`) running side by side in two tabs. Have a mobile wallet (Zashi or YWallet) on a phone you can film briefly, OR pre-record the phone scan and edit in.

> **Voiceover:** Speak conversationally, not scripted-sounding. Read the prose below for pacing, then say it in your own words for the take.

---

## 0:00 — 0:25 · Cold open: the problem

**On screen:** the SIWE.xyz home page in one tab; the [ZecHub wallet directory](https://zechub.wiki/wallets) in another. Tab-switch between them.

**Say:**

> "Sign in with Ethereum has ten thousand integrations. Sign in with Zcash has zero. Not because nobody wants it — because of *this*."
>
> *(switch to the wallet directory)*
>
> "Twenty-four Zcash wallets. Almost none of them implement message signing the way SIWE expects. And the ones that do only sign with transparent addresses — which is the part of Zcash that's *least* Zcash."
>
> "So I built SIWZ differently. Watch."

---

## 0:25 — 0:55 · The reveal: open ZBooks

**On screen:** localhost:3000, the ZBooks landing page. Cursor hovers on the "Sign in with Zcash" button.

**Say:**

> "ZBooks. Accounting for ZEC teams. Built on SIWZ. Click Sign in with Zcash — and notice the entire 'enter your address, paste a signature' ceremony I'd have to make you do is gone."
>
> *(click button → modal/section opens with QR code + amount + service address visible)*
>
> "You scan a QR with your wallet. You confirm a tiny payment — ten thousand zatoshi, about four cents. That's it. That payment IS the sign-in."

**Visual moment:** zoom in briefly on the amount line so the viewer sees `0.00010163 ZEC` clearly. Mention "four cents" while the camera is on it.

---

## 0:55 — 1:35 · Mobile wallet pickup

**On screen:** the QR code from the previous shot, now with a small phone overlay in the corner showing a wallet app scanning the QR.

**Say:**

> "Here's a mobile wallet — this is YWallet, but it would be the same in Zashi, Zingo, Zodl, eZcash, Cake, anything that speaks ZIP 321. Which is every shielded Zcash wallet."
>
> *(phone overlay shows wallet opening with tx pre-filled — amount, recipient, memo already populated)*
>
> "Notice the amount, the recipient, even the memo are pre-filled. I'm not asking the wallet to do anything custom — I'm using a payment-request URI standard that's been in the Zcash spec since 2018. ZIP 321."
>
> *(tap Send in the wallet)*

**B-roll suggestion:** if you can't film a phone neatly, use a screen-recorded simulator or a clean still of the wallet's confirmation screen with an arrow pointing to the "Send" button.

---

## 1:35 — 2:00 · The confirmation

**On screen:** back to ZBooks browser. The waiting state ("Waiting for your payment on-chain…") visible briefly, then flips to "Payment detected" and redirects to the dashboard.

**Say:**

> "About 75 seconds for a block confirmation. In demo mode I can short-circuit that, but on mainnet this is the real wait time — the price of authenticating *on-chain* instead of off-chain. And — there. I'm signed in."

---

## 2:00 — 2:45 · What ZBooks does with the session

**On screen:** /keys page → user adds a UFVK → /transactions populates → /reports shows monthly P&L.

**Say:**

> "ZBooks now has me authenticated. From here, I add a Unified Full Viewing Key — read-only, so ZBooks can never spend on my behalf. It pulls my transactions, lets my treasurer tag them by category, exports CSVs that drop straight into QuickBooks."
>
> *(quick tour of the four pages: keys, transactions with tagging, reports with the CSV download button highlighted, team with the roles)*
>
> "Role-based access. Multi-user. CSV export. The accounting tool the ECC team and grant recipients have been pasting txids into spreadsheets to avoid building."

---

## 2:45 — 3:30 · The "this is infrastructure" reveal

**On screen:** open the second tab — localhost:3001, the example-comments wall.

**Say:**

> "Now here's the trick. This is a *different app* I built using the same SIWZ packages. Zcash-gated comments wall. Hundred and fifty lines of code total."
>
> *(quick tab switch back to ZBooks's much-larger UI, then back to comments wall to highlight the contrast)*
>
> "Same sign-in flow. Same packages. Different app, different data, different UI. That's the test of whether SIWZ is actually infrastructure — can someone else build on it in an afternoon? Yes."

**Visual moment:** if you can, show a split-screen briefly of both apps signed in with the same address.

---

## 3:30 — 4:00 · The technical bona fides

**On screen:** open `docs/architecture.svg` in a browser tab. Pan/zoom across the three flows.

**Say:**

> "Under the hood: three sign-in flows behind one verifier dispatcher. SIWZ-classic for the few wallets that sign messages. Memo-challenge for the rest. MetaMask Snap when ChainSafe's allowlist lets us. Address-type detection picks the right verifier — transparent uses a public block explorer, shielded uses an IVK-holding daemon to decrypt memos."
>
> *(zoom out from the diagram)*
>
> "Three npm packages: at-siwz-slash-core, slash-react, slash-next-auth. Fifty-four unit tests. Pure TypeScript verification — no native deps, runs in any Node, edge runtime, or browser."

---

## 4:00 — 4:30 · Why it should win

**On screen:** back to the ZBooks landing page, with the comments wall in a smaller tile on the side.

**Say:**

> "Zcash needed Sign in with Ethereum's equivalent. It needed it built *for* Zcash, not ported from Ethereum. SIWZ uses the privacy chain in the privacy direction — shielded payments, encrypted memos, ZIP 321 deep links, ZIP 304 ready when wallets converge."
>
> "And it ships with a working app on top — ZBooks — so it's not just a library hoping someone integrates it. Two real apps, fifty-four tests, full documentation, and an honest threat model."
>
> "Sign in with Zcash. github-dot-com-slash-yourorg-slash-SWZ. Vote for it if you'd use it."

**End card:** repo URL, your name/handle, hackathon track ("Zcash Login + Accounting"), MIT license. 5 seconds.

---

## Tips while recording

- **Don't apologize.** Avoid "this is just" / "this might be" / "I hope". You built infrastructure; sound like it.
- **Show, don't say.** Every claim above is backed by a visual in the same beat. Don't talk about the QR code; the QR code is on screen.
- **Cut the dead air.** If you fumble, restart that section. Splice clean takes together. Voice-over each section separately if it helps.
- **Music:** ambient, not bombastic. Don't pick anything with vocals. Free options: [Pixabay's music section](https://pixabay.com/music/), filter for instrumental / ambient.
- **Captions:** burn them in. ~40% of judges will watch with sound off the first pass.
- **Aspect ratio:** 16:9. Don't square-crop for social — the hackathon submission goes in Discord, where everyone watches full-width.
- **Thumbnail:** the QR code with "Sign in with Zcash" on the side. Big, readable, screenshot-quality.

## Shot list for editing

| Time | Shot | Notes |
|---|---|---|
| 0:00 | SIWE.xyz tab | static |
| 0:08 | Wallet directory | scroll once |
| 0:18 | Cut to ZBooks landing | tight |
| 0:25 | Hover sign-in button | small pause |
| 0:30 | QR code modal | zoom-in on amount |
| 0:55 | Phone overlay scanning | filmed or simulated |
| 1:15 | Wallet send confirmation | tight crop on the Send button |
| 1:35 | Waiting state | brief; ok to speed up |
| 1:55 | Dashboard reveal | hold for 2 seconds |
| 2:00 | /keys → add UFVK | smooth |
| 2:15 | /transactions with tagging | one tag in one click |
| 2:30 | /reports + CSV download | hover the download |
| 2:45 | Tab-switch to comments wall | beat |
| 3:00 | Sign in on comments | quick |
| 3:15 | Split screen ZBooks + comments | brief |
| 3:30 | Architecture diagram | pan |
| 3:50 | Repo readme | scroll once |
| 4:00 | Closing card | static 5 sec |

## Per-wallet shot prep (for the phone overlay)

You probably only have time to film one wallet on camera. Pick the one whose UX looks most polished — **Zashi** is usually the strongest visual choice for Zcash demos because the ECC has invested heavily in its design. YWallet is good as a backup and supports more receivers.

See [`wallets.md`](./wallets.md) for the exact taps in each wallet. The short version:

- **Zashi:** scan → review → Send. 3 taps.
- **YWallet:** ⋮ → Pay URI → scan → Send. 4 taps.
- **Zingo (desktop):** Send → Scan QR → review → Send. 4 clicks.
- **Zodl:** scan → confirm. 2 taps (if available).
- **eZcash / Zenith / Cake:** menu → Pay / Send → Scan → confirm.

All of them prefill the amount, recipient, and memo from the ZIP 321 URI. **None of them require the user to type anything.** That's the whole point of the demo.
