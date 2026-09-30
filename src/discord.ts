import 'dotenv/config';
import { Client, GatewayIntentBits, Partials } from 'discord.js';
import type { Clip, DiscordOccurrence } from './types.js';
import { ensureDirs, loadClips, saveClips, writeClipsCsv, YEAR } from './store.js';
import { updateScores } from './scoring.js';

const URL_RE = /https?:\/\/(?:www\.)?medal\.tv\/[^\s<>\])}"']+/gi;
const cleanUrl = (value: string) => value.replace(/[.,!?;:]+$/, '');

function medalUrls(value: string): string[] {
  return [...value.matchAll(URL_RE)].map((match) => cleanUrl(match[0])).filter((url) => {
    try { return new URL(url).hostname.toLowerCase().endsWith('medal.tv') && /\/clips?\//i.test(new URL(url).pathname); }
    catch { return false; }
  });
}

function clipId(value: string): string | undefined {
  try {
    const url = new URL(value);
    const parts = url.pathname.split('/').filter(Boolean);
    const index = parts.findIndex((part) => part.toLowerCase() === 'clips' || part.toLowerCase() === 'clip');
    if (index < 0 || !parts[index + 1]) return;
    return decodeURIComponent(parts[index + 1]).replace(/[^a-zA-Z0-9_-]/g, '');
  } catch { return; }
}

function messageText(message: { content: string; embeds: readonly any[]; attachments: { values(): Iterable<any> } }) {
  const parts = [message.content];
  for (const embed of message.embeds) {
    parts.push(embed.url, embed.title, embed.description, embed.author?.url, embed.image?.url, embed.thumbnail?.url, embed.video?.url, embed.footer?.text, embed.provider?.name);
    for (const field of embed.fields || []) parts.push(field.name, field.value);
  }
  for (const attachment of message.attachments.values()) {
    parts.push(attachment.url, attachment.proxyURL, attachment.name);
  }
  return parts.filter(Boolean).join('\n');
}

export async function scanDiscord() {
  await ensureDirs();
  const token = process.env.DISCORD_BOT_TOKEN;
  const guildId = process.env.DISCORD_GUILD_ID;
  const channelId = process.env.DISCORD_CHANNEL_ID;
  if (!token || !guildId || !channelId) throw new Error('Set DISCORD_BOT_TOKEN, DISCORD_GUILD_ID, and DISCORD_CHANNEL_ID in .env.');

  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent], partials: [Partials.Channel] });
  try {
    await client.login(token);
    const guild = await client.guilds.fetch(guildId);
    const channel = await guild.channels.fetch(channelId);
    if (!channel || !channel.isTextBased() || !('messages' in channel)) throw new Error('Configured channel was not found or is not a readable text channel.');
    const lowerBound = new Date(Date.UTC(YEAR, 0, 1));
    const upperBound = new Date(Date.UTC(YEAR + 1, 0, 1));
    const found = new Map((await loadClips()).map((clip) => [clip.id, clip]));
    let before: string | undefined;
    let scanned = 0;
    let done = false;
    while (!done) {
      const page = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
      if (!page.size) break;
      for (const message of page.values()) {
        const created = message.createdAt;
        if (created < lowerBound) { done = true; break; }
        if (created >= upperBound) continue;
        scanned++;
        const urls = [...new Set(medalUrls(messageText(message)))];
        for (const url of urls) {
          const id = clipId(url);
          if (!id) continue;
          const reactions: Record<string, number> = {};
          for (const reaction of message.reactions.cache.values()) {
            const emoji = reaction.emoji.id ? `${reaction.emoji.name}:${reaction.emoji.id}` : reaction.emoji.name || 'unknown';
            reactions[emoji] = reaction.count ?? 0;
          }
          const occurrence: DiscordOccurrence = {
            messageId: message.id,
            messageUrl: message.url,
            author: message.member?.displayName || message.author.globalName || message.author.username,
            postedAt: created.toISOString(),
            reactionCount: Object.values(reactions).reduce((sum, count) => sum + count, 0),
            reactions,
          };
          const existing = found.get(id);
          if (existing) {
            existing.url = url;
            existing.occurrences = [...existing.occurrences.filter((item) => item.messageId !== message.id), occurrence].sort((a, b) => a.postedAt.localeCompare(b.postedAt));
            existing.discordReactions = existing.occurrences.reduce((sum, item) => sum + item.reactionCount, 0);
            existing.updatedAt = new Date().toISOString();
          } else {
            found.set(id, { id, url, occurrences: [occurrence], discordReactions: occurrence.reactionCount, score: 0, metadataStatus: 'pending', downloadStatus: 'pending', updatedAt: new Date().toISOString() });
          }
        }
      }
      before = page.last()?.id;
      console.log(`Scanned ${scanned} messages in ${YEAR}; found ${found.size} unique clips.`);
      await updateScores([...found.values()]);
      await saveClips([...found.values()].sort((a, b) => a.id.localeCompare(b.id)));
      if (page.size < 100) break;
    }
    await updateScores([...found.values()]);
    await saveClips([...found.values()].sort((a, b) => a.id.localeCompare(b.id)));
    await writeClipsCsv([...found.values()].sort((a, b) => a.id.localeCompare(b.id)));
    console.log(`Discord scan complete: ${scanned} messages in ${YEAR}, ${found.size} unique Medal clips.`);
    console.log('If Discord returns no messages, confirm the bot can view the channel, has Read Message History, and Message Content intent is enabled in the Developer Portal.');
  } finally {
    client.destroy();
  }
}
