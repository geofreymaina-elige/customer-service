import { SetMetadata } from '@nestjs/common';

/**
 * Decorator to mark a route as public (skips API key validation).
 * 
 * Usage:
 * @Public()
 * @Get('health')
 * healthCheck() { ... }
 */
export const Public = () => SetMetadata('isPublic', true);
