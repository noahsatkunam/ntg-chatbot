import axios from 'axios';
import * as cheerio from 'cheerio';
import { URL } from 'url';
import { AppError } from '../../middlewares/errorHandler';

export interface WebProcessingOptions {
  followRedirects?: boolean;
  maxRedirects?: number;
  timeout?: number;
  extractImages?: boolean;
  extractLinks?: boolean;
  preserveFormatting?: boolean;
  removeAds?: boolean;
  customSelectors?: {
    content?: string;
    title?: string;
    exclude?: string[];
  };
}

export interface WebProcessingResult {
  text: string;
  html?: string;
  markdown?: string;
  metadata: {
    title?: string;
    description?: string;
    author?: string;
    publishDate?: Date;
    lastModified?: Date;
    language?: string;
    keywords?: string[];
    canonicalUrl?: string;
    siteName?: string;
    wordCount: number;
    readingTime: number;
  };
  structure: {
    headings: Array<{ level: number; text: string; id?: string }>;
    links: Array<{ text: string; url: string; type: 'internal' | 'external' }>;
    images: Array<{ src: string; alt?: string; title?: string }>;
    tables: Array<{ caption?: string; data: string[][]; headers: string[] }>;
    lists: Array<{ type: 'ordered' | 'unordered'; items: string[] }>;
  };
  seo: {
    metaTags: Record<string, string>;
    openGraph: Record<string, string>;
    twitterCard: Record<string, string>;
    jsonLd: any[];
  };
}

export class WebProcessor {
  private readonly defaultUserAgent = 'Mozilla/5.0 (compatible; KnowledgeBot/1.0)';

  /**
   * Process web page content
   */
  async processWebPage(
    url: string, 
    options: WebProcessingOptions = {}
  ): Promise<WebProcessingResult> {
    try {
      const response = await this.fetchWebPage(url, options);
      const $ = cheerio.load(response.data);
      
      const result: WebProcessingResult = {
        text: '',
        html: response.data,
        metadata: {
          wordCount: 0,
          readingTime: 0
        },
        structure: {
          headings: [],
          links: [],
          images: [],
          tables: [],
          lists: []
        },
        seo: {
          metaTags: {},
          openGraph: {},
          twitterCard: {},
          jsonLd: []
        }
      };

      // Extract metadata
      await this.extractMetadata($, result, url);

      // Extract main content
      const mainContent = this.extractMainContent($, options);
      result.text = this.cleanText(mainContent.text());
      
      // Calculate word count and reading time
      result.metadata.wordCount = this.countWords(result.text);
      result.metadata.readingTime = Math.ceil(result.metadata.wordCount / 200);

      // Extract structure
      await this.extractStructure($, result, url, options);

      // Extract SEO data
      await this.extractSEOData($, result);

      // Convert to markdown if requested
      if (options.preserveFormatting) {
        result.markdown = await this.convertToMarkdown(mainContent);
      }

      return result;
    } catch (error) {
      throw new AppError(
        `Failed to process web page: ${error instanceof Error ? error.message : 'Unknown error'}`,
        500
      );
    }
  }

  /**
   * Extract text content only (lightweight processing)
   */
  async extractTextOnly(url: string): Promise<string> {
    try {
      const result = await this.processWebPage(url);
      return result.text;
    } catch (error) {
      throw new AppError(`Failed to extract text from web page: ${error}`, 500);
    }
  }

  /**
   * Check if URL is accessible
   */
  async isAccessible(url: string): Promise<boolean> {
    try {
      const response = await axios.head(url, {
        timeout: 5000,
        headers: { 'User-Agent': this.defaultUserAgent }
      });
      return response.status >= 200 && response.status < 400;
    } catch (error) {
      return false;
    }
  }

  /**
   * Extract article content from news/blog sites
   */
  async extractArticle(url: string): Promise<{
    title: string;
    content: string;
    author?: string;
    publishDate?: Date;
  }> {
    try {
      const result = await this.processWebPage(url, {
        customSelectors: {
          content: 'article, .post-content, .entry-content, .article-body, main',
          title: 'h1, .post-title, .entry-title, .article-title'
        }
      });

      return {
        title: result.metadata.title || '',
        content: result.text,
        author: result.metadata.author,
        publishDate: result.metadata.publishDate
      };
    } catch (error) {
      throw new AppError(`Failed to extract article: ${error}`, 500);
    }
  }

  private async fetchWebPage(url: string, options: WebProcessingOptions): Promise<any> {
    const config = {
      timeout: options.timeout || 30000,
      maxRedirects: options.maxRedirects || 5,
      headers: {
        'User-Agent': this.defaultUserAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      }
    };

    return await axios.get(url, config);
  }

