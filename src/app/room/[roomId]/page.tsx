"use client"
import RoomPage from '@/components/RoomPage';
import { Music } from 'lucide-react';
import Link from 'next/link';

type Props = {
  params: { roomId: string };
};

export default function Room({ params }: Props) {
  const { roomId } = params;

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex h-16 items-center justify-between border-b bg-card px-4 md:px-6">
        <Link href="/" className="flex items-center gap-2 text-xl font-bold text-primary">
          <Music className="h-6 w-6" />
          <span>AudSync</span>
        </Link>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>Room:</span>
          <span className="font-mono text-primary font-semibold">{roomId}</span>
        </div>
      </header>
      <main className="flex-1 overflow-auto">
        <RoomPage roomId={roomId.toUpperCase()} />
      </main>
    </div>
  );
}

export const dynamic = 'force-dynamic';
