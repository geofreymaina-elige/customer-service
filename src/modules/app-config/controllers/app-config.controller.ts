import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiSecurity, ApiHeader } from '@nestjs/swagger';
import { Request } from 'express';
import { AppConfigService } from '../services/app-config.service';
import {
  BannerAudience,
  OptionalAstppBannerGuard,
} from '../../../core/auth/optional-astpp-banner.guard';

@ApiTags('Configuration and Banners')
@ApiSecurity('API-Key')
@Controller('api/v1')
export class AppConfigController {
  constructor(private readonly appConfigService: AppConfigService) {}

  @Get('app-config')
  @ApiOperation({
    summary: 'Get App Configuration',
    description: 'Retrieve service availability and feature flags. Disabled feature flags include their configured error message.',
  })
  @ApiResponse({
    status: 200,
    description: 'App configuration retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        services: {
          type: 'object',
          properties: {
            esim: { type: 'boolean', example: true },
            wallet: { type: 'boolean', example: false },
            voip: { type: 'boolean', example: true },
          },
        },
        status: { type: 'string', example: 'success' },
        feature_flags: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              service: { type: 'string', example: 'wallet' },
              feature_key: { type: 'string', example: 'topup.mpesa' },
              parent_key: { type: 'string', nullable: true, example: 'topup' },
              name: { type: 'string', example: 'Top-up via M-Pesa' },
              description: { type: 'string', example: 'Allows customers to top up using M-Pesa.' },
              is_enabled: { type: 'boolean', example: false },
              message: {
                type: 'string',
                nullable: true,
                example: 'This feature is temporarily unavailable. Please try again later.',
                description: 'Configured error message when the feature is disabled; null when enabled.',
              },
            },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid or missing API key',
  })
  async getAppConfig() {
    return this.appConfigService.getAppConfig();
  }

  @Get('banners')
  @ApiHeader({
    name: 'X-Astpp-Id',
    required: false,
    description: 'ASTPP account ID used with X-Astpp-Token for optional banner authentication.',
    example: '1862533',
  })
  @ApiHeader({
    name: 'X-Astpp-Token',
    required: false,
    description: 'Optional ASTPP token. If missing or invalid, general banners are returned.',
    example: 'encrypted-astpp-token',
  })
  @ApiHeader({
    name: 'X-Fcm-Token',
    required: false,
    description: 'Optional Firebase registration token, used for future authenticated device-level banner targeting.',
    example: 'fcm-registration-token',
  })
  @ApiOperation({
    summary: 'Get App Banners',
    description: 'Retrieve banner carousel slots 1-5. Only X-API-Key is required. When X-Astpp-Id and X-Astpp-Token authenticate an existing customer, their identity (and optional X-Fcm-Token) is available for targeting. Missing/invalid authentication or an unknown customer falls back to general banners. Slot 1 is returned as the hero section; slots 2-5 are returned as feature cards.',
  })
  @ApiResponse({
    status: 200,
    description: 'Banners retrieved successfully',
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
                card_uuid: { type: 'string', example: 'card-uuid-456' },
                card_slug: { type: 'string', example: 'banner_slot_1' },
                slot: { type: 'number', example: 1 },
                asset_uuid: { type: 'string', example: 'hero-uuid-123' },
                asset_key: { type: 'string', example: 'banner_slot_1' },
                updated_at: { type: 'string', example: '2026-10-05T10:30:00Z' },
                url: { type: 'string', example: 'https://cdn.ambiapay.com/images/hero-banner.jpg' },
                alt_text: { type: 'string', example: 'Welcome to AmbiaPay' },
                title: { type: 'string', example: 'Banner Slot 1' },
                subtitle: { type: 'string', example: '' },
              },
            },
            feature_cards: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  card_uuid: { type: 'string', example: 'card-uuid-456' },
                  card_slug: { type: 'string', example: 'banner_slot_2' },
                  slot: { type: 'number', example: 2 },
                  asset_uuid: { type: 'string', example: 'asset-uuid-789' },
                  asset_key: { type: 'string', example: 'send_money_icon' },
                  updated_at: { type: 'string', example: '2026-10-05T10:30:00Z' },
                  url: { type: 'string', example: 'https://cdn.ambiapay.com/images/send-money.png' },
                  alt_text: { type: 'string', nullable: true, example: 'Mt Kenya' },
                  title: { type: 'string', example: 'Send Money' },
                  subtitle: { type: 'string', example: 'Transfer funds instantly' },
                },
              },
            },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid or missing API key',
  })
  @UseGuards(OptionalAstppBannerGuard)
  async getBanners(@Req() request: Request & { bannerAudience?: BannerAudience }) {
    return this.appConfigService.getBanners(request.bannerAudience);
  }
}