  private async extractMetadata($: cheerio.CheerioAPI, result: WebProcessingResult, url: string): Promise<void> {
    // Basic metadata
    result.metadata.title = $('title').text().trim() || 
                           $('meta[property="og:title"]').attr('content') ||
                           $('h1').first().text().trim();

    result.metadata.description = $('meta[name="description"]').attr('content') ||
                                 $('meta[property="og:description"]').attr('content');

    result.metadata.author = $('meta[name="author"]').attr('content') ||
                           $('meta[property="article:author"]').attr('content') ||
                           $('.author, .byline').first().text().trim();

    result.metadata.language = $('html').attr('lang') || 
                              $('meta[http-equiv="content-language"]').attr('content');

    result.metadata.canonicalUrl = $('link[rel="canonical"]').attr('href') || url;

    result.metadata.siteName = $('meta[property="og:site_name"]').attr('content');

    // Keywords
    const keywords = $('meta[name="keywords"]').attr('content');
    if (keywords) {
      result.metadata.keywords = keywords.split(',').map(k => k.trim());
    }

    // Dates
    const publishDate = $('meta[property="article:published_time"]').attr('content') ||
                       $('meta[name="date"]').attr('content') ||
                       $('time[datetime]').attr('datetime');
    
    if (publishDate) {
      result.metadata.publishDate = new Date(publishDate);
    }

    const modifiedDate = $('meta[property="article:modified_time"]').attr('content') ||
                        $('meta[name="last-modified"]').attr('content');
    
    if (modifiedDate) {
      result.metadata.lastModified = new Date(modifiedDate);
    }
  }

  private extractMainContent($: cheerio.CheerioAPI, options: WebProcessingOptions): cheerio.Cheerio<cheerio.Element> {
    // Remove unwanted elements
    const elementsToRemove = [
      'script', 'style', 'nav', 'header', 'footer', 'aside',
      '.advertisement', '.ads', '.social-share', '.comments',
      '.sidebar', '.menu', '.navigation', '.breadcrumb'
    ];

    if (options.removeAds) {
      elementsToRemove.push(
        '[class*="ad"]', '[id*="ad"]', '[class*="banner"]',
        '.google-ads', '.adsense', '[data-ad-slot]'
      );
    }

    if (options.customSelectors?.exclude) {
      elementsToRemove.push(...options.customSelectors.exclude);
    }

    elementsToRemove.forEach(selector => {
      $(selector).remove();
    });

    // Find main content
    let mainContent: cheerio.Cheerio<cheerio.Element>;

    if (options.customSelectors?.content) {
      mainContent = $(options.customSelectors.content).first();
    } else {
      // Try common content selectors
      const contentSelectors = [
        'article',
        'main',
        '.content',
        '.post-content',
        '.entry-content',
        '.article-body',
        '#content',
        '.main-content',
        '[role="main"]'
      ];

      for (const selector of contentSelectors) {
        const element = $(selector);
        if (element.length > 0 && element.text().trim().length > 100) {
          mainContent = element.first();
          break;
        }
      }

      // Fallback to body if no main content found
      if (!mainContent || mainContent.length === 0) {
        mainContent = $('body');
      }
    }

    return mainContent;
  }

