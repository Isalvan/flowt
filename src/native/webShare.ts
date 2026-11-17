import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function nativeShare(data: ShareData = {}): Promise<void> {
  const files: string[] = [];
  for (const [index, file] of (data.files ?? []).entries()) {
    const path = `share/${index}-${file.name.replace(/[^\w.-]/g, '_') || 'archivo'}`;
    const written = await Filesystem.writeFile({ path, data: await toBase64(file), directory: Directory.Cache, recursive: true });
    files.push(written.uri);
  }
  try {
    await Share.share({ title: data.title, text: data.text, url: data.url, files: files.length ? files : undefined, dialogTitle: data.title });
  } catch (error) {
    // Closing Android's share sheet is not an error, as with AbortError on the web.
    if (String((error as Error)?.message ?? error).toLowerCase().includes('cancel')) {
      throw new DOMException('Share canceled', 'AbortError');
    }
    throw error;
  }
}

/**
 * Android's web view has no Web Share API, so tickets, Wrapped and the money-flow image
 * would fall back to the clipboard. Route navigator.share to Android's share sheet instead.
 */
export function installWebShare(): void {
  Object.defineProperty(navigator, 'share', { configurable: true, value: nativeShare });
  Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
}
