import { Camera } from '@capacitor/camera';

const CANCELLED = 'OS-PLUG-CAMR-0006';

/** Opens Android's camera for a ticket photo. Resolves to null when the user backs out. */
export async function takeTicketPhoto(): Promise<File | null> {
  try {
    const photo = await Camera.takePhoto({
      quality: 85,
      correctOrientation: true,
      saveToGallery: false,
    });
    if (!photo.webPath) return null;
    const blob = await (await fetch(photo.webPath)).blob();
    return new File([blob], 'ticket.jpg', { type: blob.type || 'image/jpeg' });
  } catch (error) {
    if ((error as { code?: string })?.code === CANCELLED) return null;
    throw error;
  }
}
