# Monetization Strategy — Daftarche

**Status:** proposal. No price is fixed here, no provider is selected, and nothing is implemented.

**Approved and no longer a question:** cross-device synchronisation is **free for every registered account** and is not, and will not be, a Plus benefit or a one-time product. Account creation stays optional for local use. Plus and the one-time packs therefore have to earn their place on value that is genuinely additional to data continuity.

---

## 1. What exists today (verified)

| Question | Answer | Evidence |
|---|---|---|
| Is there any purchase flow? | **No.** No billing plugin, no product catalogue, no receipt, no entitlement | `package.json` devDependencies (android, app, cli, core, filesystem, local-notifications, share, status-bar only) |
| How are premium-looking items currently obtained? | **By achievement.** Worlds unlock when a named achievement tier is reached | `js/theme.js:65` `isThemeUnlocked` → `rewardFor('theme', key)` → `hasReward`; reward table in `js/achievements.js` `REWARDS` |
| Is there any account association? | No account exists | See `PRODUCT_MATURITY_AUDIT.md` §4.1 |
| Are there ads? | None anywhere in the source | — |
| Is any usage data sold or transmitted? | No | `PRIVACY_AND_ANALYTICS_POLICY.md` §2 |

**The strategic consequence is the single most important monetization constraint:** ten visual worlds and their Today cards are already *earned* by existing users. They cannot be moved behind a paywall without taking something away. The paid boundary must be drawn on **new** value.

---

## 2. Free tier (proposal; §2.1 is approved)

Everything that makes the app a productivity tool stays free, permanently, with no account:

| Free, no account | Notes |
|---|---|
| Unlimited tasks, categories, priorities, due dates, planned spans | Core utility |
| Quick add (Persian natural language) | Differentiator |
| Decision Engine recommendation and alternatives | Differentiator; gating it would hollow out the product |
| Focus timer, ratings, session history | Include the existing 100-session archive |
| Library: PDF import, reading progress, goals, highlights, notes | Free; storage is local |
| Calendar, day planner, week view | Free |
| Full offline operation | Non-negotiable per the brief |
| Local backup export/import (JSON + PDF pack) | Data ownership is part of the promise |
| 7 base themes + all 10 currently earned worlds | Earned unlocks are never revoked |
| Statistics, achievements, share card | Free |

Guardrails the brief sets, restated as enforced rules: no ads inside focus sessions, no advertising at all in the current design, no selling of personal data, no fragmentation of essential functionality into paid add-ons, and no artificial restriction of basic offline use to push registration.

### 2.1 Free with a free account — synchronisation [APPROVED]

| Free, with an account (no payment) | Notes |
|---|---|
| Two-way synchronisation of tasks and the approved record set | The reason to register, not a product to buy |
| Restore on a new device | Same mechanism, no separate SKU |
| Book metadata and reading-progress continuity (title, page count, page position, completed pages, per-day counters, goal) | PDF files themselves stay on the device — see `SYNC_AND_DATA_STRATEGY.md` §5.3 |
| Offline queueing with sync on reconnect | An account is never a network dependency for local work |

Classification: this is **account functionality**, not a paid tier. Concretely, the product catalogue must contain no sync product, no "sync trial", no paid device limit, and no copy that suggests data continuity is premium. Cross-device sync therefore leaves the Plus table in §3 entirely.

---

## 3. Daftarche Plus (subscription — proposal)

Synchronisation is free (§2.1), so Plus must sell **depth and analysis** — never permission to be productive and never continuity of the user's own data:

| Candidate Plus benefit | Why it could be a fair paid boundary | Status |
|---|---|---|
| Long-range analysis across terms and years, over whatever history an account holds once OD-05 settles what that is — focus history is **not** in the approved Sync scope today | Analysis carries an ongoing compute cost; it gates no record the user owns | **Pending owner decision** (OD-05) |
| Deeper insights: term-level and cross-subject comparisons | Same reasoning | **Pending** (OD-16) |
| Early access to new worlds and packs | Perceived value without removing anything already earned | **Pending** (OD-14) |

Nothing in this table is approved. It records candidates so the owner has something concrete to accept or reject.

Three things are deliberately **absent**: synchronisation, restore on a new device, and data export. The first two are free with every account; export is free because charging for the user's own data would contradict the local-first promise (§3.2).

**Retention and analysis are separate questions.** A decision might keep every session free and sell only the analysis computed over it, or sell neither, or cap retention at the local limit for everyone. What is *not* open: synchronising history is never a paid feature, and no option may take a record the user already has away from them. The retention cap, the storage cost and the Plus boundary are OD-05.

