"use client"

import RoomPage from '@/components/RoomPage';
import { Music, LoaderCircle } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

type Props = {
  params: { roomId: string };
};

export default function Room({ params }: Props) {
  const { roomId } = params;
  const [isClient, setIsClient] = React.useState(false);

  React.useEffect(() => {
    setIsClient(true);
  }, []);

  return (
    <div className="flex h-screen flex-col bg-transparent text-foreground overflow-hidden">
      <header className="flex h-16 items-center justify-between border-b border-white/10 bg-black/30 backdrop-blur-sm px-4 md:px-6 flex-shrink-0">
        <Link href="/" className="flex items-center gap-2 text-xl font-bold text-primary transition-transform hover:scale-105">
          <Music className="h-6 w-6" />
          <span className="font-headline">AudSync</span>
        </Link>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>Room:</span>
          <span className="font-mono text-primary font-semibold tracking-wider">{roomId.toUpperCase()}</span>
        </div>
      </header>
      <main className="flex-1 overflow-auto">
        {isClient ? (
          <RoomPage roomId={roomId.toUpperCase()} />
        ) : (
          <div className="flex h-full items-center justify-center">
            <LoaderCircle className="h-10 w-10 animate-spin text-primary" />
          </div>
        )}
      </main>
    </div>
  );
}
