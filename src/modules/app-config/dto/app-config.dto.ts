export interface HeroSection {
  asset_uuid: string;
  asset_key: string;
  updated_at: string;
  url: string;
  alt_text: string;
}

export interface FeatureCard {
  card_uuid: string;
  card_slug: string;
  asset_uuid: string;
  asset_key: string;
  updated_at: string;
  url: string;
  title: string;
  subtitle: string;
}

export interface PageLayout {
  hero_section: HeroSection;
  feature_cards: FeatureCard[];
}

export interface AppConfigResponse {
  status: string;
  layout_version: string;
  page_layout: PageLayout;
}
