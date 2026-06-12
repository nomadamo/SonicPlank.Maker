declare global {
  interface Window {
    webkitAudioContext: typeof AudioContext;
  }
}
export class WebAudio {
  #audioContext: AudioContext | null = null;
  #isInitialized = false;

  init(): void {
    if (this.#isInitialized || !this.isClient()) {
      return;
    }

    this.#isInitialized = true;

    if (this.isClient()) {
      const AudioContextClass =
        window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        this.#audioContext = new AudioContextClass();
      }
    }
  }

  getContext(): AudioContext | null {
    if (!this.isClient()) {
      return null;
    }

    if (!this.#audioContext) {
      const AudioContextClass =
        window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        return null;
      }
      this.#audioContext = new AudioContextClass();
    }

    const ctx = this.#audioContext;

    return ctx;
  }

  cleanup(): void {
    if (this.#audioContext) {
      this.#audioContext.close();
      this.#audioContext = null;
    }
    this.#isInitialized = false;
  }

  private isClient(): boolean {
    return typeof window !== "undefined" && !!window.document;
  }
}

export const $webAudio = new WebAudio();

// Patch AudioContext/webkitAudioContext to prevent InvalidStateError when createMediaElementSource is called multiple times on the same HTMLMediaElement.
if (typeof window !== "undefined") {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (AudioContextClass) {
    const originalCreate = AudioContextClass.prototype.createMediaElementSource;
    // Cache map: AudioContext -> WeakMap of HTMLMediaElement -> MediaElementAudioSourceNode
    const contextMap = new WeakMap<AudioContext, WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>>();

    AudioContextClass.prototype.createMediaElementSource = function(
      this: AudioContext,
      mediaElement: HTMLMediaElement
    ) {
      let elementMap = contextMap.get(this);
      if (!elementMap) {
        elementMap = new WeakMap();
        contextMap.set(this, elementMap);
      }

      const cached = elementMap.get(mediaElement);
      if (cached) {
        return cached;
      }

      const sourceNode = originalCreate.call(this, mediaElement);
      elementMap.set(mediaElement, sourceNode);
      return sourceNode;
    };
  }
}
