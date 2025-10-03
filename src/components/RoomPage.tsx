"use client";

import { useState, useEffect, useRef } from 'react';
import YouTube from 'react-youtube';
import type { YouTubePlayer } from 'react-youtube';
import { useUser, useFirestore, useDoc, useMemoFirebase } from '@/firebase';
import { doc, onSnapshot, serverTimestamp, collection, updateDoc } from 'firebase/firestore';
import type { Room, Device } from '@/lib/types';
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
import { Slider } from '@/components/ui/slider';
import { Loader2, Crown, Volume2, Youtube, LoaderCircle } from 'lucide-react';
import { setDocumentNonBlocking, updateDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { cn } from "@/lib/utils";


function extractYouTubeVideoId(url: string): string | null {
  try {
    const urlObj = new URL(url);
    if (urlObj.hostname === 'youtu.be') {
      return urlObj.pathname.slice(1);
    }
    if (urlObj.hostname.includes('youtube.com')) {
      const videoId = urlObj.searchParams.get('v');
      if (videoId) {
        return videoId;
      }
    }
    return null;
  } catch (e) {
    return null;
  }
}

export default function RoomPage({ roomId }: { roomId: string; }) {
  const firestore = useFirestore();
  const { user, isUserLoading } = useUser();
  const router = useRouter();
  const { toast } = useToast();

  const roomRef = useMemoFirebase(() => firestore ? doc(firestore, 'rooms', roomId) : null, [firestore, roomId]);
  const { data: room, isLoading: isRoomLoading, error: roomError } = useDoc<Room>(roomRef);

  const [isHost, setIsHost] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const [deviceName, setDeviceName] = useState('');
  const [devices, setDevices] = useState<Record<string, Device>>({});
  const [volume, setVolume] = useState(0.5);
  const [youtubeLink, setYoutubeLink] = useState('');
  
  const youtubePlayerRef = useRef<YouTubePlayer | null>(null);
  const seekingRef = useRef(false);

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
    const ytPlayer = youtubePlayerRef.current;
    if (ytPlayer && 'setVolume' in ytPlayer) {
      ytPlayer.setVolume(volume * 100);
    }
  }, [volume]);

  useEffect(() => {
      const nameFromStorage = localStorage.getItem('audsync_device_name') || `Device ${Math.random().toString(36).substring(2, 6)}`;
      setDeviceName(nameFromStorage);
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
    if (!room?.playback || !audioReady) return;
    const { state, position, youtubeVideoId } = room.playback;

    const ytPlayer = youtubePlayerRef.current;
    if (!ytPlayer || !('getPlayerState' in ytPlayer)) return;

    const estimatedServerTime = Date.now();
    const playbackStartedAt = (room.playback.timestamp as any)?.toMillis() || Date.now();
    const expectedPosition = position + (state === 'playing' ? (estimatedServerTime - playbackStartedAt) / 1000 : 0);

    if (Math.abs(ytPlayer.getCurrentTime() - expectedPosition) > 1.5) {
      ytPlayer.seekTo(expectedPosition, true);
    }

    const playerState = ytPlayer.getPlayerState();
    if (state === 'playing' && playerState !== 1) { // 1 is Playing
      ytPlayer.playVideo();
    } else if (state === 'paused' && playerState !== 2) { // 2 is Paused
      ytPlayer.pauseVideo();
    }

  }, [room?.playback, audioReady]);


  const handlePlayPause = () => {
    if (!isHost || !room || !user || !firestore) return;
    
    const roomDocRef = doc(firestore, 'rooms', roomId);
    const { state } = room.playback;

    const ytPlayer = youtubePlayerRef.current;
    if (!ytPlayer || !('getPlayerState' in ytPlayer)) return;

    updateDocumentNonBlocking(roomDocRef, {
      "playback.state": state === 'paused' ? 'playing' : 'paused',
      "playback.position": ytPlayer.getCurrentTime(),
      "playback.timestamp": serverTimestamp(),
    });
  };


  const handleSeek = (newPosition: number) => {
    if (!isHost || !room || !firestore) return;
    
    seekingRef.current = true;
    if (youtubePlayerRef.current) {
        youtubePlayerRef.current.seekTo(newPosition, true);
    }
    
    const roomDocRef = doc(firestore, 'rooms', roomId);
    updateDocumentNonBlocking(roomDocRef, {
      "playback.position": newPosition,
      "playback.timestamp": serverTimestamp(),
    });

    setTimeout(() => { seekingRef.current = false }, 200);
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
    setAudioReady(true);
  };
  
  const handleLoadYoutubeVideo = () => {
    if (!isHost || !firestore) return;
    const videoId = extractYouTubeVideoId(youtubeLink);
    if (videoId) {
        const roomDocRef = doc(firestore, 'rooms', roomId);
        updateDocumentNonBlocking(roomDocRef, {
            "playback.source": 'youtube',
            "playback.youtubeVideoId": videoId,
            "playback.state": "paused",
            "playback.position": 0,
            "playback.timestamp": serverTimestamp(),
        });
        setYoutubeLink('');
    } else {
        toast({
            variant: 'destructive',
            title: 'Invalid YouTube URL',
            description: 'Please enter a valid YouTube video URL.'
        });
    }
  };

  if (isUserLoading || isRoomLoading || !room || !user) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoaderCircle className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  const currentPosition = youtubePlayerRef.current?.getCurrentTime();
  const currentDuration = youtubePlayerRef.current?.getDuration();


  return (
    <>
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
        <div className="flex flex-col items-center justify-center p-8 bg-muted/20 relative">
          <div className={cn("w-full h-full", room.playback.youtubeVideoId ? 'opacity-100' : 'opacity-0')}>
            <YouTube
              videoId={room.playback.youtubeVideoId}
              onReady={(e) => { youtubePlayerRef.current = e.target; e.target.setVolume(volume * 100); }}
              className="absolute inset-0 w-full h-full"
              iframeClassName="w-full h-full"
              opts={{ playerVars: { controls: 0, modestbranding: 1, showinfo: 0, rel: 0 } }}
            />
          </div>

          <div className="relative z-10 text-center bg-background/50 backdrop-blur-sm p-4 rounded-lg">
            <h2 className="text-3xl font-bold">{room.playback.youtubeVideoId ? 'YouTube Video' : 'No Video Loaded'}</h2>
            <p className="text-lg text-muted-foreground">{room.playback.youtubeVideoId || 'Paste a link to start'}</p>
            
            <div className="mt-8 w-full max-w-md">
                <Slider
                    min={0}
                    max={currentDuration || 100}
                    value={[currentPosition || room.playback.position]}
                    onValueChange={(value) => handleSeek(value[0])}
                    className="w-full"
                    disabled={!isHost}
                />
                <div className="flex justify-between text-xs text-muted-foreground mt-1">
                    <span>{new Date((currentPosition || 0) * 1000).toISOString().substr(14, 5)}</span>
                    <span>{currentDuration ? new Date(currentDuration * 1000).toISOString().substr(14, 5) : '00:00'}</span>
                </div>
            </div>
            
            <div className="mt-4 flex items-center justify-center gap-4">
                {isHost && (
                  <Button size="lg" onClick={handlePlayPause}>
                      {room.playback.state === 'playing' ? 'Pause' : 'Play'}
                  </Button>
                )}
                <div className="flex items-center gap-2 w-32">
                  <Volume2 className="h-5 w-5"/>
                  <Slider
                    min={0}
                    max={1}
                    step={0.05}
                    value={[volume]}
                    onValueChange={(value) => setVolume(value[0])}
                  />
                </div>
            </div>
          </div>
        </div>
        <div className="border-l bg-card flex flex-col">
            {isHost && (
                <div className='p-4 border-b'>
                  <div className="flex gap-2">
                      <Input 
                          placeholder="Paste YouTube link..." 
                          value={youtubeLink}
                          onChange={(e) => setYoutubeLink(e.target.value)}
                      />
                      <Button onClick={handleLoadYoutubeVideo}><Youtube className="mr-2 h-4 w-4" /> Load</Button>
                  </div>
                </div>
            )}
            
            <div className="p-4 border-b border-t">
                <h3 className="font-semibold flex items-center gap-2"><Crown /> Devices</h3>
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
