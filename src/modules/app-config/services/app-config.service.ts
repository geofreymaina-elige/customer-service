import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { DatabaseService } from '../../../core/database/database.service';
import {
  AppConfigResponse,
  BannersResponse,
  HeroSection,
  FeatureCard,
  FeatureFlag,
  PageLayout,
} from '../dto/app-config.dto';
import { BannerAudience } from '../../../core/auth/optional-astpp-banner.guard';

interface BannerRecord {
  card_uuid: string;
  card_slug: string;
  slot: number;
  title: string;
  subtitle: string | null;
  asset_uuid: string;
  asset_key: string;
  url: string;
  alt_text: string | null;
  updated_at: Date;
}

interface SegmentMembershipResponse {
  astppId?: number | string;
  primarySegment?: {
    segmentId?: number | string;
  } | null;
}

@Injectable()
export class AppConfigService {
  private readonly logger = new Logger(AppConfigService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
  ) {}

  async getAppConfig(): Promise<AppConfigResponse> {
    const featureFlags = await this.db.query<FeatureFlag>(
      `SELECT service, feature_key, parent_key, name, description, is_enabled,
              CASE WHEN is_enabled THEN NULL ELSE error_message END AS message
       FROM feature_flags
       ORDER BY service ASC, feature_key ASC`
    );

    return {
      services: {
        esim: true,
        wallet: false,
        voip: true,
      },
      status: 'success',
      feature_flags: featureFlags.rows,
    };
  }

  async getBanners(audience?: BannerAudience): Promise<BannersResponse> {
    const primarySegmentId = audience
      ? await this.fetchPrimarySegmentId(audience.astppId)
      : null;
    const banners = await this.db.query<BannerRecord>(
      `SELECT
        fc.card_uuid,
        fc.card_slug,
        fc.display_order AS slot,
        COALESCE(segment_override.title, fc.title) AS title,
        COALESCE(segment_override.subtitle, fc.subtitle) AS subtitle,
        COALESCE(segment_override.asset_uuid, aa.asset_uuid) AS asset_uuid,
        COALESCE(segment_override.asset_key, aa.asset_key) AS asset_key,
        COALESCE(segment_override.url, aa.url) AS url,
        COALESCE(segment_override.alt_text, aa.alt_text) AS alt_text,
        COALESCE(segment_override.updated_at, aa.updated_at) AS updated_at
       FROM feature_cards fc
       LEFT JOIN app_assets aa
         ON aa.id = fc.asset_id
        AND aa.is_active = TRUE
       LEFT JOIN LATERAL (
         SELECT
           sb.title,
           sb.subtitle,
           COALESCE(sb.alt_text, segment_asset.alt_text) AS alt_text,
           segment_asset.asset_uuid,
           segment_asset.asset_key,
           segment_asset.url,
           segment_asset.updated_at
         FROM segment_banners sb
         INNER JOIN app_assets segment_asset
           ON segment_asset.id = sb.asset_id
          AND segment_asset.is_active = TRUE
         WHERE sb.external_segment_id = $1
           AND sb.slot_number = fc.display_order
           AND sb.is_active = TRUE
         ORDER BY sb.display_priority ASC, sb.id ASC
         LIMIT 1
       ) segment_override ON TRUE
       WHERE fc.is_active = TRUE
         AND fc.display_order BETWEEN 1 AND 5
         AND fc.card_slug LIKE 'banner_slot_%'
         AND (segment_override.asset_uuid IS NOT NULL OR aa.id IS NOT NULL)
       ORDER BY fc.display_order ASC`,
      [primarySegmentId]
    );

    const heroBanner = banners.rows.find(
      (banner) => banner.slot === 1 && banner.card_slug === 'banner_slot_1'
    );

    if (!heroBanner) {
      throw new NotFoundException('No active hero asset found');
    }

    const toBannerResponse = (banner: BannerRecord): FeatureCard => ({
      ...banner,
      updated_at: banner.updated_at.toISOString(),
      url: banner.url.trim(),
      alt_text: banner.alt_text || '',
      subtitle: banner.subtitle || '',
    });

    const heroSection: HeroSection = toBannerResponse(heroBanner);
    const featureCardsList = banners.rows
      .filter((banner) => banner !== heroBanner)
      .map(toBannerResponse);

    const pageLayout: PageLayout = {
      hero_section: heroSection,
      feature_cards: featureCardsList,
    };

    return {
      status: 'success',
      layout_version: '2026-09-30-v1',
      page_layout: pageLayout,
    };
  }

  private async fetchPrimarySegmentId(astppId: string): Promise<number | null> {
    const accountId = Number(astppId);
    if (!Number.isSafeInteger(accountId) || accountId <= 0) {
      this.logger.warn('Invalid ASTPP ID for segment lookup; using general banners.');
      return null;
    }

    const apiKey = this.config.get<string>('segments.apiKey')?.trim();
    if (!apiKey) {
      this.logger.warn('Segments API key is not configured; using general banners.');
      return null;
    }

    try {
      const response = await axios.get<SegmentMembershipResponse>(
        `https://api.ambiapay.com/api/v1/segments/membership/${encodeURIComponent(astppId)}?limit=1&offset=0`,
        {
          headers: {
            'X-API-Key': apiKey,
            Accept: 'application/json',
          },
          timeout: 5000,
        }
      );
      const data = response.data;

      if (Number(data?.astppId) !== accountId || !('primarySegment' in data)) {
        this.logger.warn('Unexpected segments response; using general banners.');
        return null;
      }

      if (data.primarySegment === null) {
        return null;
      }

      const segmentId = Number(data.primarySegment?.segmentId);
      if (!Number.isSafeInteger(segmentId) || segmentId <= 0) {
        this.logger.warn('Invalid primary segment in segments response; using general banners.');
        return null;
      }

      return segmentId;
    } catch (error) {
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      this.logger.warn(
        `Segments lookup failed${status ? ` (HTTP ${status})` : ''}; using general banners.`
      );
      return null;
    }
  }
}
