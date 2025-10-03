import { getDatabase, ref, get } from 'firebase/database';
import { app } from '@/lib/firebase'; // Use client SDK for initial checks
import RoomPage from '@/components/RoomPage';
import { notFound } from 'next/navigation';
import { type Room } from '@/lib/types';
import { Music } from 'lucide-react';
import Link from 'next/link';

type Props = {
  params: { roomId: string };
};

async function getRoom(roomId: string): Promise<Room | null> {
  try {
    const db = getDatabase(app);
    const roomRef = ref(db, `rooms/${roomId}`);
    const snapshot = await get(roomRef);
    if (snapshot.exists()) {
      return snapshot.val() as Room;
    }
    return null;
  } catch (error) {
    console.error("Failed to fetch room data on server:", error);
    // This will likely fail on server if not configured for admin access,
    // but we can let the client-side handle the final check.
    return null;
  }
}

export default async function Room({ params }: Props) {
  const { roomId } = params;
  const initialRoomData = await getRoom(roomId);

  if (!initialRoomData) {
    // We can show a not found page, but it's better to let the client
    // try to connect. If it fails there, it will show a toast.
    // For a better UX, we'll proceed and let the client handle non-existence.
    // notFound();
  }

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
        <RoomPage roomId={roomId} initialRoomData={initialRoomData} />
      </main>
    </div>
  );
}

export const dynamic = 'force-dynamic';
