import { BaseNamespace } from './BaseNamespace.js';
import type { HomeTheaterOptions } from '../types/homeTheater.js';

export class HomeTheaterNamespace extends BaseNamespace {
  readonly namespace = 'homeTheater:1';

  async getOptions(): Promise<HomeTheaterOptions> {
    const response = await this.send('getOptions');
    return this.body(response) as unknown as HomeTheaterOptions;
  }

  async setOptions(options: Partial<HomeTheaterOptions>): Promise<void> {
    await this.send('setOptions', options);
  }
}
