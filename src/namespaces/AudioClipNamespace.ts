import { BaseNamespace } from './BaseNamespace.js';
import type { LoadAudioClipOptions, AudioClipResponse } from '../types/audioClip.js';

export class AudioClipNamespace extends BaseNamespace {
  readonly namespace = 'audioClip:1';

  async loadAudioClip(options: LoadAudioClipOptions): Promise<AudioClipResponse> {
    const response = await this.send('loadAudioClip', options as unknown as Record<string, unknown>);
    return this.body(response) as unknown as AudioClipResponse;
  }

  async cancelAudioClip(clipId: string): Promise<void> {
    await this.send('cancelAudioClip', { id: clipId });
  }
}
