import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

interface SharedImage { path: string; mimeType: string }
interface ShareTargetPlugin {
  takePending(): Promise<{ share?: SharedImage }>;
  addListener(event: 'shareReceived', listener: () => void): Promise<PluginListenerHandle>;
}

// Implemented in android/app/src/main/java/com/isalvan/flowt/ShareTargetPlugin.java.
const ShareTarget = registerPlugin<ShareTargetPlugin>('ShareTarget');

async function takeSharedImage(): Promise<File | null> {
  const { share } = await ShareTarget.takePending();
  if (!share) return null;
  const response = await fetch(Capacitor.convertFileSrc(share.path));
  if (!response.ok) return null;
  const blob = await response.blob();
  const name = share.path.split('/').pop() || 'ticket.jpg';
  return new File([blob], name, { type: share.mimeType || blob.type });
}

/**
 * Calls `onImage` with every photo shared to Flowt from another app ("Compartir" → Flowt),
 * including the one that launched the app. Returns a function that stops listening.
 */
export function onSharedImage(onImage: (file: File) => void): () => void {
  let active = true;
  const deliver = () => {
    void takeSharedImage()
      .then(file => { if (file && active) onImage(file); })
      .catch(error => console.error('Shared image could not be read:', error));
  };
  const handle = ShareTarget.addListener('shareReceived', deliver);
  deliver();
  return () => {
    active = false;
    void handle.then(h => h.remove());
  };
}
