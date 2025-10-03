import { Timestamp } from 'firebase/firestore';

export interface Track {
  id: string;
  storagePath: string;
  title: string;
  artist: string;
  duration: number;
  metadata?: {
    description: string;
    genres: string[];
    mood: string;
    key: string;
    tempo: number;
  };
}

export type PlaybackSource = 'file' | 'youtube';

export interface PlaybackState {
  state: 'playing' | 'paused';
  source: PlaybackSource;
  trackId: string | null;
  youtubeVideoId: string | null;
  trackTitle: string | null;
  artist: string | null;
  position: number;
  timestamp: Timestamp;
}

export interface Device {
  uid: string;
  name: string;
  lastSeen: Timestamp;
  isHost: boolean;
}

export interface Room {
  hostId: string;
  createdAt: Timestamp;
  playback: PlaybackState;
  devices: Record<string, Device>;
  volume?: number;
}

    