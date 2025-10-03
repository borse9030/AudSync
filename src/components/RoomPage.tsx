
"use client";

import { useState, useEffect, useRef } from 'react';
import YouTube from 'react-youtube';
import type { YouTubePlayer } from 'react-youtube';
import { useUser, useFirestore, useDoc, useMemoFirebase } from '@/firebase';
import { doc, setDoc, updateDoc, onSnapshot, serverTimestamp, collection, deleteDoc } from 'firebase/firestore';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
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
import { Slider } from '@/components/ui/slider';
import { Loader2, ListMusic, Crown, Upload, Volume2, Youtube } from 'lucide-react';
import { setDocumentNonBlocking, updateDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { cn } from "@/lib/utils";

const MOCK_TRACK: Track = {
  id: 'mock-track-1',
  title: 'Ambient Gold',
  artist: 'Orion',
  duration: 180,
  storagePath: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
};

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
  const [isUploading, setIsUploading] = useState(false);
  const [volume, setVolume] = useState(0.5);
  const [youtubeLink, setYoutubeLink] = useState('');
  
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const youtubePlayerRef = useRef<YouTubePlayer | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
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
    const audio = audioRef.current;
    if (audio) {
      audio.volume = volume;
    }
    const ytPlayer = youtubePlayerRef.current;
    if (ytPlayer && 'setVolume' in ytPlayer) {
      ytPlayer.setVolume(volume * 100);
    }
  }, [volume]);

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
    if (!room?.playback || !audioReady) return;
    const { source, state, position, trackId, youtubeVideoId } = room.playback;

    if (source === 'youtube') {
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
    } else { // 'file' source
      const audio = audioRef.current;
      if (!audio) return;
      
      const currentTrack = trackId && room.playlist ? room.playlist[trackId] : null;

      if (currentTrack && audio.src !== currentTrack.storagePath) {
          audio.src = currentTrack.storagePath;
          audio.load();
      } else if (!currentTrack && audio.src) {
        audio.src = '';
      }
      
      if (state === 'playing') {
          const estimatedServerTime = Date.now();
          const playbackStartedAt = (room.playback.timestamp as any)?.toMillis() || Date.now();
          const expectedPosition = position + (estimatedServerTime - playbackStartedAt) / 1000;
          
          if (Math.abs(audio.currentTime - expectedPosition) > 1.5) {
              audio.currentTime = expectedPosition;
          }

          if (audio.paused) {
              audio.play().catch(e => console.warn("Autoplay failed", e));
          }
      } else {
        if (!audio.paused) {
          audio.pause();
        }
         if (Math.abs(audio.currentTime - position) > 0.5) {
          audio.currentTime = position;
        }
      }
    }
  }, [room?.playback, audioReady, room?.playlist]);


  const handlePlayPause = () => {
    if (!isHost || !room || !user || !firestore) return;
    
    const roomDocRef = doc(firestore, 'rooms', roomId);
    const { source, state, trackId, youtubeVideoId } = room.playback;

    if (source === 'file') {
      const audio = audioRef.current;
      if (!audio) return;
      
      let newTrackId = trackId;
      if (!newTrackId && Object.keys(room.playlist || {}).length > 0) {
        newTrackId = Object.keys(room.playlist)[0];
      } else if (!newTrackId) {
        const updatedPlaylist = { ...room.playlist, [MOCK_TRACK.id]: MOCK_TRACK };
        newTrackId = MOCK_TRACK.id;
        updateDocumentNonBlocking(roomDocRef, { playlist: updatedPlaylist });
      }

      updateDocumentNonBlocking(roomDocRef, {
        "playback.state": state === 'paused' ? 'playing' : 'paused',
        "playback.trackId": newTrackId,
        "playback.position": audio.currentTime,
        "playback.timestamp": serverTimestamp(),
      });
    } else { // youtube
      const ytPlayer = youtubePlayerRef.current;
      if (!ytPlayer || !('getPlayerState' in ytPlayer)) return;

      updateDocumentNonBlocking(roomDocRef, {
        "playback.state": state === 'paused' ? 'playing' : 'paused',
        "playback.position": ytPlayer.getCurrentTime(),
        "playback.timestamp": serverTimestamp(),
      });
    }
  };


  const handleSeek = (newPosition: number) => {
    if (!isHost || !room || !firestore) return;
    
    seekingRef.current = true;
    if (room.playback.source === 'file' && audioRef.current) {
        audioRef.current.currentTime = newPosition;
    } else if (room.playback.source === 'youtube' && youtubePlayerRef.current) {
        youtubePlayerRef.current.seekTo(newPosition, true);
    }
    
    const roomDocRef = doc(firestore, 'rooms', roomId);
    updateDocumentNonBlocking(roomDocRef, {
      "playback.position": newPosition,
      "playback.timestamp": serverTimestamp(),
    });

    setTimeout(() => { seekingRef.current = false }, 200);
  }
  
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!isHost || !firestore || !user) return;
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    toast({ title: "Uploading track..." });

    try {
        const storage = getStorage();
        const trackId = doc(collection(firestore, 'tracks')).id;
        const filePath = `rooms/${roomId}/tracks/${trackId}_${file.name}`;
        const fileRef = storageRef(storage, filePath);

        await uploadBytes(fileRef, file);
        const downloadURL = await getDownloadURL(fileRef);

        const audio = document.createElement('audio');
        audio.src = downloadURL;
        audio.addEventListener('loadedmetadata', async () => {
            const newTrack: Track = {
                id: trackId,
                title: file.name.replace(/\.[^/.]+$/, ""),
                artist: "Unknown",
                duration: audio.duration,
                storagePath: downloadURL,
            };

            const roomDocRef = doc(firestore, 'rooms', roomId);
            try {
                await updateDoc(roomDocRef, {
                    [`playlist.${trackId}`]: newTrack,
                    "playback.source": 'file',
                    "playback.trackId": trackId,
                });
                toast({ title: "Upload complete!", description: `${newTrack.title} has been added.` });
            } catch (updateError) {
                console.error("Firestore update failed:", updateError);
                toast({ variant: 'destructive', title: 'Database Error', description: 'Could not add the track to the playlist.' });
            } finally {
                setIsUploading(false);
            }
        });
        audio.addEventListener('error', () => {
            toast({ variant: 'destructive', title: 'Error processing track', description: 'Could not read metadata from the uploaded file.' });
            setIsUploading(false);
        });

    } catch (error) {
        console.error("Upload failed:", error);
        toast({ variant: 'destructive', title: 'Upload Failed', description: 'Could not upload the track. Please try again.' });
        setIsUploading(false);
    }
};

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
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  const currentTrack = room.playback.trackId ? room.playlist?.[room.playback.trackId] : null;
  const currentPosition = room.playback.source === 'file' 
    ? audioRef.current?.currentTime 
    : youtubePlayerRef.current?.getCurrentTime();
  const currentDuration = room.playback.source === 'file' 
    ? currentTrack?.duration 
    : youtubePlayerRef.current?.getDuration();


  return (
    <>
      <audio ref={audioRef} onCanPlay={() => {}} className="hidden" />

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
          <div className={cn("w-full h-full", room.playback.source === 'youtube' ? 'opacity-100' : 'opacity-0')}>
            <YouTube
              videoId={room.playback.youtubeVideoId}
              onReady={(e) => { youtubePlayerRef.current = e.target; e.target.setVolume(volume * 100); }}
              className="absolute inset-0 w-full h-full"
              iframeClassName="w-full h-full"
              opts={{ playerVars: { controls: 0, modestbranding: 1, showinfo: 0, rel: 0 } }}
            />
          </div>

          <div className="relative z-10 text-center bg-background/50 backdrop-blur-sm p-4 rounded-lg">
            <h2 className="text-3xl font-bold">{room.playback.source === 'file' ? (currentTrack?.title || 'No track selected') : 'YouTube Video'}</h2>
            <p className="text-lg text-muted-foreground">{room.playback.source === 'file' ? (currentTrack?.artist || 'Select a track to start') : room.playback.youtubeVideoId}</p>
            
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
            <div className="p-4 border-b flex justify-between items-center">
                <h3 className="font-semibold flex items-center gap-2"><ListMusic/> Playlist</h3>
                {isHost && (
                  <>
                    <Button size="sm" onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
                      {isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                      Add Track
                    </Button>
                    <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept="audio/*" className="hidden" />
                  </>
                )}
            </div>
            <div className="flex-1 p-4 overflow-y-auto">
                {room.playlist && Object.values(room.playlist).map(track => (
                    <div key={track.id} className={`p-2 rounded-md ${track.id === currentTrack?.id ? 'bg-primary/20' : ''}`}>
                        <p className="font-semibold">{track.title}</p>
                        <p className="text-sm text-muted-foreground">{track.artist}</p>
                    </div>
                ))}
                {(!room.playlist || Object.keys(room.playlist).length === 0) && (
                  <p className="text-sm text-muted-foreground text-center py-4">Playlist is empty.</p>
                )}
            </div>

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

    
    