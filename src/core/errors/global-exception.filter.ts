import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { MessageService } from '../messages/message.service';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(private readonly messages: MessageService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = this.messages.get('common.internalError');
    let code = 'INTERNAL_SERVER_ERROR';
    let errors: string[] = [];

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res: any = exception.getResponse();

      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object' && res !== null) {
        message = res.message || message;
        code = res.code || (status === 400 ? 'VALIDATION_ERROR' : 'HTTP_ERROR');
        errors = Array.isArray(res.message) ? res.message : res.errors || [];
      }
    } else if (exception instanceof Error) {
      const providerError = exception as Error & {
        code?: string;
        response?: { status?: number; data?: unknown };
      };
      const details = {
        message: providerError.message || 'Unknown error',
        ...(providerError.code ? { code: providerError.code } : {}),
        ...(providerError.response?.status ? { httpStatus: providerError.response.status } : {}),
        ...(providerError.response?.data !== undefined ? { response: providerError.response.data } : {}),
      };

      console.error('[UNHANDLED ERROR]', JSON.stringify(details));
      message = exception.message || message;
    }

    response.status(status).json({
      success: false,
      code,
      message,
      errors: errors.length > 0 ? errors : undefined,
      timestamp: new Date().toISOString(),
    });
  }
}
