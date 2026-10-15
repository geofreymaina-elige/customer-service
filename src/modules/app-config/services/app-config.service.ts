import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../../core/database/database.service';
import {
  AppConfigResponse,
  BannersResponse,
  HeroSection,
  FeatureCard,
  FeatureFlag,
  PageLayout,
} from '../dto/app-config.dto';

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

@Injectable()
export class AppConfigService {
  constructor(private readonly db: DatabaseService) {}

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

  async getBanners(): Promise<BannersResponse> {
    const banners = await this.db.query<BannerRecord>(
      `SELECT
        fc.card_uuid,
        fc.card_slug,
        fc.display_order AS slot,
        fc.title,
        fc.subtitle,
        aa.asset_uuid,
        aa.asset_key,
        aa.url,
        aa.alt_text,
        aa.updated_at
       FROM feature_cards fc
       INNER JOIN app_assets aa ON aa.id = fc.asset_id
       WHERE fc.is_active = TRUE
         AND fc.display_order BETWEEN 1 AND 5
         AND fc.card_slug LIKE 'banner_slot_%'
         AND aa.is_active = TRUE
       ORDER BY fc.display_order ASC`
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
    }));

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
}
