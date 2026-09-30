import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../../core/database/database.service';
import {
  AppConfigResponse,
  HeroSection,
  FeatureCard,
  PageLayout,
} from '../dto/app-config.dto';

@Injectable()
export class AppConfigService {
  constructor(private readonly db: DatabaseService) {}

  async getAppConfig(): Promise<AppConfigResponse> {
    // Query hero section asset (first active asset)
    const heroAsset = await this.db.queryOne(
      `SELECT 
        asset_uuid, 
        asset_key, 
        url,
        local_path, 
        alt_text, 
        updated_at
       FROM app_assets 
       WHERE is_active = true 
       ORDER BY id ASC 
       LIMIT 1`
    );

    if (!heroAsset) {
      throw new NotFoundException('No active hero asset found');
    }

    // Query active feature cards with their assets
    const featureCards = await this.db.query(
      `SELECT 
        fc.card_uuid,
        fc.card_slug,
        fc.title,
        fc.subtitle,
        a.asset_uuid,
        a.asset_key,
        a.url,
        a.local_path,
        a.updated_at
       FROM feature_cards fc
       INNER JOIN app_assets a ON a.id = fc.asset_id
       WHERE fc.is_active = true AND a.is_active = true
       ORDER BY fc.display_order ASC`
    );

    // Build hero section response (use local_path as url)
    const heroSection: HeroSection = {
      asset_uuid: heroAsset.asset_uuid,
      asset_key: heroAsset.asset_key,
      updated_at: heroAsset.updated_at.toISOString(),
      url: heroAsset.local_path || heroAsset.url,
      alt_text: heroAsset.alt_text || '',
    };

    // Build feature cards list (use local_path as url)
    const featureCardsList: FeatureCard[] = featureCards.rows.map((card) => ({
      card_uuid: card.card_uuid,
      card_slug: card.card_slug,
      asset_uuid: card.asset_uuid,
      asset_key: card.asset_key,
      updated_at: card.updated_at.toISOString(),
      url: card.local_path || card.url,
      title: card.title,
      subtitle: card.subtitle || '',
    }));

    const pageLayout: PageLayout = {
      hero_section: heroSection,
      feature_cards_list: featureCardsList,
    };

    return {
      status: 'success',
      layout_version: '2026-09-30-v1',
      page_layout: pageLayout,
    };
  }
}
