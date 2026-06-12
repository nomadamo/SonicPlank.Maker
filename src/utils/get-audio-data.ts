import { parseFile } from 'music-metadata';
import { inspect } from 'node:util';

export interface AudioMetadata {
  title: string | null;
  artist: string | null;
  album: string | null;
  duration: number | null;
  albumArt: string | null; // base64 data URL
}

export default async function getAudioData(filePath: string): Promise<AudioMetadata> {
  try {
    const metadata = await parseFile(filePath);

    // Extract album art if available
    let albumArt: string | null = null;
    const pictures = metadata.common.picture;
    if (pictures && pictures.length > 0) {
      const pic = pictures[0];
      const base64 = Buffer.from(pic.data).toString('base64');
      const mimeType = pic.format || 'image/jpeg';
      albumArt = `data:${mimeType};base64,${base64}`;
    }

    return {
      title: metadata.common.title || null,
      artist: metadata.common.artist || null,
      album: metadata.common.album || null,
      duration: metadata.format.duration || null,
      albumArt,
    };
  } catch (error) {
    console.error(`Error reading audio file metadata: ${inspect(error)}`);
    return {
      title: null,
      artist: null,
      album: null,
      duration: null,
      albumArt: null,
    };
  }
}
