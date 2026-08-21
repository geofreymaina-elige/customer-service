import { Injectable } from '@nestjs/common';
import * as messagesData from '../../config/messages.json';

@Injectable()
export class MessageService {
  private readonly messages = messagesData;

  /**
   * Retrieve a message by its dot-separated path and interpolate variables.
   * Example: get('auth.pin.invalid', { attemptsRemaining: 2 })
   */
  get(path: string, params: Record<string, string | number> = {}): string {
    const keys = path.split('.');
    let current: any = this.messages;

    for (const key of keys) {
      if (current && typeof current === 'object' && key in current) {
        current = current[key];
      } else {
        return path;
      }
    }

    if (typeof current !== 'string') {
      return path;
    }

    return Object.entries(params).reduce(
      (msg, [paramKey, paramValue]) =>
        msg.replace(new RegExp(`\\{${paramKey}\\}`, 'g'), String(paramValue)),
      current
    );
  }
}
