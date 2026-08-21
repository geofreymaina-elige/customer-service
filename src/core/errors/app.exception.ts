import { HttpException, HttpStatus } from '@nestjs/common';

export class AppException extends HttpException {
  constructor(
    public readonly code: string,
    message: string,
    status: HttpStatus | number = HttpStatus.BAD_REQUEST,
    public readonly errors: string[] = []
  ) {
    super({ success: false, code, message, errors }, status);
  }
}

export class DeviceConflictException extends AppException {
  constructor(message: string = 'User session active on another device.') {
    super('DEVICE_SESSION_CONFLICT', message, HttpStatus.CONFLICT);
  }
}

export class PinLockedException extends AppException {
  constructor(message: string, public readonly lockedUntil?: Date) {
    super('PIN_LOCKED', message, 423);
  }
}
