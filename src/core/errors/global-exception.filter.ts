import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { MessageService } from '../messages/message.service';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(private readonly messages: MessageService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'An unexpected server error occurred. Please try again later.';
    let code = 'INTERNAL_SERVER_ERROR';
    let errors: string[] = [];

    // Extract request details for logging
    const requestDetails = {
      method: request.method,
      path: request.path,
      url: request.url,
      query: request.query,
      headers: {
        'x-astpp-token': request.headers['x-astpp-token'] ? '[REDACTED]' : undefined,
        'content-type': request.headers['content-type'],
        'user-agent': request.headers['user-agent']
      },
      body: this.sanitizeBody(request.body),
      astppId: this.extractAstppId(request)
    };

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res: any = exception.getResponse();

      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object' && res !== null) {
        // Handle validation errors from class-validator
        if (Array.isArray(res.message)) {
          try {
            message = this.messages.get('common.validationError');
          } catch (e) {
            message = 'Validation failed on the submitted data.';
          }
          errors = res.errors || res.message;
          code = 'VALIDATION_ERROR';
        } else if (res.code === 'VALIDATION_ERROR') {
          try {
            message = this.messages.get('common.validationError');
          } catch (e) {
            message = 'Validation failed on the submitted data.';
          }
          errors = res.errors || [];
          code = 'VALIDATION_ERROR';
        } else {
          message = res.message || message;
          code = res.code || (status === 400 ? 'VALIDATION_ERROR' : 'HTTP_ERROR');
          errors = res.errors || [];
        }
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

    // Log error details for debugging (after processing)
    console.error('[ERROR TRACE]', {
      timestamp: new Date().toISOString(),
      request: requestDetails,
      exception: exception instanceof Error ? {
        name: exception.name,
        message: exception.message,
        stack: exception.stack
      } : exception,
      httpStatus: status,
      code,
      errors,
      userMessage: message
    });

    response.status(status).json({
      success: false,
      code,
      message,
      errors: errors.length > 0 ? errors : undefined,
      timestamp: new Date().toISOString(),
    });
  }

  private sanitizeBody(body: any): any {
    if (!body) return undefined;
    const sanitized = { ...body };
    // Remove sensitive fields from body
    if (sanitized.pin) sanitized.pin = '[REDACTED]';
    if (sanitized.password) sanitized.password = '[REDACTED]';
    if (sanitized.otp) sanitized.otp = '[REDACTED]';
    return sanitized;
  }

  private extractAstppId(request: Request): string | undefined {
    const body = request.body as any;
    const query = request.query as any;
    const params = request.params as any;
    
    return params.astppId || query.astppId || body.astppId || body.astpp_id;
  }
}
