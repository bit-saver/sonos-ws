import { BaseNamespace } from './BaseNamespace.js';
import type { LoadAudioClipOptions, AudioClipResponse } from '../types/audioClip.js';

/**
 * Plays audio clips (e.g. notifications, chimes) that overlay the current
 * audio without interrupting playback.
 *
 * Maps to the Sonos WebSocket Control API `audioClip:1` namespace.
 */
export class AudioClipNamespace extends BaseNamespace {
  readonly namespace = 'audioClip:1';

  /**
   * Plays an audio clip with the specified options.
   *
   * The clip is mixed on top of any currently playing audio and does not
   * affect the playback queue.
   *
   * @param options - Configuration for the audio clip (URL, volume, priority, etc.).
   * @returns Details about the queued audio clip, including its clip ID.
   */
  async loadAudioClip(options: LoadAudioClipOptions): Promise<AudioClipResponse> {
    const response = await this.send('loadAudioClip', options as unknown as Record<string, unknown>);
    return this.body(response) as unknown as AudioClipResponse;
  }

  /**
   * Cancels a currently playing audio clip.
   *
   * @param clipId - The ID of the audio clip to cancel.
   */
  async cancelAudioClip(clipId: string): Promise<void> {
    await this.send('cancelAudioClip', { id: clipId });
  }
}
