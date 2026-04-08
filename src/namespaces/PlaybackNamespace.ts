import { BaseNamespace } from './BaseNamespace.js';
import type { PlaybackStatus, PlayModes, LoadLineInOptions } from '../types/playback.js';

export class PlaybackNamespace extends BaseNamespace {
  readonly namespace = 'playback:1';

  async play(): Promise<void> {
    await this.send('play');
  }

  async pause(): Promise<void> {
    await this.send('pause');
  }

  async togglePlayPause(): Promise<void> {
    await this.send('togglePlayPause');
  }

  async stop(): Promise<void> {
    await this.send('stop');
  }

  async skipToNextTrack(): Promise<void> {
    await this.send('skipToNextTrack');
  }

  async skipToPreviousTrack(): Promise<void> {
    await this.send('skipToPreviousTrack');
  }

  async seek(positionMillis: number): Promise<void> {
    await this.send('seek', { positionMillis });
  }

  async seekRelative(deltaMillis: number): Promise<void> {
    await this.send('seekRelative', { deltaMillis });
  }

  async getPlaybackStatus(): Promise<PlaybackStatus> {
    const response = await this.send('getPlaybackStatus');
    return this.body(response) as unknown as PlaybackStatus;
  }

  async setPlayModes(playModes: Partial<PlayModes>): Promise<void> {
    await this.send('setPlayModes', { playModes });
  }

  async loadLineIn(options?: LoadLineInOptions): Promise<void> {
    await this.send('loadLineIn', { ...options });
  }
}
