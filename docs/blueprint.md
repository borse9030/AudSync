# **App Name**: AudSync

## Core Features:

- Room Management: Create and join rooms using a short code, QR code, or invite link.
- Device Presence: Display a list of connected devices in the room and indicate the host.
- Host Controls: Provide host controls for play/pause, seek, next/previous track, and adding tracks (upload or from storage).
- Realtime Playback Sync: Synchronize playback state (playing/paused/position) across devices using Firebase Realtime Database and server timestamps.
- Adaptive Latency Compensation: Measure latency and compensate for network delays to maintain synchronization.
- Content Generation Tool: Uses generative AI to analyze audio tracks and generate suitable descriptions and other metadata for sharing in the playlist view, assisting the host in presenting songs to the room's participants.
- Secure Audio Delivery: Serve audio files via secure signed URLs to prevent unauthorized access.

## Style Guidelines:

- Primary color: Vibrant blue (#29ABE2) for a modern and connected feel.
- Background color: Light blue (#E0F7FA) to provide a clean and unobtrusive backdrop.
- Accent color: Complementary orange (#FFB300) to highlight interactive elements and calls to action.
- Body and headline font: 'Inter' (sans-serif) for a clean, modern, and readable user experience.
- Use clean, minimalist icons to represent playback controls and device status.
- Maintain a simple and intuitive layout, with clear visual hierarchy and easy access to essential controls.
- Subtle animations and transitions to provide feedback and enhance the user experience.