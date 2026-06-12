export async function getAudioPeaks(
  arrayBuffer: ArrayBuffer,
  pixelsPerSecond: number,
): Promise<number[]> {
  const audioContext = new (
    window.AudioContext || (window as any).webkitAudioContext
  )();
  const audioBufferData = await audioContext.decodeAudioData(arrayBuffer);
  const channelData = audioBufferData.getChannelData(0); // Use left channel

  // Calculate exactly how many audio samples represent one pixel
  const step = Math.ceil(audioBufferData.sampleRate / pixelsPerSecond);
  const peaks: number[] = [];

  // Calculate the total number of peaks (pixels) needed for the entire file
  const totalWidth = Math.ceil(channelData.length / step);

  for (let i = 0; i < totalWidth; i++) {
    let min = 1.0;
    let max = -1.0;

    for (let j = 0; j < step; j++) {
      const index = i * step + j;
      if (index >= channelData.length) break; // Don't read past the end

      const datum = channelData[index];
      if (datum < min) min = datum;
      if (datum > max) max = datum;
    }

    // Push the peak magnitude
    peaks.push((max - min) / 2);
  }

  return peaks;
}