Until OD-05 is decided, focus history is neither synchronised nor migrated (`SYNC_AND_DATA_STRATEGY.md` §5.2), so no Plus analysis may be described as running on history the account already holds.

Not a Plus benefit, by decision: synchronisation, restore on a new device, data export, and any form of data continuity or backup of records the account already holds.

### 3.1 Sync pricing — decided, not open [APPROVED]

Synchronisation is free for every registered account. The previously considered alternative (sync as a Plus benefit) is recorded as rejected and must not resurface in a price table, a store listing or an upsell screen:

| Rejected option | Why it was rejected |
|---|---|
| Sync as a Plus benefit | Double gate (account *and* payment) in a low-ARPU market; the local single-device product is already complete, so a paywall in front of continuity has no urgency; and it would shrink the account base that purchases, restore and measurement all depend on |

The strategic consequence is that **the account, not the subscription, is the conversion event.** Plus must be justified by analysis and depth that a free account genuinely cannot provide, and by new content — never by withholding the user's own data from their second device.

### 3.2 Export should not be paywalled
Charging for the user's own data export would contradict the local-first promise and invite justified criticism. Keep export free; make Plus about the service, not about unlocking the exit.

---

## 4. One-time purchases (proposal)

| Product | What it is | Notes |
|---|---|---|
| Premium theme pack | A set of new themes, not achievement rewards | Must be visually distinct from earned worlds; no Today-card functionality locked behind it unless the card is also sold as part of the pack |
| World / visual pack | A new world with its Today card | The strongest one-time product the app can sell, because worlds already have a proven interaction pattern |
| Character / personalisation pack | Additional avatars and character art for the profile | Cheap to produce from the existing art pipeline (`assets/characters/`, `scripts/generate-character.py`) |
| Reading pack (optional) | Extra reader tooling — e.g. more highlight colours, export of annotations as a document | Requires reader work; evaluate after sync |

Rules:
- A pack is a **permanent entitlement**, restorable on any device tied to the account.
- A pack never removes something a user already has.
- Bundle pricing (pack + Plus) must not create a situation where a subscription lapse deletes a purchased pack. Purchased permanence survives subscription expiry.

---

## 5. Entitlement architecture (proposal)

### 5.1 Data model

```
product(id, kind: 'pack'|'subscription', sku_by_channel{web,bazaar}, name, active)
entitlement(id, userId, productId, source: 'bazaar'|'web'|'grant',
            grantedAt, expiresAt|null, state: 'active'|'expired'|'revoked',
            receiptRef, channelOrderId)
receipt(id, userId, productId, channel, rawPayload (server-only), verifiedAt, verifierResult)
```

### 5.2 Principles
1. **Server-authoritative.** The client never mints an entitlement. It renders a cached snapshot with a fetch timestamp and a grace window.
2. **Account-bound, not device-bound.** A purchase on web must unlock on Android; that is the whole point of introducing accounts before payments.
3. **Idempotent grants.** A repeated verification callback must not create a second entitlement (unique on `channelOrderId`).
4. **Permanent vs. expiring.** Packs never expire. Subscriptions carry `expiresAt` and a state machine (`active → expired → revoked`), never deletion.
5. **Downgrade is cosmetic, not destructive.** On expiry or offline-unverifiable state, the app returns to the default theme but keeps all data and the entitlement row.
6. **Client-side enforcement is a UI convenience only.** A locked theme hidden by CSS is not security; the *content* of a paid theme is CSS tokens, which are shipped. Accept this: the practical protection is that themes are small cosmetic assets, and the enforcement that matters is server-side for anything substantive (entitlement checks, abuse limits). Sync itself is free and is not metered by plan.

### 5.3 Verification flow (both channels)

```
purchase → channel SDK returns a purchase token / order id
        → client POSTs token to our backend with the session
        → backend verifies with the channel's server API (never trusting the client)
        → backend writes receipt + entitlement (idempotent)
        → backend returns the entitlement snapshot
        → client caches and applies
```

### 5.4 Restore purchases
- Store-channel restores are the store's responsibility for non-consumables/subscriptions; our backend must also expose `GET /entitlements` so a signed-in user on any device sees the same state.
- A "restore" action in settings should: refresh entitlements from the server, then ask the channel for a restore where the channel supports it.

### 5.5 Expiry, grace and refunds
| Event | Behaviour |
|---|---|
| Subscription expires | Entitlement state `expired`; Plus features stop; data retained; purchased packs unaffected |
| Verification unreachable offline | Last snapshot honoured for a grace window (proposal: 7 days for subscription, unlimited for packs) |
| Refund / chargeback | State `revoked`; the feature is withdrawn at the next verification; **user data is never deleted** |
| Account deletion | Entitlements deleted with the account; store-side purchase records remain with the store. What happens on re-registration is unresolved and is specified as options in §5.6 |

