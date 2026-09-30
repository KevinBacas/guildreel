# GuildReel

Turn the Medal.tv clips shared in a Discord channel into a yearly gaming montage. GuildReel scans channel history, collects clip details, lets you select and order clips in a local browser, then renders a video with FFmpeg. Each step can be rerun safely.

## Quickstart

1. [Create a Discord bot](#create-the-discord-bot) and invite it to the server that contains the channel.
2. Install the [requirements](#requirements), then clone this repository.
3. Run `cp .env.example .env` and fill in the bot token, server ID, channel ID and target year.
4. Run `npm ci`, followed by `npm run scan`, `npm run metadata` and `npm run download`.
5. Run `npm run review`, open `http://127.0.0.1:4173`, review the selection, then click **Render Best Of** or run `npm run render`.

The result is `output/best-of-YYYY.mp4`, where `YYYY` is `DISCORD_YEAR`.

## Requirements

- Node.js 20.19+ or 22.12+
- A Discord bot in the server, with **View Channel** and **Read Message History** for the configured channel
- The **Message Content Intent** enabled for the bot in the Discord Developer Portal
- `yt-dlp` on your PATH (or set `YT_DLP_PATH`)
- FFmpeg and ffprobe on your PATH (or set `FFMPEG_PATH` and `FFPROBE_PATH`)

On macOS with Homebrew, the media tools can be installed with `brew install yt-dlp ffmpeg`.

The bot only reads channel history. It does not need Administrator, Manage Messages, or a user token; it sends or modifies no messages.

## Create the Discord bot

1. Open the [Discord Developer Portal](https://discord.com/developers/applications), choose **New Application**, and give it a name.
2. On the **Bot** page, copy the bot token (or reset it to obtain a new one). Put it in `DISCORD_BOT_TOKEN` in `.env`. Keep it secret.
3. On that same page, enable **Message Content Intent** under **Privileged Gateway Intents**. GuildReel reads message text and embeds to find Medal links. Larger verified bots may need Discord approval for this intent.
4. On **Installation**, enable installation to a server (**Guild Install**). Include the `bot` scope and select only **View Channels** and **Read Message History** as bot permissions. Use the installation link to add the bot to your server. If the channel has custom permissions, allow the bot to view it and read its history there too.
5. In Discord, enable **Developer Mode** in **User Settings → Advanced**, then right-click the server and the target channel to copy their IDs. Put them in `DISCORD_GUILD_ID` and `DISCORD_CHANNEL_ID` in `.env`.

You must have permission to add apps to that server. The bot connects only while `npm run scan` runs. See Discord's [bot authorization documentation](https://discord.com/developers/docs/topics/oauth2#bot-authorization-flow) and [Message Content Intent guidance](https://support-dev.discord.com/hc/en-us/articles/6207308062871-What-are-Privileged-Intents) for details.

## Setup

1. Copy `.env.example` to `.env` and fill in `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, `DISCORD_CHANNEL_ID`, and `DISCORD_YEAR`.
2. Run `npm ci`.
3. Confirm `yt-dlp --version`, `ffmpeg -version`, and `ffprobe -version` work in the same terminal.

Example environment options:

```dotenv
DISCORD_YEAR=2025
MAX_CLIPS_PER_UPLOADER=5
DOWNLOAD_CONCURRENCY=2
```

Set `MAX_CLIPS_PER_UPLOADER=0` to disable the initial selection diversity cap. The cap is applied to the initial top-score selection; every clip remains available for manual selection. Add, remove, or reweight terms in `config/scoring.json` to change the score without editing application code.

## Workflow

```sh
npm run scan       # Page through channel history and save Medal links for DISCORD_YEAR
npm run metadata   # Use yt-dlp's MedalTV extractor to read clip metadata
npm run download   # Download clips that do not already exist locally
npm run review     # Open http://127.0.0.1:4173 for review and selection
npm run render     # Create output/best-of-YYYY.mp4 and ranked clip manifests
```

`npm run dev` is an alias for `npm run review`. The sort menu controls both the clip cards and the final video order; by default, the renderer uses combined score from highest to lowest. Choose **Custom drag order** to arrange clips manually. The review page can also play locally downloaded clips, search Medal players and Discord posters, sort by views/likes/reactions/date/random, edit scores, and save its selection locally. Its **Render Best Of** button starts the same render command.

The separate steps are resumable. Discord scans save progress after each page; Medal metadata and download outcomes are recorded per clip; existing download files are reused; failed items can be retried with the same command. Failed or private Medal clips remain in the metadata with an error status. A rerun of `scan` refreshes seen Discord occurrences while preserving existing clip metadata and download state.

## Local files

- `data/clips.json` and `data/clips.csv`: source metadata, Discord message occurrences and reaction breakdowns, download state, score
- `data/review.json`: saved custom order, enabled clips and manual score overrides
- `downloads/`: original yt-dlp downloads
- `cache/`: reusable normalized render segments and temporary files
- `output/best-of-YYYY.mp4`, `output/best-of-YYYY-clips.csv`, `output/best-of-YYYY-clips.json`: final render and ranked manifest

Dates are interpreted in UTC: from the start of January 1 through the end of December 31 for `DISCORD_YEAR`. Discord API access and Medal availability depend on the bot's channel access and the clips remaining public. If the bot returns no channel messages, check the channel permissions and Message Content Intent. Rendering concatenates clips in the saved order, using 1920×1080 H.264 at 60 fps with aspect-ratio-preserving black padding and AAC audio normalized to a consistent level. A small title-and-date popup appears at the start of each clip; it contains no view or reaction statistics. Normalized segments are cached; the downloaded source files remain intact. See [docs/PROCESS.md](docs/PROCESS.md) for the internal workflow.
