import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiSecurity } from '@nestjs/swagger';
import { AppConfigService } from '../services/app-config.service';
import { AuthGuard } from '../../../core/auth/auth.guard';
import { RequireScopes } from '../../../core/auth/scopes.decorator';
import { JwtScopes } from '../../../core/auth/jwt.service';

@ApiTags('Configuration')
@ApiSecurity('API-Key')
@Controller('api/v1')
export class AppConfigController {
  constructor(private readonly appConfigService: AppConfigService) {}

  @Get('app-config')
  @UseGuards(AuthGuard)
  @RequireScopes(JwtScopes.AppAccess)
  @ApiOperation({
    summary: 'Get App Configuration',
    description: 'Retrieve the mobile app home page layout configuration including hero section and feature cards. This endpoint provides URLs for images and content to display on the app home screen.',
  })
  @ApiSecurity('AppAccessToken')
  @ApiResponse({
    status: 200,
    description: 'App configuration retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'success' },
        layout_version: { type: 'string', example: '2026-09-30-v1' },
        page_layout: {
          type: 'object',
          properties: {
            hero_section: {
              type: 'object',
              properties: {
                asset_uuid: { type: 'string', example: 'hero-uuid-123' },
                asset_key: { type: 'string', example: 'hero_banner' },
                updated_at: { type: 'string', example: '2026-10-05T10:30:00Z' },
                url: { type: 'string', example: 'https://cdn.ambiapay.com/images/hero-banner.jpg' },
                alt_text: { type: 'string', example: 'Welcome to AmbiaPay' }
              }
            },
            feature_cards: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  card_uuid: { type: 'string', example: 'card-uuid-456' },
                  card_slug: { type: 'string', example: 'send-money' },
                  asset_uuid: { type: 'string', example: 'asset-uuid-789' },
                  asset_key: { type: 'string', example: 'send_money_icon' },
                  updated_at: { type: 'string', example: '2026-10-05T10:30:00Z' },
                  url: { type: 'string', example: 'https://cdn.ambiapay.com/images/send-money.png' },
                  title: { type: 'string', example: 'Send Money' },
                  subtitle: { type: 'string', example: 'Transfer funds instantly' }
                }
              }
            }
          }
        }
      }
    }
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid or missing AppAccessToken',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        message: { type: 'string', example: 'Unauthorized' }
      }
    }
  })
  @ApiResponse({
    status: 404,
    description: 'No active configuration found',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: false },
        message: { type: 'string', example: 'No active hero asset found' }
      }
    }
  })
  async getAppConfig() {
    const data = await this.appConfigService.getAppConfig();
    return data;
  }
}
