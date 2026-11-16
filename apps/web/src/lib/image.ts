/**
 * Reduz a foto no próprio aparelho antes de enviar (economiza dados móveis) e,
 * ao redesenhar no canvas, descarta metadados EXIF — inclusive localização GPS.
 * Se o navegador não conseguir processar, envia o arquivo original.
 */
export async function compressImage(file: File, maxSide = 1600, quality = 0.8): Promise<Blob> {
  if (!file.type.startsWith('image/')) return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    return blob && blob.size < file.size ? blob : blob ?? file;
  } catch {
    return file;
  }
}