  private async extractStructure(
    $: cheerio.CheerioAPI, 
    result: WebProcessingResult, 
    baseUrl: string,
    options: WebProcessingOptions
  ): Promise<void> {
    // Extract headings
    $('h1, h2, h3, h4, h5, h6').each((_, element) => {
      const $el = $(element);
      const level = parseInt(element.tagName.substring(1));
      const text = $el.text().trim();
      const id = $el.attr('id');

      if (text) {
        result.structure.headings.push({ level, text, id });
      }
    });

    // Extract links
    if (options.extractLinks !== false) {
      $('a[href]').each((_, element) => {
        const $el = $(element);
        const href = $el.attr('href');
        const text = $el.text().trim();

        if (href && text) {
          const absoluteUrl = this.resolveUrl(href, baseUrl);
          const type = this.isInternalLink(absoluteUrl, baseUrl) ? 'internal' : 'external';
          
          result.structure.links.push({ text, url: absoluteUrl, type });
        }
      });
    }

    // Extract images
    if (options.extractImages !== false) {
      $('img[src]').each((_, element) => {
        const $el = $(element);
        const src = $el.attr('src');
        const alt = $el.attr('alt');
        const title = $el.attr('title');

        if (src) {
          const absoluteUrl = this.resolveUrl(src, baseUrl);
          result.structure.images.push({ src: absoluteUrl, alt, title });
        }
      });
    }

    // Extract tables
    $('table').each((_, element) => {
      const $table = $(element);
      const caption = $table.find('caption').text().trim();
      
      const headers: string[] = [];
      $table.find('thead th, tr:first-child th').each((_, th) => {
        headers.push($(th).text().trim());
      });

      const data: string[][] = [];
      $table.find('tbody tr, tr').each((_, tr) => {
        const row: string[] = [];
        $(tr).find('td, th').each((_, cell) => {
          row.push($(cell).text().trim());
        });
        if (row.length > 0) {
          data.push(row);
        }
      });

      if (data.length > 0) {
        result.structure.tables.push({ caption, data, headers });
      }
    });

    // Extract lists
    $('ul, ol').each((_, element) => {
      const $list = $(element);
      const type = element.tagName.toLowerCase() === 'ul' ? 'unordered' : 'ordered';
      const items: string[] = [];

      $list.children('li').each((_, li) => {
        const text = $(li).text().trim();
        if (text) {
          items.push(text);
        }
      });

      if (items.length > 0) {
        result.structure.lists.push({ type, items });
      }
    });
  }

  private async extractSEOData($: cheerio.CheerioAPI, result: WebProcessingResult): Promise<void> {
    // Meta tags
    $('meta').each((_, element) => {
      const $el = $(element);
      const name = $el.attr('name') || $el.attr('property') || $el.attr('http-equiv');
      const content = $el.attr('content');

      if (name && content) {
        result.seo.metaTags[name] = content;

        // Open Graph
        if (name.startsWith('og:')) {
          result.seo.openGraph[name] = content;
        }

        // Twitter Card
        if (name.startsWith('twitter:')) {
          result.seo.twitterCard[name] = content;
        }
      }
    });

    // JSON-LD structured data
    $('script[type="application/ld+json"]').each((_, element) => {
      try {
        const jsonLd = JSON.parse($(element).html() || '');
        result.seo.jsonLd.push(jsonLd);
      } catch (error) {
        // Invalid JSON-LD, skip
      }
    });
  }

  private cleanText(text: string): string {
    return text
      .replace(/\s+/g, ' ') // Normalize whitespace
      .replace(/\n\s*\n/g, '\n\n') // Clean up multiple newlines
      .trim();
  }

  private countWords(text: string): number {
    return text.trim().split(/\s+/).filter(word => word.length > 0).length;
  }

  private resolveUrl(url: string, baseUrl: string): string {
    try {
      return new URL(url, baseUrl).href;
    } catch (error) {
      return url;
    }
  }

  private isInternalLink(url: string, baseUrl: string): boolean {
    try {
      const urlObj = new URL(url);
      const baseUrlObj = new URL(baseUrl);
      return urlObj.hostname === baseUrlObj.hostname;
    } catch (error) {
      return false;
    }
  }

  private async convertToMarkdown(content: cheerio.Cheerio<cheerio.Element>): Promise<string> {
    // Simple HTML to Markdown conversion
    let markdown = content.html() || '';
    
    markdown = markdown
      .replace(/<h([1-6])[^>]*>(.*?)<\/h[1-6]>/g, (match, level, text) => {
        return '#'.repeat(parseInt(level)) + ' ' + text + '\n\n';
      })
      .replace(/<p[^>]*>(.*?)<\/p>/g, '$1\n\n')
      .replace(/<strong[^>]*>(.*?)<\/strong>/g, '**$1**')
      .replace(/<b[^>]*>(.*?)<\/b>/g, '**$1**')
      .replace(/<em[^>]*>(.*?)<\/em>/g, '*$1*')
      .replace(/<i[^>]*>(.*?)<\/i>/g, '*$1*')
      .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/g, '[$2]($1)')
      .replace(/<code[^>]*>(.*?)<\/code>/g, '`$1`')
      .replace(/<pre[^>]*>(.*?)<\/pre>/gs, '```\n$1\n```\n')
      .replace(/<br\s*\/?>/g, '\n')
      .replace(/<li[^>]*>(.*?)<\/li>/g, '- $1\n')
      .replace(/<ul[^>]*>(.*?)<\/ul>/gs, '$1\n')
      .replace(/<ol[^>]*>(.*?)<\/ol>/gs, '$1\n')
      .replace(/<[^>]*>/g, '') // Remove remaining HTML tags
      .replace(/\n\s*\n\s*\n/g, '\n\n')
      .trim();

    return markdown;
  }
}
