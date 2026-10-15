import * as cheerio from 'cheerio';

async function debugLinks() {
  const url = 'https://new2.movies4u.garden/rajni-the-jailer-2-2026-hindi-full-movie/';
  console.log('Fetching', url);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
      }
    });
    const html = await res.text();
    const $ = cheerio.load(html);
    
    // Check for m4ulinks
    const m4uLinks = $('a').filter((_, el) => /m4ulinks/i.test($(el).attr('href') || ''));
    console.log('m4ulinks found:', m4uLinks.length);
    
    for (const el of m4uLinks.toArray()) {
      const m4uUrl = $(el).attr('href');
      console.log('Fetching m4ulinks page:', m4uUrl);
      const m4uRes = await fetch(m4uUrl!, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      const m4uHtml = await m4uRes.text();
      const $m4u = cheerio.load(m4uHtml);
      
      const downloadLinks = $m4u("a").filter((_, el) => {
        const h = $m4u(el).attr("href") || "";
        return /hubcloud|gdflix|pixeldrain/i.test(h);
      });
      
      console.log('Download links on page:', downloadLinks.length);
      downloadLinks.each((_, linkEl) => {
        console.log('Link:', $m4u(linkEl).attr('href'), 'Text:', $m4u(linkEl).text().trim());
      });
    }

  } catch (err) {
    console.error('Error debugging links:', err);
  }
}

debugLinks();
