"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, useUser, useFirestore } from '@/firebase';
import { initiateAnonymousSignIn } from '@/firebase/non-blocking-login';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Music } from 'lucide-react';
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';

export default function Home() {
  const [roomCode, setRoomCode] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const router = useRouter();
  const { toast } = useToast();
  const auth = useAuth();
  const firestore = useFirestore();
  const { user, isUserLoading } = useUser();

  useEffect(() => {
    if (!isUserLoading && !user) {
      initiateAnonymousSignIn(auth);
    }
  }, [isUserLoading, user, auth]);

  const handleCreateRoom = async () => {
    if (!user) {
      toast({
        variant: 'destructive',
        title: 'Not Authenticated',
        description: 'Please wait for authentication to complete.',
      });
      return;
    }
    setIsCreating(true);
    const newRoomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    const roomRef = doc(firestore, `rooms/${newRoomCode}`);

    try {
      await setDoc(roomRef, {
        hostId: user.uid,
        createdAt: serverTimestamp(),
        playback: {
          state: 'paused',
          source: 'file',
          trackId: null,
          youtubeVideoId: null,
          position: 0,
          timestamp: serverTimestamp(),
        },
        playlist: {},
        devices: {},
      });
      router.push(`/room/${newRoomCode}`);
    } catch (error) {
      console.error('Failed to create room:', error);
      toast({
        variant: 'destructive',
        title: 'Error Creating Room',
        description: 'Could not create a new room. Please try again.',
      });
      setIsCreating(false);
    }
  };

  const handleJoinRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      toast({
        variant: 'destructive',
        title: 'Not Authenticated',
        description: 'Please wait for authentication to complete.',
      });
      return;
    }
    if (!roomCode) {
      toast({
        title: 'Invalid Code',
        description: 'Please enter a room code.',
      });
      return;
    }
    setIsJoining(true);
    const roomRef = doc(firestore, `rooms/${roomCode.toUpperCase()}`);
    try {
      const docSnap = await getDoc(roomRef);
      if (docSnap.exists()) {
        router.push(`/room/${roomCode.toUpperCase()}`);
      } else {
        toast({
          variant: 'destructive',
          title: 'Room Not Found',
          description: `Room with code "${roomCode.toUpperCase()}" does not exist.`,
        });
        setIsJoining(false);
      }
    } catch (error) {
      console.error('Failed to join room:', error);
      toast({
        variant: 'destructive',
        title: 'Error Joining Room',
        description: 'Could not connect to the room. Please check your connection.',
      });
      setIsJoining(false);
    }
  };

  if (isUserLoading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
        <p className="mt-4 text-muted-foreground">Connecting...</p>
      </div>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background p-4 sm:p-8">
      <div className="absolute top-8 left-8 flex items-center gap-2 text-xl font-bold text-primary">
        <Music className="h-6 w-6" />
        <span>AudSync</span>
      </div>
      <Card className="w-full max-w-sm shadow-xl animate-in fade-in-50 zoom-in-95 duration-500">
        <CardHeader className="text-center">
          <CardTitle className="text-3xl font-bold tracking-tight">
            Listen Together
          </CardTitle>
          <CardDescription className="pt-2">
            Create a room and share the vibe, perfectly in sync.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Button
            size="lg"
            className="w-full font-bold"
            onClick={handleCreateRoom}
            disabled={isCreating || isJoining || isUserLoading || !user}
          >
            {isCreating ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            Create a New Room
          </Button>

          <div className="flex items-center gap-4">
            <Separator className="flex-1" />
            <span className="text-xs text-muted-foreground">OR</span>
            <Separator className="flex-1" />
          </div>
          <form onSubmit={handleJoinRoom} className="flex flex-col gap-4">
            <Input
              type="text"
              placeholder="Enter room code"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value)}
              className="text-center text-lg"
              maxLength={6}
              disabled={isUserLoading || !user}
            />
            <Button
              variant="secondary"
              type="submit"
              className="w-full"
              disabled={isCreating || isJoining || isUserLoading || !user}
            >
              {isJoining ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Join Room
            </Button>
          </form>
        </CardContent>
        <CardFooter>
          <p className="text-xs text-muted-foreground text-center w-full">
            By using AudSync, you're assigned an anonymous profile to sync your device.
          </p>
        </CardFooter>
      </Card>
    </main>
  );
}
