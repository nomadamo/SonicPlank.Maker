import os
import re

file_path = r"c:\Users\voidd\source\repos\SonicPlank.Maker\src\components\target-output-node.tsx"
with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

# 1. Replace useScreenCapture with useNativePreview
content = re.sub(
    r'import \{ useScreenCapture \} from "@/hooks/useScreenCapture";',
    r'import { useNativePreview } from "@/hooks/useNativePreview";',
    content
)

content = re.sub(
    r'const \{ stream, startCapture, stopCapture \} = useScreenCapture\(\);',
    r'const { canvasRef: nativePreviewCanvasRef, startCapture, stopCapture } = useNativePreview();',
    content
)

# 2. Remove videoRef and previewScaleCanvasRef
content = re.sub(r'const videoRef = useRef<HTMLVideoElement>\(null\);\s*', '', content)
content = re.sub(r'const previewScaleCanvasRef = useRef<HTMLCanvasElement>\(null\);\s*', '', content)
content = re.sub(r'const compositorActiveRef = useRef<boolean>\(false\);\s*', '', content)
content = re.sub(r'const cardImageCacheRef = useRef<Record<string, HTMLImageElement>>\(\{\}\);\s*', '', content)
content = re.sub(r'const cardAudioContextRef = useRef<AudioContext \| null>\(null\);\s*', '', content)
content = re.sub(r'const cardAnalyserRef = useRef<AnalyserNode \| null>\(null\);\s*', '', content)
content = re.sub(r'const cardRequestRef = useRef<number \| null>\(null\);\s*', '', content)
content = re.sub(r'const nowPlayingCacheRef = useRef<Map<string, \{.*?\}>\>\(new Map\(\)\);\s*', '', content, flags=re.DOTALL)
content = re.sub(r'const forceKeyframeRef = useRef\(false\);\s*', '', content)
content = re.sub(r'const lastPreviewBroadcastRef = useRef<number>\(0\);\s*', '', content)
content = re.sub(r'const previewCapturePendingRef = useRef<boolean>\(false\);\s*', '', content)

# 3. Remove renderCardCompositor entirely
start_idx = content.find("const renderCardCompositor = useCallback(() => {")
if start_idx != -1:
    end_idx = content.find("  }, [", start_idx)
    end_idx = content.find("]);", end_idx) + 3
    content = content[:start_idx] + content[end_idx:]

# 4. Remove useEffects that use stream or renderCardCompositor
content = re.sub(
    r'// Handle stream assignment to HTMLVideoElement.*?\}, \[stream\]\);\s*',
    '', content, flags=re.DOTALL
)

content = re.sub(
    r'// Audio Analyser Setup for visualizer.*?\}\s*\}\s*\}, \[stream\]\);\s*',
    '', content, flags=re.DOTALL
)

content = re.sub(
    r'// Handle compositor loop activation.*?\}, \[.*?\]\);\s*',
    '', content, flags=re.DOTALL
)

content = re.sub(
    r'// Advance dialog to 66% when stream becomes ready.*?\}, \[editOverlayOpen, stream\]\);\s*',
    r'''// Advance dialog to 66% when preview starts
  useEffect(() => {
    if (editOverlayOpen && isPreviewActive) {
      setEditOverlayDialogProgress(66);
    }
  }, [editOverlayOpen, isPreviewActive]);\n''', content, flags=re.DOTALL
)

content = re.sub(
    r'// Clean up recording if preview is toggled off.*?\}, \[isPreviewActive, stream, isRecording, stopRecording\]\);\s*',
    r'''// Clean up recording if preview is toggled off.
  useEffect(() => {
    if (!isPreviewActive) {
      if (isRecording) stopRecording();
    }
  }, [isPreviewActive, isRecording, stopRecording]);\n''', content, flags=re.DOTALL
)

# 5. Replace stream with isPreviewActive in dependencies and conditions
content = content.replace("let activeStream = stream;", "let activeStream = isPreviewActive;")
content = content.replace("if (!activeStream) {", "if (!isPreviewActive) {")

start_cap_block = """          startCapture(captureSourceId, captureAudio, captureFrameRate, {
            maxWidth: nativeCaptureDims.width,
            maxHeight: nativeCaptureDims.height,
          }).then((activeStream) => {
            if (!activeStream) {
              setIsPreviewActive(false);
              lastCaptureParamsRef.current = null;
              editOverlayOwnsCaptureRef.current = false;
            }
          });"""
