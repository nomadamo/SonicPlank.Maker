export async function getAudioPeaks(
  audioPathOrUrl: string,
  pixelsPerSecond: number,
): Promise<number[]> {
  let localPath = audioPathOrUrl;
  
  if (localPath.startsWith("file:///")) {
    localPath = decodeURIComponent(localPath.replace("file:///", ""));
  } else if (localPath.startsWith("file://")) {
    localPath = decodeURIComponent(localPath.replace("file://", ""));
  } else if (localPath.startsWith("local-media://")) {
    // Note: If you have a custom protocol for local media, handle it here
    localPath = decodeURIComponent(localPath.replace("local-media://", ""));
  }

  // Under Windows, remove the leading slash if it's like /C:/
  if (localPath.match(/^\/[a-zA-Z]:\//)) {
    localPath = localPath.substring(1);
  }

  return await window.electron.getWaveformPeaks(localPath, pixelsPerSecond);
}
