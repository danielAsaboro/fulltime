import b4a from "b4a";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";

const MAX_FILE_BYTES = 16 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf", "text/plain"];

type Request = <T>(action: string, payload: unknown) => Promise<T>;

export async function pickAndUploadAttachment(request: Request, roomId: string, text = ""): Promise<unknown | null> {
  const picked = await DocumentPicker.getDocumentAsync({
    type: ALLOWED_TYPES,
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (picked.canceled) return null;
  const asset = picked.assets[0];
  if (!asset || !Number.isSafeInteger(asset.size) || !asset.size || asset.size > MAX_FILE_BYTES) {
    throw new Error(`Attachments must be between 1 byte and ${MAX_FILE_BYTES / (1024 * 1024)} MiB.`);
  }
  const source = b4a.from(await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 }), "base64");
  if (source.byteLength !== asset.size) throw new Error("The selected attachment changed while it was being imported.");
  const upload = await request<{ uploadId: string; chunkBytes: number }>("room.media.upload.begin", {
    roomId,
    name: asset.name,
    sizeBytes: source.byteLength,
  });
  try {
    let index = 0;
    for (let offset = 0; offset < source.byteLength; offset += upload.chunkBytes) {
      const chunk = source.subarray(offset, Math.min(source.byteLength, offset + upload.chunkBytes));
      await request("room.media.upload.chunk", { roomId, uploadId: upload.uploadId, index, data: b4a.toString(chunk, "base64") });
      index++;
    }
    return await request("room.media.upload.commit", { roomId, uploadId: upload.uploadId, text: text.trim() });
  } catch (error) {
    await request("room.media.upload.abort", { roomId, uploadId: upload.uploadId }).catch(() => undefined);
    throw error;
  } finally {
    source.fill(0);
  }
}

export async function downloadAndShareAttachment(request: Request, roomId: string, itemId: string): Promise<void> {
  const download = await request<{ downloadId: string; name: string; mimeType: string; sizeBytes: number; chunks: number }>("room.media.download.begin", { roomId, itemId });
  const output = b4a.alloc(download.sizeBytes);
  let offset = 0;
  try {
    for (let index = 0; index < download.chunks; index++) {
      const response = await request<{ data: string }>("room.media.download.chunk", { roomId, downloadId: download.downloadId, index });
      const chunk = b4a.from(response.data, "base64");
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    if (offset !== output.byteLength) throw new Error("The verified attachment download was incomplete.");
    const directory = FileSystem.cacheDirectory;
    if (!directory) throw new Error("FullTime cannot access temporary sharing storage.");
    const extension = download.name.match(/\.[a-zA-Z0-9]{1,8}$/)?.[0] ?? "";
    const path = `${directory}fulltime-${download.downloadId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64)}${extension}`;
    await FileSystem.writeAsStringAsync(path, b4a.toString(output, "base64"), { encoding: FileSystem.EncodingType.Base64 });
    if (!(await Sharing.isAvailableAsync())) throw new Error("Native file sharing is unavailable on this device.");
    await Sharing.shareAsync(path, { mimeType: download.mimeType, dialogTitle: download.name, UTI: undefined });
    await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => undefined);
  } finally {
    output.fill(0);
    await request("room.media.download.close", { roomId, downloadId: download.downloadId }).catch(() => undefined);
  }
}
