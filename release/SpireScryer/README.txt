SPIRE SCRYER
============

Twitch-integrated overlay mod for Slay the Spire 2.
Shows your deck, relics, potions and combat piles to viewers in real time.

Inspired by "Slay the Relics" for the original Slay the Spire.


WHAT IT DOES
------------

- Local HTTP API on port 15555 that exports current game state as JSON.
- Optional: push game state to Twitch so viewers see an overlay on your stream
  (requires the Spire Scryer Twitch Extension installed on your channel).


INSTALL
-------

1. Locate your StS2 install folder. For Steam:
     C:\Program Files (x86)\Steam\steamapps\common\Slay the Spire 2\mods\
   (Or: right-click the game in Steam → Manage → Browse local files → open "mods" folder.)

   If the "mods" folder does not exist, create it.

2. Copy the "SpireScryer" folder from this archive into the mods folder.
   You should end up with:
     ...\Slay the Spire 2\mods\SpireScryer\SpireScryer.dll
     ...\Slay the Spire 2\mods\SpireScryer\SpireScryer.json

3. Launch Slay the Spire 2. The mod loads automatically.

4. (Optional) Local overlay check:
   Open http://localhost:15555/state?token=YOUR_TOKEN in a browser.
   Your token is saved to:
     %APPDATA%\MegaCrit\SlayTheSpire2\spirescryer_token.txt


TWITCH INTEGRATION (OPTIONAL)
-----------------------------

To let your Twitch viewers see the overlay:

1. Install the Spire Scryer Extension on your Twitch channel
   (Twitch Dashboard → Extensions → Search "Spire Scryer").

2. Activate it as a Video Overlay.

3. Open the extension's Config view in Twitch Dashboard.
   Click "Generate New Secret" — it prints a ready-to-use config block
   (EBS_URL, MOD_SECRET, CHANNEL_ID already filled in).

4. Create file spirescryer_config.txt in
     %APPDATA%\MegaCrit\SlayTheSpire2\
   and paste the block from step 3.

5. Restart the game. The mod will start pushing state to Twitch.


DATA & PRIVACY
--------------

Game state pushed to Twitch is transient (not logged, not stored long-term).
Privacy Policy: https://sezmol.github.io/spire-scryer-docs/privacy
Terms of Service: https://sezmol.github.io/spire-scryer-docs/terms


SERVICE LIMITATIONS
-------------------

The EBS (relay service between your game and your Twitch viewers) is hosted
on Cloudflare's free tier. Under heavy aggregate load across all streamers
(many hundreds of viewers or dozens of concurrent broadcasters), it may
degrade or temporarily stop pushing updates. The mod will keep retrying
automatically; no action is needed on your side.

This is a best-effort hobby service with no uptime guarantee.


TROUBLESHOOTING
---------------

Mod log file:
  %APPDATA%\MegaCrit\SlayTheSpire2\spirescryer.log

- Log file missing: check that Slay the Spire 2 has write access
  to %APPDATA%\MegaCrit\SlayTheSpire2\.

- Localhost API not responding: another app may be using port 15555. Close it
  or let me know in Nexus comments.

- Twitch overlay shows nothing:
   a) Check spirescryer.log — look for "Twitch EBS push enabled".
   b) Check spirescryer_config.txt — all three values set?
   c) Check that the Extension is Active (not just Installed) on your channel.


CONTACT
-------

Bugs, feature requests: Nexus comments or etho4556@gmail.com

Unofficial mod. Slay the Spire 2 is © Mega Crit.