### 5.6 Permanent purchases after account deletion and recreation (UNRESOLVED)

A one-time pack is permanent, but permanence is currently anchored to an account row. Deleting the account deletes the entitlement (§5.5) while the store's own purchase record survives. What happens on re-registration is **not decided** and must be settled before the first paid release:

| Option | Effect | Risk |
|---|---|---|
| **A. Automatic restore on re-registration** | The channel's restore returns the purchase; the backend re-verifies and re-grants it | Needs a verified server-side restore and a stable account identity; on a shared device store account it could hand the purchase to a different person |
| **B. Support-assisted restore** | The user supplies the order id; an operator re-grants | Safe, but slow, and it makes "permanent" feel conditional |
| **C. Deletion forfeits the purchase** | Simplest to build | Contradicts the permanence promise and invites refund demand; **not recommended** |

Non-negotiables whichever option is chosen: a subscription lapse never revokes a purchased pack; a revoked entitlement (refund or chargeback) never deletes user data; and the account-deletion screen must state plainly whether purchases are recoverable and by what route.

### 5.7 Entitlement state on the client
```
entitlements = { fetchedAt, graceUntil, items: [{ productId, state, expiresAt }] }
```
Consumed by the theme picker and the reader, replacing/extending the achievement check in `js/theme.js` `isThemeUnlocked` — which currently has a single source of truth (achievements). It must become: `unlockedByAchievement(key) || entitled(productForKey)`, and the birthday/QA paths must keep working (`QA_UNLOCK_ALL_THEMES` exists and should stay test-only).

---

## 6. Guest purchase flow (the intended flow, evaluated)

The brief specifies:

> Guest → selects premium product → account registration/sign-in → purchase → server-side entitlement verification → product activation

### 6.1 Assessment: implementable, with three hard prerequisites

| Prerequisite | Why it is hard | Current state |
|---|---|---|
| Registration must not feel like a bait-and-switch at the paywall | The user must understand before tapping "buy" that an account is required | No account UI exists |
| The guest's local data must migrate **before** or **with** the purchase | Otherwise a user buys Plus and lands in an empty account, or a user with data gets two identities | Migration flow does not exist (`SYNC_AND_DATA_STRATEGY.md` §7) |
| The gift must survive a failed payment | Network failure mid-purchase must not lock the product or corrupt state | No transaction state machine exists |

### 6.2 Recommended flow (safe variant)

```
1. Guest taps a locked premium item.
2. Sheet explains: what the item is, that an account is required, and that
   existing local data will be kept and attached to the account.
3. Sign-up / sign-in.
4. Guest-to-account migration runs automatically (visible progress, resumable,
   local data never deleted).  ← must complete, or the purchase is blocked with
   a clear reason.
5. Purchase screen: price from the server catalogue, not hard-coded in the client.
6. Channel purchase (store billing in the Android build, web gateway in the browser).
7. Server verification; entitlement written.
8. Item activates; the app returns to where the user was, with the item applied.
9. If verification is slow: show "finishing your purchase" and allow leaving;
   the entitlement appears on next refresh. Never charge twice.
```

### 6.3 Why migration must precede purchase
An alternative ordering (buy first, migrate later) creates an account with an entitlement and no data, then a second migration; if migration fails, the user has paid for an empty notebook and will contact support. Migration-first is slower but is the only ordering that cannot produce a paid, empty account.

---

## 7. Iranian payment ecosystem — operational implications

Findings from public provider documentation (verified during this audit, sources listed). **No provider is selected; all of this needs product-owner and legal confirmation.**

### 7.1 Google Play is not a viable channel for Iran-resident developers
Current guidance states there is no official way for developers residing in Iran to register a Play Console account or publish, due to sanctions; Play's own policy also requires Play Billing for in-app digital purchases where Play applies. Practical consequence: **the Android build's purchases should be planned around Iranian stores, not Play Billing.** Source: Google Play Developer Community answer (June 2026) and the Play Developer Program Policy, *Payments* section.

### 7.2 Cafe Bazaar provides a full in-app billing channel
- **In-App Billing v3 API** with product types managed in-app products and **subscriptions**; non-consumable purchases are restorable after reinstall (Bazaar stores them), consumables are not.
- **Server-side signature verification is the documented security requirement**, and a `developer payload` string is returned with the purchase — the documented way to bind a purchase to a specific user. This maps exactly onto the entitlement model in §5.
- A **Developer REST API** exists for validating purchases and subscriptions from a backend, plus subscription cancellation handling.
- **Policy constraint that shapes the whole design:** Bazaar's payment rules state that unlocking internal features, full content access or credits must be done **through Bazaar's payment channel**, and parallel channels are not accepted.

