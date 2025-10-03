"use client";

import { useState, useEffect, useRef } from 'react';
import YouTube from 'react-youtube';
import type { YouTubePlayer } from 'react-youtube';
import { useUser, useFirestore, useDoc, useMemoFirebase } from '@/firebase';
import { doc, onSnapshot, serverTimestamp, collection, writeBatch } from 'firebase/firestore';
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
import { Loader2, Crown, Volume2, Youtube, Play, Pause, LoaderCircle, Users, X } from 'lucide-react';
import { setDocumentNonBlocking, deleteDocumentNonBlocking, updateDocumentNonBlocking } from '@/firebase/non-blocking-updates';
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
  const [localVolume, setLocalVolume] = useState(0.5);
  const [youtubeLink, setYoutubeLink] = useState('');
  const [isYoutubeLoading, setIsYoutubeLoading] = useState(false);
  
  const youtubePlayerRef = useRef<YouTubePlayer | null>(null);
  const seekingRef = useRef(false);
  const [localPlaybackState, setLocalPlaybackState] = useState<'playing' | 'paused'>('paused');
  const localPositionRef = useRef(room?.playback.position || 0);

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
      const host = room.hostId === user.uid;
      setIsHost(host);
    }
  }, [user, room]);
  
  useEffect(() => {
    const ytPlayer = youtubePlayerRef.current;
    if (ytPlayer && 'setVolume' in ytPlayer) {
      const volumeToSet = isHost ? localVolume : room?.volume ?? 0.5;
      ytPlayer.setVolume(volumeToSet * 100);
    }
  }, [localVolume, room?.volume, isHost, audioReady]);

  useEffect(() => {
    let nameFromStorage = '';
    if (typeof window !== 'undefined') {
      nameFromStorage = localStorage.getItem('audsync_device_name') || '';
    }
    if (nameFromStorage) {
      setDeviceName(nameFromStorage);
    } else {
      const randomName = `Device-${Math.random().toString(36).substring(2, 6)}`;
      setDeviceName(randomName);
    }
  }, []);

  // Heartbeat effect for all users
  useEffect(() => {
    if (!user || !firestore || !deviceName || !room) return;

    const deviceRef = doc(firestore, `rooms/${roomId}/devices/${user.uid}`);

    // Initial registration
    setDocumentNonBlocking(deviceRef, {
      uid: user.uid,
      name: deviceName,
      lastSeen: serverTimestamp(),
      isHost: room.hostId === user.uid,
    }, { merge: true });

    // Set up a heartbeat interval to update lastSeen
    const heartbeatInterval = setInterval(() => {
      updateDocumentNonBlocking(deviceRef, { lastSeen: serverTimestamp() });
    }, 15000); // every 15 seconds

    const handleBeforeUnload = () => {
      // This is a best-effort attempt, heartbeat is the fallback
      deleteDocumentNonBlocking(deviceRef);
    };
    
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      clearInterval(heartbeatInterval);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      // Best-effort cleanup on component unmount/navigation
      deleteDocumentNonBlocking(deviceRef);
    };

  }, [user, firestore, roomId, deviceName, room]);
  
  // Host-only effect to clean up stale devices
  useEffect(() => {
      if (!isHost || Object.keys(devices).length === 0 || !firestore) return;

      const cleanupInterval = setInterval(() => {
          const now = Date.now();
          const staleThreshold = now - 30000; // 30 seconds
          
          Object.values(devices).forEach(device => {
              if (device.isHost) return; // Don't remove the host

              const lastSeenTime = (device.lastSeen as any)?.toMillis();
              if (lastSeenTime < staleThreshold) {
                  const deviceRef = doc(firestore, `rooms/${roomId}/devices/${device.uid}`);
                  deleteDocumentNonBlocking(deviceRef);
              }
          });
      }, 20000); // Check every 20 seconds

      return () => clearInterval(cleanupInterval);
  }, [isHost, devices, firestore, roomId]);


  useEffect(() => {
    if(!firestore) return;
    const devicesColRef = collection(firestore, `rooms/${roomId}/devices`);
    const unsubscribe = onSnapshot(devicesColRef, (snapshot) => {
      const newDevices: Record<string, Device> = {};
      let userIsStillInRoom = false;
      snapshot.forEach((doc) => {
        if(doc.id === user?.uid) userIsStillInRoom = true;
        newDevices[doc.id] = doc.data() as Device;
      });
      setDevices(newDevices);
      // If the current user was removed (e.g., kicked by host), redirect them.
      if (user && !userIsStillInRoom && !isRoomLoading && !isUserLoading) {
         if (Object.keys(devices).length > 0) { // Check if devices has been populated
            toast({ title: "You have been removed from the room." });
            router.push('/');
         }
      }
    });
    return () => unsubscribe();
  }, [firestore, roomId, user, isUserLoading, isRoomLoading, router, toast]);


  useEffect(() => {
    if (!room?.playback || !audioReady || seekingRef.current || isHost) return;
    
    const { state, position, youtubeVideoId, timestamp } = room.playback;
    const ytPlayer = youtubePlayerRef.current;
    if (!ytPlayer || typeof ytPlayer.getPlayerState !== 'function') return;

    if (ytPlayer.getVideoData()?.video_id !== youtubeVideoId) {
        if(youtubeVideoId) ytPlayer.loadVideoById(youtubeVideoId);
    }

    const serverTimeNow = Date.now();
    const remoteTimestamp = (timestamp as any)?.toMillis() || serverTimeNow;
    const timeSinceUpdate = (serverTimeNow - remoteTimestamp) / 1000;
    
    const expectedPosition = position + (state === 'playing' ? timeSinceUpdate : 0);
    const clientPosition = ytPlayer.getCurrentTime() || 0;

    if (Math.abs(clientPosition - expectedPosition) > 1.5) {
        ytPlayer.seekTo(expectedPosition, true);
    }
    
    const playerState = ytPlayer.getPlayerState();
    if (state === 'playing' && playerState !== 1) {
        ytPlayer.playVideo();
    } else if (state === 'paused' && playerState !== 2) {
        ytPlayer.pauseVideo();
    }
  }, [room?.playback, audioReady, isHost]);

  useEffect(() => {
    if (isHost && localPlaybackState === 'playing') {
      const interval = setInterval(() => {
        const currentTime = youtubePlayerRef.current?.getCurrentTime();
        if (typeof currentTime === 'number') {
            localPositionRef.current = currentTime;
        }
      }, 500);
      return () => clearInterval(interval);
    }
  }, [isHost, localPlaybackState]);


  const handlePlayPause = () => {
    if (!isHost || !room || !user || !firestore) return;
    
    const roomDocRef = doc(firestore, 'rooms', roomId);
    const newState = localPlaybackState === 'paused' ? 'playing' : 'paused';
    
    const ytPlayer = youtubePlayerRef.current;
    if (!ytPlayer || typeof ytPlayer.getCurrentTime !== 'function') return;
    
    const currentPosition = ytPlayer.getCurrentTime();
    localPositionRef.current = currentPosition;
    setLocalPlaybackState(newState);

    if (newState === 'playing') {
      ytPlayer.playVideo();
    } else {
      ytPlayer.pauseVideo();
    }

    updateDocumentNonBlocking(roomDocRef, {
      "playback.state": newState,
      "playback.position": currentPosition,
      "playback.timestamp": serverTimestamp(),
    });
  };


  const handleSeek = (newPosition: number[]) => {
    if (!isHost || !room || !firestore) return;
    
    const pos = newPosition[0];
    seekingRef.current = true;
    localPositionRef.current = pos;

    if (youtubePlayerRef.current) {
        youtubePlayerRef.current.seekTo(pos, true);
    }
    
    const roomDocRef = doc(firestore, 'rooms', roomId);
    updateDocumentNonBlocking(roomDocRef, {
      "playback.position": pos,
      "playback.timestamp": serverTimestamp(),
    });

    setTimeout(() => { seekingRef.current = false }, 500);
  }
  
  const handleDeviceNameChange = (newName: string) => {
    setDeviceName(newName);
    if(typeof window !== 'undefined') {
        localStorage.setItem('audsync_device_name', newName);
    }
    if(user && firestore) {
        const deviceRef = doc(firestore, `rooms/${roomId}/devices/${user.uid}`);
        updateDocumentNonBlocking(deviceRef, { name: newName });
    }
  };

  const handleGlobalVolumeChange = (newVolume: number[]) => {
    if (!isHost || !firestore) return;
    const vol = newVolume[0];
    setLocalVolume(vol); // Host updates their local volume too
    const roomDocRef = doc(firestore, 'rooms', roomId);
    updateDocumentNonBlocking(roomDocRef, { "volume": vol });
  };
  
  const handleRemoveDevice = (uid: string) => {
      if (!isHost || !firestore) return;
      if (uid === user?.uid) {
          toast({ variant: 'destructive', title: "You can't remove yourself." });
          return;
      }
      const deviceRef = doc(firestore, `rooms/${roomId}/devices/${uid}`);
      deleteDocumentNonBlocking(deviceRef);
  };

  const initializeAudio = () => {
    const player = youtubePlayerRef.current;
    if (player && typeof player.playVideo === 'function') {
      player.playVideo();
      player.pauseVideo();
    }
    setAudioReady(true);
  };
  
  const handleLoadYoutubeVideo = async () => {
    if (!isHost || !firestore) return;
    const videoId = extractYouTubeVideoId(youtubeLink);
    if (videoId) {
        setIsYoutubeLoading(true);
        try {
          const oembedUrl = `https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`;
          const response = await fetch(oembedUrl);
          if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'Failed to fetch video details' }));
            throw new Error(errorData.error || 'Failed to fetch video details');
          }
          const data = await response.json();
          const title = data.title;
          const artist = data.author_name;

          const roomDocRef = doc(firestore, 'rooms', roomId);
          const batch = writeBatch(firestore);

          if (youtubePlayerRef.current) {
            youtubePlayerRef.current.loadVideoById(videoId);
            youtubePlayerRef.current.pauseVideo();
          }

          batch.update(roomDocRef, {
              "playback.source": 'youtube',
              "playback.youtubeVideoId": videoId,
              "playback.trackTitle": title,
              "playback.artist": artist,
              "playback.state": "paused",
              "playback.position": 0,
              "playback.timestamp": serverTimestamp(),
          });
          setYoutubeLink('');
          setLocalPlaybackState('paused');
          localPositionRef.current = 0;
          
          await batch.commit();

        } catch(e: any) {
            toast({
                variant: 'destructive',
                title: 'Could not load video',
                description: e.message || 'The video might be private, deleted, or unavailable.',
            });
        } finally {
            setIsYoutubeLoading(false);
        }
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
  
  const currentPosition = isHost ? localPositionRef.current : youtubePlayerRef.current?.getCurrentTime();
  const currentDuration = youtubePlayerRef.current?.getDuration();

  const formatTime = (seconds: number = 0) => {
    const date = new Date(0);
    date.setSeconds(seconds);
    return date.toISOString().substr(14, 5);
  }

  const roomVolume = room.volume ?? 0.5;

  return (
    <>
      <Dialog open={!audioReady} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-[425px] bg-gray-900/80 backdrop-blur-sm border-white/20 text-foreground">
          <DialogHeader>
            <DialogTitle className="text-primary">Ready to Sync?</DialogTitle>
            <DialogDescription>
              A single tap is needed to enable synchronized audio playback. Please also set your device name.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
              <Input
                id="name"
                value={deviceName}
                onChange={(e) => handleDeviceNameChange(e.target.value)}
                className="col-span-3 bg-transparent border-white/20"
                placeholder='Enter your device name'
              />
          </div>
          <DialogFooter>
            <Button onClick={initializeAudio} className="bg-primary/80 hover:bg-primary text-primary-foreground">Let's Go</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      <div className="grid md:grid-cols-[1fr_350px] h-full gap-8 p-4 md:p-8">
        <div className="flex flex-col items-center justify-center p-4 sm:p-8 bg-white/5 backdrop-blur-md border border-white/10 rounded-xl shadow-lg relative h-full">
            <div className="absolute top-0 left-0 w-px h-px opacity-0 overflow-hidden">
                <YouTube
                videoId={room.playback.youtubeVideoId}
                onReady={(e) => { 
                  youtubePlayerRef.current = e.target;
                  const volumeToSet = isHost ? localVolume : room.volume ?? 0.5;
                  e.target.setVolume(volumeToSet * 100); 
                }}
                onStateChange={(e) => {
                  if(isHost) {
                    const playerState = e.target.getPlayerState();
                    // Sync host's local state ONLY if it's different
                    if (playerState === 1 && localPlaybackState !== 'playing') {
                      handlePlayPause();
                    } else if ((playerState === 2 || playerState === 0) && localPlaybackState !== 'paused') {
                      handlePlayPause();
                    }
                  }
                }}
                opts={{ playerVars: { controls: 0, modestbranding: 1, showinfo: 0, rel: 0, iv_load_policy: 3 } }}
                className="w-full h-full"
                />
            </div>

            <div className="relative z-10 text-center w-full flex flex-col justify-center items-center h-full">
                <div className="flex-grow flex flex-col justify-center items-center">
                    <h2 className="text-2xl md:text-4xl font-bold tracking-tight text-foreground transition-all duration-300">
                        {room.playback.trackTitle || 'No Video Loaded'}
                    </h2>
                    <p className="text-base md:text-lg text-muted-foreground mt-2 transition-all duration-300">
                        {room.playback.artist || (room.playback.trackTitle ? 'Now Playing' : 'Paste a YouTube link to start')}
                    </p>
                </div>
                
                <div className="w-full max-w-md mt-auto">
                    <Slider
                        min={0}
                        max={currentDuration || 100}
                        value={[currentPosition || room.playback.position]}
                        onValueChange={handleSeek}
                        className="w-full cursor-pointer"
                        disabled={!isHost}
                    />
                    <div className="flex justify-between text-xs text-muted-foreground mt-2 font-mono">
                        <span>{formatTime(currentPosition)}</span>
                        <span>{formatTime(currentDuration)}</span>
                    </div>
                </div>
                
                <div className="mt-6 flex items-center justify-center gap-6">
                    {isHost && (
                        <Button size="icon" onClick={handlePlayPause} className="rounded-full w-16 h-16 bg-primary/80 hover:bg-primary shadow-lg hover:shadow-primary/40 transition-all duration-300">
                           {localPlaybackState === 'playing' ? <Pause className="w-8 h-8" /> : <Play className="w-8 h-8" />}
                        </Button>
                    )}
                    <div className="flex items-center gap-2 w-32">
                        <Volume2 className="h-5 w-5 text-muted-foreground"/>
                        <Slider
                            min={0}
                            max={1}
                            step={0.05}
                            value={[isHost ? localVolume : roomVolume]}
                            onValueChange={(v) => isHost ? handleGlobalVolumeChange(v) : setLocalVolume(v[0])}
                            className="cursor-pointer"
                        />
                    </div>
                </div>
            </div>
        </div>
        <div className="flex flex-col gap-6">
            {isHost && (
                <div className='p-4 bg-white/5 backdrop-blur-md border border-white/10 rounded-xl shadow-lg'>
                    <h3 className="font-semibold flex items-center gap-2 mb-3 text-primary"><Youtube/> Load Video</h3>
                    <div className="flex gap-2">
                        <Input 
                            placeholder="Paste YouTube link..." 
                            value={youtubeLink}
                            onChange={(e) => setYoutubeLink(e.target.value)}
                            className="bg-transparent border-white/20"
                        />
                        <Button onClick={handleLoadYoutubeVideo} disabled={isYoutubeLoading} className="bg-primary/80 hover:bg-primary text-primary-foreground">
                            {isYoutubeLoading ? <Loader2 className="animate-spin" /> : 'Load'}
                        </Button>
                    </div>
                </div>
            )}
            
            <div className="flex-1 p-4 bg-white/5 backdrop-blur-md border border-white/10 rounded-xl shadow-lg flex flex-col min-h-0">
                <h3 className="font-semibold flex items-center gap-2 mb-3 text-primary"><Users /> Connected Devices</h3>
                <div className="flex-1 overflow-y-auto pr-2 space-y-1">
                    {devices && Object.values(devices).map((device: Device) => (
                        <div key={device.uid} className="flex items-center justify-between p-2 rounded-md hover:bg-white/10 transition-colors group">
                            <span className='flex items-center gap-2 text-foreground/90'>
                                {device.name}
                                {device.isHost && <Crown className="h-4 w-4 text-accent" />}
                            </span>
                            <div className="flex items-center gap-2">
                                <div className="h-2 w-2 rounded-full bg-green-500 shadow-[0_0_8px_#22c55e]"></div>
                                {isHost && !device.isHost && (
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                                        onClick={() => handleRemoveDevice(device.uid)}
                                    >
                                        <X className="h-4 w-4 text-red-500" />
                                    </Button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
      </div>
    </>
  );
}
    

    