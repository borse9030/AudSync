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

export interface PlaybackState {
  state: 'playing' | 'paused';
  trackId: string | null;
  position: number;
  timestamp: number;
  startTimeMs?: number;
  startedBy?: string;
}

export interface Device {
  uid: string;
  name: string;
  lastSeen: number;
  isHost: boolean;
}

export interface Room {
  hostId: string;
  createdAt: number;
  playback: PlaybackState;
  playlist: Record<string, Track>;
  devices: Record<string, Device>;
}
