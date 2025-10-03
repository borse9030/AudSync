"use client";

import { useState, useEffect, useRef, useCallback } from 'react';
import { useUser, useFirestore, useDoc, useMemoFirebase } from '@/firebase';
import { doc, setDoc, updateDoc, onSnapshot, serverTimestamp, collection, deleteDoc } from 'firebase/firestore';
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
import { setDocumentNonBlocking, updateDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase/non-blocking-updates';

const MOCK_TRACK: Track = {
  id: 'mock-track-1',
  title: 'Ambient Gold',
  artist: 'Orion',
  duration: 180,
  storagePath: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
};


export default function RoomPage({ roomId }: { roomId: string; }) {
  const firestore = useFirestore();
  const { user, isUserLoading } = useUser();
  const router = useRouter();
  const { toast } = useToast();

  const roomRef = useMemoFirebase(() => firestore ? doc(firestore, 'rooms', roomId) : null, [firestore, roomId]);
  const { data: room, isLoading: isRoomLoading, error: roomError } = useDoc<Room>(roomRef);

  const [isHost, setIsHost] = useState(false);
  const [serverOffset, setServerOffset] = useState(0);
  const [audioReady, setAudioReady] = useState(false);
  const [deviceName, setDeviceName] = useState('');
  const [devices, setDevices] = useState<Record<string, Device>>({});
  
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const getServerNow = useCallback(() => Date.now() + serverOffset, [serverOffset]);

  useEffect(() => {
    if (!isUserLoading && !user) {
      router.push('/');
    }
  }, [user, isUserLoading, router]);

  useEffect(() => {
    if (roomError) {
      toast({
        variant: 'destructive',
        title: 'Room Error',
        description: 'Could not load room data. It might not exist.',
      });
      router.push('/');
    }
  }, [roomError, router, toast]);

  useEffect(() => {
    if (user && room) {
      setIsHost(room.hostId === user.uid);
    }
  }, [user, room]);

  useEffect(() => {
    const deviceNameFromStorage = localStorage.getItem('audsync_device_name') || `Device ${Math.random().toString(36).substring(2, 6)}`;
    setDeviceName(deviceNameFromStorage);
  }, []);

  useEffect(() => {
    if (!user || !firestore || !deviceName || !room) return;

    const deviceRef = doc(firestore, `rooms/${roomId}/devices/${user.uid}`);
    
    setDocumentNonBlocking(deviceRef, {
      uid: user.uid,
      name: deviceName,
      lastSeen: serverTimestamp(),
      isHost: room.hostId === user.uid,
    }, { merge: true });

    const handleBeforeUnload = () => {
      deleteDocumentNonBlocking(deviceRef);
    };
    
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      deleteDocumentNonBlocking(deviceRef);
    };

  }, [user, firestore, roomId, deviceName, room]);


  useEffect(() => {
    if(!firestore) return;
    const devicesColRef = collection(firestore, `rooms/${roomId}/devices`);
    const unsubscribe = onSnapshot(devicesColRef, (snapshot) => {
      const newDevices: Record<string, Device> = {};
      snapshot.forEach((doc) => {
        newDevices[doc.id] = doc.data() as Device;
      });
      setDevices(newDevices);
    });
    return () => unsubscribe();
  }, [firestore, roomId]);


  // Playback sync logic
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !room?.playback) return;

    const { state, position, trackId } = room.playback;
    const currentTrack = trackId && room.playlist ? room.playlist[trackId] : null;

    if (state === 'playing' && currentTrack) {
        if (!audio.src.endsWith(currentTrack.storagePath)) {
            audio.src = currentTrack.storagePath;
            audio.load();
        }

        const estimatedServerTime = getServerNow();
        const playbackStartedAt = (room.playback.timestamp as any)?.toMillis() || Date.now();
        const expectedPosition = position + (estimatedServerTime - playbackStartedAt) / 1000;
        
        if (Math.abs(audio.currentTime - expectedPosition) > 1.5) { // 1.5s threshold for correction
            audio.currentTime = expectedPosition;
        }

        if (audio.paused) {
            audio.play().catch(e => console.warn("Autoplay failed", e));
        }

    } else { // paused
      if (!audio.paused) {
        audio.pause();
      }
       if (Math.abs(audio.currentTime - position) > 0.5) {
        audio.currentTime = position;
      }
    }
  }, [room?.playback, audioReady, getServerNow, room?.playlist]);


  const handlePlayPause = () => {
    if (!isHost || !room || !user || !firestore) return;
    const audio = audioRef.current;
    if (!audio) return;
    
    const roomDocRef = doc(firestore, 'rooms', roomId);

    let newTrackId = room.playback.trackId;
    if (!newTrackId && Object.keys(room.playlist || {}).length > 0) {
      newTrackId = Object.keys(room.playlist)[0];
    } else if (!newTrackId) {
      // Add mock track if playlist is empty
      const updatedPlaylist = { ...room.playlist, [MOCK_TRACK.id]: MOCK_TRACK };
      newTrackId = MOCK_TRACK.id;
      updateDocumentNonBlocking(roomDocRef, { playlist: updatedPlaylist });
    }

    if (room.playback.state === 'paused') {
      updateDocumentNonBlocking(roomDocRef, {
        "playback.state": 'playing',
        "playback.trackId": newTrackId,
        "playback.position": audio.currentTime,
        "playback.timestamp": serverTimestamp(),
      });
    } else {
      updateDocumentNonBlocking(roomDocRef, {
        "playback.state": 'paused',
        "playback.position": audio.currentTime,
        "playback.timestamp": serverTimestamp(),
      });
    }
  };


  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!isHost || !room || !audioRef.current || !firestore) return;
    const newPosition = parseFloat(e.target.value);
    audioRef.current.currentTime = newPosition;
    
    const roomDocRef = doc(firestore, 'rooms', roomId);
    updateDocumentNonBlocking(roomDocRef, {
      "playback.position": newPosition,
      "playback.timestamp": serverTimestamp(),
    });
  }

  const handleDeviceNameChange = (newName: string) => {
    setDeviceName(newName);
    localStorage.setItem('audsync_device_name', newName);
    if(user && firestore) {
        const deviceRef = doc(firestore, `rooms/${roomId}/devices/${user.uid}`);
        updateDocumentNonBlocking(deviceRef, { name: newName });
    }
  };

  const initializeAudio = () => {
    if (audioRef.current) {
      audioRef.current.load();
    }
    setAudioReady(true);
  };


  if (isUserLoading || isRoomLoading || !room || !user) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  const currentTrack = room.playback.trackId ? room.playlist?.[room.playback.trackId] : null;

  return (
    <>
      <audio ref={audioRef} onCanPlay={() => setAudioReady(true)} />
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
            <Button onClick={initializeAudio}>Let's Go</Button>
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
                {devices && Object.values(devices).map((device: Device) => (
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
