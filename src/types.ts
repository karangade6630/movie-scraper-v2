export interface Movie {
  id: number;
  title: string;
  release_year: string;
  quality: string;
  poster_url: string;
  links: string; // JSON string: { quality: string; links: { text: string; url: string }[] }[]
  page_num: number;
  scraped_at: string;
  priority?: number;
}

