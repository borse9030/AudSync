"use client";

import { useState, useEffect, useRef, useCallback } from 'react';
import { getAuth, onAuthStateChanged, User } from 'firebase/auth';
import { getDatabase, ref, onValue, onDisconnect, set, serverTimestamp, goOffline, goOnline } from 'firebase/database';
import { app } from '@/lib/firebase';
import type { Room, Device, PlaybackState, Track } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useRouter } from 'next/navigation';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Music, Users, ListMusic, Crown } from 'lucide-react';

// A mock audio file. In a real app, this would come from user uploads.
const MOCK_TRACK: Track = {
  id: 'mock-track-1',
  title: 'Ambient Gold',
  artist: 'Orion',
  duration: 180,
  storagePath: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
};


export default function RoomPage({ roomId, initialRoomData }: { roomId: string; initialRoomData: Room | null }) {
  const [room, setRoom] = useState<Room | null>(initialRoomData);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isHost, setIsHost] = useState(false);
  const [serverOffset, setServerOffset] = useState(0);
  const [audioReady, setAudioReady] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [deviceName, setDeviceName] = useState('');
  
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const driftCorrectionTimer = useRef<NodeJS.Timeout | null>(null);
  const syncInterval = useRef<NodeJS.Timeout | null>(null);

  const { toast } = useToast();
  const router = useRouter();

  const getServerNow = useCallback(() => Date.now() + serverOffset, [serverOffset]);

  // Auth and Initial Connection
  useEffect(() => {
    const auth = getAuth(app);
    const db = getDatabase(app);

    const authUnsubscribe = onAuthStateChanged(auth, user => {
      if (user) {
        setCurrentUser(user);
        goOnline(db);

        const offsetRef = ref(db, '.info/serverTimeOffset');
        onValue(offsetRef, snap => setServerOffset(snap.val() || 0));

        const deviceNameFromStorage = localStorage.getItem('audsync_device_name') || `Device ${Math.random().toString(36).substring(2, 6)}`;
        setDeviceName(deviceNameFromStorage);
        
        const presenceRef = ref(db, `rooms/${roomId}/devices/${user.uid}`);
        onDisconnect(presenceRef).remove();

        setIsLoading(false);
      } else {
        router.push('/');
      }
    });
    
    return () => {
        authUnsubscribe();
        goOffline(db);
    };
  }, [roomId, router]);

  // Room data listener
  useEffect(() => {
    if (!currentUser) return;

    const db = getDatabase(app);
    const roomRef = ref(db, `rooms/${roomId}`);

    const roomUnsubscribe = onValue(roomRef, (snapshot) => {
      if (snapshot.exists()) {
        const roomData = snapshot.val() as Room;
        setRoom(roomData);
        setIsHost(roomData.hostId === currentUser.uid);

        // Set initial device presence
        const presenceRef = ref(db, `rooms/${roomId}/devices/${currentUser.uid}`);
        set(presenceRef, {
            uid: currentUser.uid,
            name: deviceName,
            lastSeen: serverTimestamp(),
            isHost: roomData.hostId === currentUser.uid,
        });

      } else {
        toast({
          variant: 'destructive',
          title: 'Room disconnected',
          description: 'This room no longer exists.',
        });
        router.push('/');
      }
    });

    return () => roomUnsubscribe();
  }, [currentUser, deviceName, roomId, router, toast]);

  // Playback sync logic
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !room?.playback) return;

    const { state, position, trackId, startTimeMs } = room.playback;

    if (state === 'playing') {
      if (audio.src.includes(trackId || '')) {
         if (startTimeMs) {
            const timeUntilStart = startTimeMs - getServerNow();
            if (timeUntilStart > 50) { // Schedule playback
                audio.currentTime = position;
                if(audio.paused) {
                    setTimeout(() => audio.play().catch(e => console.warn("Autoplay failed", e)), timeUntilStart);
                }
            } else { // Correct position for late joiners
                const expectedPosition = position + (getServerNow() - startTimeMs) / 1000;
                audio.currentTime = expectedPosition;
                if (audio.paused) audio.play().catch(e => console.warn("Autoplay failed", e));
            }
         }
      } else if(trackId) {
        const currentTrack = room.playlist[trackId];
        if (currentTrack) {
          audio.src = currentTrack.storagePath;
          audio.load();
          audio.addEventListener('canplay', () => {
             // Re-run this effect once canplay is fired
          }, { once: true });
        }
      }
    } else { // paused
      if (!audio.paused) {
        audio.pause();
      }
      if (Math.abs(audio.currentTime - position) > 0.5) {
        audio.currentTime = position;
      }
    }
  }, [room?.playback, audioReady, getServerNow]);
  
  // Drift correction logic
  useEffect(() => {
    const audio = audioRef.current;
    if (driftCorrectionTimer.current) clearTimeout(driftCorrectionTimer.current);
    if (!audio || !isHost) return;

    if (room?.playback.state === 'playing') {
        syncInterval.current = setInterval(() => {
            const db = getDatabase(app);
            const playbackRef = ref(db, `rooms/${roomId}/playback`);
            set({
                ...room.playback,
                position: audio.currentTime,
                timestamp: serverTimestamp(),
            });
        }, 3000);
    }

    return () => {
        if(syncInterval.current) clearInterval(syncInterval.current);
    }

  }, [isHost, room?.playback, roomId]);


  const handlePlayPause = () => {
    if (!isHost || !room || !currentUser) return;
    const audio = audioRef.current;
    if (!audio) return;

    const db = getDatabase(app);
    const playbackRef = ref(db, `rooms/${roomId}/playback`);

    let newTrackId = room.playback.trackId;
    if (!newTrackId && Object.keys(room.playlist || {}).length > 0) {
      newTrackId = Object.keys(room.playlist)[0];
    } else if (!newTrackId) {
      // Add mock track if playlist is empty
      const playlistRef = ref(db, `rooms/${roomId}/playlist/${MOCK_TRACK.id}`);
      set(playlistRef, MOCK_TRACK);
      newTrackId = MOCK_TRACK.id;
    }


    if (room.playback.state === 'paused') {
      set(playbackRef, {
        state: 'playing',
        trackId: newTrackId,
        position: audio.currentTime,
        timestamp: serverTimestamp(),
        startTimeMs: getServerNow() + 1000, // Schedule 1s in the future
        startedBy: currentUser.uid,
      });
    } else {
      set(playbackRef, {
        ...room.playback,
        state: 'paused',
        position: audio.currentTime,
        timestamp: serverTimestamp(),
      });
    }
  };


  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!isHost || !room || !audioRef.current) return;
    const newPosition = parseFloat(e.target.value);
    audioRef.current.currentTime = newPosition;
    
    const db = getDatabase(app);
    const playbackRef = ref(db, `rooms/${roomId}/playback`);

    set(playbackRef, {
        ...room.playback,
        position: newPosition,
        timestamp: serverTimestamp(),
        startTimeMs: room.playback.state === 'playing' ? getServerNow() + 200 : undefined
    });
  }

  const handleDeviceNameChange = (newName: string) => {
    setDeviceName(newName);
    localStorage.setItem('audsync_device_name', newName);
    if(currentUser) {
        const db = getDatabase(app);
        const deviceRef = ref(db, `rooms/${roomId}/devices/${currentUser.uid}/name`);
        set(deviceRef, newName);
    }
  };


  if (isLoading || !room || !currentUser) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  const currentTrack = room.playback.trackId ? room.playlist?.[room.playback.trackId] : null;

  return (
    <>
      <audio ref={audioRef} />
      <Dialog open={!audioReady} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Ready to Sync?</DialogTitle>
            <DialogDescription>
              A single tap is needed to enable synchronized audio playback in your browser.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
              <Input
                id="name"
                value={deviceName}
                onChange={(e) => handleDeviceNameChange(e.target.value)}
                className="col-span-3"
                placeholder='Enter your device name'
              />
          </div>
          <DialogFooter>
            <Button onClick={() => setAudioReady(true)}>Let's Go</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      <div className="grid md:grid-cols-[1fr_300px] h-full">
        <div className="flex flex-col items-center justify-center p-8 bg-muted/20">
            <div className='text-center'>
                <h2 className="text-3xl font-bold">{currentTrack?.title || 'No track selected'}</h2>
                <p className="text-lg text-muted-foreground">{currentTrack?.artist || 'Select a track to start'}</p>
            </div>
            {isHost && (
                <div className="mt-8 w-full max-w-md">
                    <input
                        type="range"
                        min="0"
                        max={currentTrack?.duration || 100}
                        value={room.playback.position}
                        onChange={handleSeek}
                        className="w-full"
                    />
                    <div className="flex justify-between text-xs text-muted-foreground mt-1">
                        <span>{new Date(room.playback.position * 1000).toISOString().substr(14, 5)}</span>
                        <span>{currentTrack ? new Date(currentTrack.duration * 1000).toISOString().substr(14, 5) : '00:00'}</span>
                    </div>
                </div>
            )}
            {isHost && (
                <div className="mt-4">
                    <Button size="lg" onClick={handlePlayPause}>
                        {room.playback.state === 'playing' ? 'Pause' : 'Play'}
                    </Button>
                </div>
            )}
        </div>
        <div className="border-l bg-card flex flex-col">
            <div className="p-4 border-b">
                <h3 className="font-semibold flex items-center gap-2"><ListMusic/> Playlist</h3>
            </div>
            <div className="flex-1 p-4 overflow-y-auto">
                {room.playlist && Object.values(room.playlist).map(track => (
                    <div key={track.id} className={`p-2 rounded-md ${track.id === currentTrack?.id ? 'bg-primary/20' : ''}`}>
                        <p className="font-semibold">{track.title}</p>
                        <p className="text-sm text-muted-foreground">{track.artist}</p>
                    </div>
                ))}
            </div>

            <div className="p-4 border-b border-t">
                <h3 className="font-semibold flex items-center gap-2"><Users /> Devices</h3>
            </div>
             <div className="flex-1 p-4 overflow-y-auto">
                {room.devices && Object.values(room.devices).map((device: Device) => (
                    <div key={device.uid} className="flex items-center justify-between p-2">
                        <span className='flex items-center gap-2'>
                            {device.name}
                            {device.isHost && <Crown className="h-4 w-4 text-accent" />}
                        </span>
                        <div className="h-2 w-2 rounded-full bg-green-500"></div>
                    </div>
                ))}
            </div>
        </div>
      </div>
    </>
  );
}
