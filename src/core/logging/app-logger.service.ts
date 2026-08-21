import { Injectable, LoggerService } from '@nestjs/common';

@Injectable()
export class AppLogger implements LoggerService {
  log(message: string, context?: string) {
    console.log(`[${new Date().toISOString()}] [INFO] [${context || 'Application'}] ${message}`);
  }

  error(message: string, trace?: string, context?: string) {
    console.error(`[${new Date().toISOString()}] [ERROR] [${context || 'Application'}] ${message}`, trace ? `\nTrace: ${trace}` : '');
  }

  warn(message: string, context?: string) {
    console.warn(`[${new Date().toISOString()}] [WARN] [${context || 'Application'}] ${message}`);
  }

  debug(message: string, context?: string) {
    console.debug(`[${new Date().toISOString()}] [DEBUG] [${context || 'Application'}] ${message}`);
  }
}
