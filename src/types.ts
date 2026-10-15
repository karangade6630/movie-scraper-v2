export interface MovieLinkItem {
  text: string;
  url: string;
  selected?: boolean;
  server?: string;
  alternatives?: { text: string; url: string }[];
}

export interface MovieQualityGroup {
  quality: string;
  links: MovieLinkItem[];
}

export interface Movie {
  id: number;
  title: string;
  release_year: string;
  quality: string;
  poster_url: string;
  links: string; // JSON string: MovieQualityGroup[]
  page_num: number;
  scraped_at: string;
  priority?: number;
  preferred_server?: string;
}
