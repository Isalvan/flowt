export interface PreparedTicketImage {
  image: string;
  mime: 'image/jpeg';
  preview: string;
}

export function ticketImageSize(width: number, height: number): { width: number; height: number } {
  if (width <= 0 || height <= 0 || !Number.isFinite(width + height)) throw new Error('La imagen no tiene un tamaño válido.');
  const scale = Math.min(1, 1600 / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** The photo stays in memory; only the resized JPEG is sent to the scanner. */
export async function prepareTicketImage(file: File): Promise<PreparedTicketImage> {
  if (!file.type.startsWith('image/')) throw new Error('Selecciona una foto del ticket.');
  const url = URL.createObjectURL(file);
  try {
    const photo = new Image();
    await new Promise<void>((resolve, reject) => {
      photo.onload = () => resolve();
      photo.onerror = () => reject(new Error('No se ha podido abrir la foto. Prueba con una imagen JPEG o PNG.'));
      photo.src = url;
    });
    const size = ticketImageSize(photo.naturalWidth, photo.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No se ha podido preparar la foto.');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(photo, 0, 0, canvas.width, canvas.height);
    const preview = canvas.toDataURL('image/jpeg', 0.8);
    if (!preview.startsWith('data:image/jpeg;base64,')) throw new Error('No se ha podido preparar la foto.');
    return { image: preview.split(',')[1], mime: 'image/jpeg', preview };
  } finally {
    URL.revokeObjectURL(url);
  }
}