Sources: `developers.cafebazaar.ir/en/guidelines/in-app-billing/{intro,security,api,faq}` and `.../app-publish-guidelines/rules/payment`.

**Implication:** inside a Bazaar-distributed build, selling Plus or packs through a web gateway is likely a policy violation. The architecture therefore needs **two purchase channels behind one entitlement store**, not one universal checkout:
- Android (Bazaar build): Bazaar IAB → server verification via Bazaar's validation API.
- Web (browser): an Iranian card gateway, e.g. ZarinPal, whose REST gateway takes `merchant_id`, `amount`, `callback_url` and supports server-side transaction verification.

Sources: `zarinpal.com/docs/paymentGateway/connectToGateway`, `zarinpal.com/docs/paymentGateway`.

### 7.3 Consequences for the client
| Consequence | Detail |
|---|---|
| Price display differs per channel | Prices come from the server catalogue per channel, never hard-coded |
| Web purchases in the Android WebView must be avoided | A Bazaar build opening an external checkout for digital goods is a policy risk; gate web checkout to non-store builds |
| No international cards | Subscription renewal must rely on the channel; do not build card-on-file logic |
| Store review latency | New products need store-side configuration; plan catalogue changes as a release activity |
| Currency | Toman vs rial confusion is a real support cost — store the channel currency and display one unit consistently |
| Tax/invoicing | VAT treatment and invoicing obligations for digital subscriptions require local professional advice; **not determined here** |

### 7.4 Regional hosting question (blocking for the backend)
Whether foreign managed backends and foreign card billing are usable from Iran must be verified before choosing a backend provider. This is the reason `TARGET_ARCHITECTURE.md` §6 recommends a **provider-neutral REST service over Postgres** that can be hosted domestically: it keeps the payment and hosting region decisions reversible.

---

## 8. Monetization risks

| Risk | Severity | Mitigation |
|---|---|---|
| Selling what users already earned | High (trust) | Never paywall existing worlds; sell only new content |
| Double gate (account + payment) killing conversion | High (revenue) | **Decided:** sync is free with an account; Plus sells depth only |
| Plus failing to justify itself once sync is free | High (revenue) | Every Plus row in §3 must be a capability a free account cannot do at all, not a limit removed |
| Purchase on web not recognised in the Android build | High (support load) | One server-side entitlement store, both channels write to it |
| Bazaar policy conflict with external checkout | High (store rejection) | Channel-specific checkout; no web checkout in the store build |
| Refund handling that removes user data | High (trust) | Revoke entitlement only; never delete data |
| Subscription lapse during an offline period | Medium | Grace window; graceful degrade to default theme |
| Server storage cost of synced records (tasks, book metadata, activity) | Medium | Bounded by record count and payload caps; PDF storage is not a cost because PDF binaries are never uploaded |
| Minors making purchases | Medium (legal) | Age/parental-consent question is unresolved — see `PRIVACY_AND_ANALYTICS_POLICY.md` §8 |
| Support burden of "I paid and see nothing" | Medium | Visible entitlement status screen, server-side audit trail per order id |
| Price chosen before evidence | Medium | Ship free analytics (opt-in) first; do not fix prices in this audit |

---

## 9. Recommended sequencing

1. Foundation + account + migration + sync (Phases 1–2 of the backlog). Without these, purchases cannot be attached to anything durable.
2. Entitlement service and cached client state, with a test product granted manually — proves the plumbing before money moves.
3. One low-risk one-time product (a theme pack) on one channel (the Android store build) to validate the whole loop end to end.
4. Subscription only after one-time purchases work, because renewal, expiry and refund paths are materially harder.
5. Web checkout last, and only outside store builds.

---

## 10. Decisions required from the product owner

Settled: sync is free for every registered account (§3.1); PDF binaries are never uploaded, so there is no cloud PDF storage product to price.

Still open — each is tracked in the register at `PRODUCT_MATURITY_AUDIT.md` §10 (OD-xx):

1. Which store(s) ship the Android build, and does the product accept channel-specific checkouts? (OD-13)
2. Is a Plus subscription launched at all in the first monetized release, or do one-time packs ship first?
3. What happens to entitlements when an account is deleted and later re-created?
4. Target price band, to be decided only after opt-in measurement exists.
5. Which Plus benefits survive scrutiny as genuinely unreachable on a free account once sync, restore and export are free.