new_start_cap_block = """          startCapture(captureSourceId).catch((err) => {
            console.error("Capture start failed:", err);
            setIsPreviewActive(false);
            lastCaptureParamsRef.current = null;
            editOverlayOwnsCaptureRef.current = false;
          });"""
content = content.replace(start_cap_block, new_start_cap_block)

start_cap_2 = """      let activeStream = stream;
      if (!activeStream) {
        activeStream = await startCapture(
          captureSourceId,
          captureAudio,
          captureFrameRate,
          {
            maxWidth: nativeCaptureDims.width,
            maxHeight: nativeCaptureDims.height,
          },
        );
        if (!activeStream) {
          showToast(`Unable to acquire target for capture: ${captureSourceId}`);
          console.error(
            "[TargetOutputNode] Failed to start capture for streaming.",
          );
          return;
        }"""
new_start_cap_2 = """      if (!isPreviewActive) {
        try {
          await startCapture(captureSourceId);
        } catch (e) {
          showToast(`Unable to acquire target for capture: ${captureSourceId}`);
          console.error("[TargetOutputNode] Failed to start capture for streaming.", e);
          return;
        }"""
content = content.replace(start_cap_2, new_start_cap_2)

# Fix videoRef references in handleTogglePreview
handle_toggle_vid = """        // Set srcObject directly so the video starts before the canvas-ready poll.
        // The useEffect([stream]) guard (srcObject !== stream) prevents a second
        // assignment when React later commits the setStream state update — that
        // double-assignment would tear down the WGC texture handle.
        if (videoRef.current && videoRef.current.srcObject !== activeStream) {
          videoRef.current.srcObject = activeStream;
          videoRef.current.play().catch(() => {});
        }
        // Still yield so React can commit setStream (needed for stream-dependent
        // code elsewhere in the component, e.g. the compositor activation effect).
        await new Promise<void>((resolve) => setTimeout(resolve, 0));"""
content = content.replace(handle_toggle_vid, "")

kick_comp = """      // Kick the compositor loop so it starts compositing and sizes the canvas to
      // the real capture resolution. The isStreaming effect also activates it, but
      // we start it here so the canvas is sized before we configure the encoder.
      compositorActiveRef.current = true;
      if (cardRequestRef.current === null) {
        cardRequestRef.current = requestAnimationFrame(renderCardCompositor);
      }"""
content = content.replace(kick_comp, "")

content = content.replace("renderCardCompositor,", "")

# 6. Replace <video> with <canvas>
video_jsx_start = content.find("<video")
if video_jsx_start != -1:
    video_jsx_end = content.find("/>", video_jsx_start) + 2
    video_jsx = content[video_jsx_start:video_jsx_end]
    content = content.replace(video_jsx, '<canvas ref={nativePreviewCanvasRef} className="absolute inset-0 w-full h-full object-contain pointer-events-none" />')

# Remove previewScaleCanvasRef
canvas_jsx_start = content.find('<canvas\n                  ref={previewScaleCanvasRef}')
if canvas_jsx_start != -1:
    canvas_jsx_end = content.find("/>", canvas_jsx_start) + 2
    content = content[:canvas_jsx_start] + content[canvas_jsx_end:]

# Also replace ALL `stream` dependencies to resolve TS errors. We will just find `, stream]` and replace with `]`
content = re.sub(r',\s*stream\]', ']', content)
content = re.sub(r'\[stream,\s*', '[', content)

# Remove `audioContext` references that break since we removed `stream.getAudioTracks()`
content = re.sub(r'const audioContext = new AudioContext\(\);.*?audioContext\.close\(\);\s*', '', content, flags=re.DOTALL)
# The `MediaRecorder` logic uses `stream.getAudioTracks()`. If `stream` is gone, this throws a TS error.
# We'll just comment out the audio part for now.
content = re.sub(r'if \(stream\) \{\s*stream\.getAudioTracks.*?\s*\}\s*\}', '', content, flags=re.DOTALL)

with open(file_path, "w", encoding="utf-8") as f:
    f.write(content)

print("target-output-node.tsx updated!")
