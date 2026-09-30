export interface DiscordOccurrence {
  messageId: string;
  messageUrl: string;
  author: string;
  postedAt: string;
  reactionCount: number;
  reactions: Record<string, number>;
}

export interface Clip {
  id: string;
  url: string;
  title?: string;
  uploader?: string;
  uploadDate?: string;
  duration?: number;
  viewCount?: number;
  likeCount?: number;
  commentCount?: number;
  thumbnail?: string;
  originalVideoUrl?: string;
  extractor?: string;
  occurrences: DiscordOccurrence[];
  discordReactions: number;
  score: number;
  metadataStatus: 'pending' | 'ok' | 'failed';
  metadataError?: string;
  downloadStatus: 'pending' | 'downloaded' | 'failed';
  downloadError?: string;
  downloadPath?: string;
  updatedAt: string;
}

export type ReviewSort = 'manual' | 'score' | 'views' | 'likes' | 'reactions' | 'chrono' | 'random';

export interface ReviewState {
  order: string[];
  selected: string[];
  scoreOverrides: Record<string, number>;
  sortMode: ReviewSort;
  initialized: boolean;
  updatedAt: string;
}
