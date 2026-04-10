import type { NamespaceContext } from '../namespaces/BaseNamespace.js';
import { AudioClipNamespace } from '../namespaces/AudioClipNamespace.js';
import type { LoadAudioClipOptions, AudioClipResponse } from '../types/audioClip.js';

/** Plays audio clips (notifications, chimes) that overlay current audio. */
export class AudioClipControl {
  private readonly ns: AudioClipNamespace;
  constructor(context: NamespaceContext) { this.ns = new AudioClipNamespace(context); }

  /**
   * Plays an audio clip.
   * @param options - Clip configuration (name, appId, streamUrl, priority, volume).
   */
  async load(options: LoadAudioClipOptions): Promise<AudioClipResponse> { return this.ns.loadAudioClip(options); }

  /**
   * Cancels a currently playing audio clip.
   * @param clipId - ID of the clip to cancel.
   */
  async cancel(clipId: string): Promise<void> { return this.ns.cancelAudioClip(clipId); }
}
