import { parseFile } from 'music-metadata';
import { inspect } from 'node:util';

export default async function getAudioData(filePath: string) {
  try {
    const metadata = await parseFile(filePath);
    return {
      title: metadata.common.title || null,
      artist: metadata.common.artist || null,
      duration: metadata.format.duration || null,
    };
  } catch (error) {
    console.error(`Error reading audio file metadata: ${inspect(error)}`);
    return {
      title: null,
      artist: null,
      duration: null,
    };
  }
}
