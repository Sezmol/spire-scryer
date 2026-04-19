# Privacy Policy — Spire Scryer

_Last updated: April 19, 2026_

Spire Scryer ("the Extension") is a Twitch Extension that displays the streamer's current Slay the Spire 2 game state (deck, relics, potions, combat piles) as an overlay on their stream.

## 1. Data We Collect

The Extension processes the following data:

- **Twitch Channel ID** — obtained from the Twitch Extension Helper (`onAuthorized`) to identify which channel's game state to display.
- **Anonymous viewer opaque ID** — provided by Twitch. Not tied to your Twitch account by us.
- **Game state** — deck composition, relics, potions, combat piles, HP, gold, floor, ascension level, powers. Sent from the streamer's installed game mod through our backend to viewers.

We do **not** collect:

- Real names, emails, passwords, or payment information
- IP addresses (beyond transient routing by Cloudflare/Twitch)
- Chat messages or any Twitch account details beyond the channel ID
- Any data from viewers other than Twitch's opaque identifiers

## 2. How Data Is Used

- **Channel ID** is used to route PubSub broadcasts to the correct channel.
- **Game state** is broadcast in real time to viewers of the channel. It is transient: the latest payload is kept in short-term storage (Cloudflare KV) for up to 5 minutes as a fallback for late-joining viewers, then automatically expired.

## 3. Data Sharing

We do not sell or share data with third parties. Data passes through:

- **Cloudflare Workers** (EBS hosting) — subject to Cloudflare's privacy policy
- **Twitch PubSub** — subject to Twitch's privacy policy

## 4. Data Retention

- Game state in KV: maximum 5 minutes (automatic expiration)
- No long-term storage, analytics, or logs of personal data

## 5. Children's Privacy

The Extension does not knowingly collect data from users under 13.

## 6. Changes

We may update this policy. Changes will be posted at this URL with an updated "Last updated" date.

## 7. Contact

Questions or concerns: **etho4556@gmail.com**
