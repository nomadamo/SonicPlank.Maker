import { SUPPORTED_AUDIO_EXTENSIONS, SUPPORTED_STREAM_EXTENSIONS } from "@/constants/audio";

export function isSupportedAudioFile(fileName: string): boolean {
  const ext = fileName.toLowerCase().slice(fileName.lastIndexOf("."));
  return SUPPORTED_AUDIO_EXTENSIONS.includes(ext);
}

export function formatTime(seconds: number | undefined | null): string {
  if (seconds === undefined || seconds === null || isNaN(seconds)) return "--:--";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export async function extractStreamInfo(file: File): Promise<{ url: string; title: string } | null> {
  const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
  if (!SUPPORTED_STREAM_EXTENSIONS.includes(ext)) {
    return null;
  }

  try {
    const text = await file.text();
    const fileName = file.name.replace(/\.[^.]+$/, "");
    let url = "";
    let title = fileName;

    if (ext === ".url" || ext === ".desktop") {
      const urlMatch = text.match(/^URL\s*=\s*(https?:\/\/\S+)/im);
      if (urlMatch) {
        url = urlMatch[1].trim();
      }
    } else if (ext === ".pls") {
      const fileMatch = text.match(/^File\d*\s*=\s*(https?:\/\/\S+)/im);
      if (fileMatch) {
        url = fileMatch[1].trim();
      }
      const titleMatch = text.match(/^Title\d*\s*=\s*(.+)/im);
      if (titleMatch) {
        title = titleMatch[1].trim();
      }
    } else if (ext === ".m3u" || ext === ".m3u8") {
      const lines = text.split(/\r?\n/);
      let extinfTitle = "";
      
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("#EXTINF:")) {
          const commaIdx = trimmed.indexOf(",");
          if (commaIdx !== -1) {
            extinfTitle = trimmed.slice(commaIdx + 1).trim();
          }
        } else if (trimmed && !trimmed.startsWith("#")) {
          if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
            url = trimmed;
            if (extinfTitle) {
              title = extinfTitle;
            }
            break;
          }
        }
      }
    } else if (ext === ".asx") {
      const hrefMatch = text.match(/href\s*=\s*["'](https?:\/\/[^"']+)["']/i);
      if (hrefMatch) {
        url = hrefMatch[1].trim();
      }
      const titleMatch = text.match(/<title>([^<]+)<\/title>/i);
      if (titleMatch) {
        title = titleMatch[1].trim();
      }
    } else if (ext === ".xspf") {
      const locationMatch = text.match(/<location>([^<]+)<\/location>/i);
      if (locationMatch) {
        url = locationMatch[1].trim();
      }
      const titleMatch = text.match(/<title>([^<]+)<\/title>/i);
      if (titleMatch) {
        title = titleMatch[1].trim();
      }
    }

    if (url) {
      return { url, title };
    }
  } catch (err) {
    console.error(`[Library DragDrop] Failed to parse stream file ${file.name}:`, err);
  }

  return null;
}
