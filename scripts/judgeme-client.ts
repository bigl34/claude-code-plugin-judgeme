/**
 * Judge.me API Client
 *
 * Direct client for the Judge.me Reviews API.
 * Provides access to product reviews for the YOUR_COMPANY Shopify store.
 *
 * Key features:
 * - Reviews: list, get, count, curate, search
 * - Replies: public replies and private emails
 * - Reviewers: lookup by ID or email
 * - Products: list and lookup by Shopify product ID
 * - Shop: aggregate metrics and info
 *
 * Uses both public and private API tokens for different operations.
 * Implements caching with configurable TTLs.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { PluginCache, TTL, createCacheKey } from "@local/plugin-cache";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Request timeout for API calls (30 seconds)
const REQUEST_TIMEOUT_MS = 30_000;

interface Config {
  judgeme: {
    shopDomain: string;
    publicApiToken: string;
    privateApiToken: string;
  };
}

interface Review {
  id: number;
  title: string;
  body: string;
  rating: number;
  reviewer: {
    id: number;
    email: string;
    name: string;
  };
  product_external_id: number;
  product_title: string;
  curated: string;
  published: boolean;
  hidden: boolean;
  verified: string;
  created_at: string;
  updated_at: string;
  pictures?: Array<{
    urls: {
      original: string;
      small: string;
    };
  }>;
  reply?: {
    body: string;
    created_at: string;
  };
}

interface ReviewsResponse {
  reviews: Review[];
  current_page: number;
  per_page: number;
}

interface ReviewCountResponse {
  count: number;
}

interface Reviewer {
  id: number;
  email: string;
  name: string;
  phone: string;
  accepts_marketing: boolean;
  unsubscribed_at: string | null;
}

interface ShopInfo {
  shop: {
    id: number;
    name: string;
    domain: string;
    platform: string;
    plan: string;
    created_at: string;
    reviews_count: number;
    average_rating: number;
    widget_installed: boolean;
  };
}

interface Product {
  id: number;  // Judge.me internal product ID
  external_id: number;  // Shopify product ID
  title: string;
  handle: string;
}

interface ProductsResponse {
  products: Product[];
  current_page: number;
  per_page: number;
}

// Initialize cache with namespace
const cache = new PluginCache({
  namespace: "judgeme-review-manager",
  defaultTTL: TTL.FIFTEEN_MINUTES,
});

export class JudgemeClient {
  private baseUrl = 'https://judge.me/api/v1';
  private config: Config;
  private cacheDisabled: boolean = false;

  constructor() {
    const configPath = join(__dirname, 'config.json');
    this.config = JSON.parse(readFileSync(configPath, 'utf-8'));
  }

  // ============================================
  // CACHE CONTROL
  // ============================================

  /** Disables caching for all subsequent requests. */
  disableCache(): void {
    this.cacheDisabled = true;
    cache.disable();
  }

  /** Re-enables caching after it was disabled. */
  enableCache(): void {
    this.cacheDisabled = false;
    cache.enable();
  }

  /** Returns cache statistics including hit/miss counts. */
  getCacheStats() {
    return cache.getStats();
  }

  /** Clears all cached data. @returns Number of cache entries cleared */
  clearCache(): number {
    return cache.clear();
  }

  /** Invalidates a specific cache entry by key. */
  invalidateCacheKey(key: string): boolean {
    return cache.invalidate(key);
  }

  // ============================================
  // INTERNAL
  // ============================================

  private async request<T>(
    endpoint: string,
    options: {
      method?: string;
      params?: Record<string, string | number | undefined>;
      body?: Record<string, unknown>;
      usePrivateToken?: boolean;
    } = {}
  ): Promise<T> {
    const { method = 'GET', params = {}, body, usePrivateToken = true } = options;

    const token = usePrivateToken
      ? this.config.judgeme.privateApiToken
      : this.config.judgeme.publicApiToken;

    const queryParams = new URLSearchParams({
      api_token: token,
      shop_domain: this.config.judgeme.shopDomain,
    });

    // Add additional params, filtering out undefined values
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        queryParams.append(key, String(value));
      }
    }

    const url = `${this.baseUrl}${endpoint}?${queryParams.toString()}`;

    // Set up timeout with AbortController
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const fetchOptions: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    };

    if (body && method !== 'GET') {
      fetchOptions.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(url, fetchOptions);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Judge.me API error (${response.status}): ${errorText}`);
      }

      return response.json();
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`Judge.me API request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ============================================
  // REVIEW OPERATIONS
  // ============================================

  /**
   * Lists reviews with optional filters.
   *
   * @param options - Filter and pagination options
   * @param options.page - Page number (1-indexed)
   * @param options.perPage - Results per page (max 100)
   * @param options.productId - Judge.me internal product ID
   * @param options.shopifyProductId - Shopify product ID (auto-converts to Judge.me ID)
   * @param options.rating - Filter by star rating (1-5)
   * @returns Paginated review list
   *
   * @cached TTL: 15 minutes
   */
  async listReviews(options: {
    page?: number;
    perPage?: number;
    productId?: number;  // Judge.me internal product ID
    shopifyProductId?: number;  // Shopify product ID (external_id)
    rating?: number;
  } = {}): Promise<ReviewsResponse> {
    let judgemeProductId = options.productId;

    // If Shopify product ID provided, look up Judge.me internal ID
    if (options.shopifyProductId && !judgemeProductId) {
      const product = await this.getProductByExternalId(options.shopifyProductId);
      if (product) {
        judgemeProductId = product.id;
      }
    }

    const cacheKey = createCacheKey("reviews", {
      page: options.page,
      perPage: options.perPage,
      productId: judgemeProductId,
      rating: options.rating,
    });

    return cache.getOrFetch(
      cacheKey,
      async () => {
        const params: Record<string, string | number | undefined> = {
          page: options.page,
          per_page: options.perPage,
          product_id: judgemeProductId,  // Use Judge.me internal ID
          rating: options.rating,
        };

        return this.request<ReviewsResponse>('/reviews', { params });
      },
      { ttl: TTL.FIFTEEN_MINUTES, bypassCache: this.cacheDisabled }
    );
  }

  /**
   * Gets a single review by ID.
   *
   * @param id - Review ID
   * @returns Review details including reply if present
   *
   * @cached TTL: 5 minutes
   */
  async getReview(id: number): Promise<{ review: Review }> {
    const cacheKey = createCacheKey("review", { id });

    return cache.getOrFetch(
      cacheKey,
      () => this.request<{ review: Review }>(`/reviews/${id}`),
      { ttl: TTL.FIVE_MINUTES, bypassCache: this.cacheDisabled }
    );
  }

  /**
   * Counts reviews matching filter criteria.
   *
   * @param options - Filter options
   * @param options.productId - Judge.me internal product ID
   * @param options.shopifyProductId - Shopify product ID (auto-converts)
   * @param options.rating - Filter by star rating (1-5)
   * @returns Count of matching reviews
   *
   * @cached TTL: 15 minutes
   */
  async countReviews(options: {
    productId?: number;  // Judge.me internal product ID
    shopifyProductId?: number;  // Shopify product ID (external_id)
    rating?: number;
  } = {}): Promise<ReviewCountResponse> {
    let judgemeProductId = options.productId;

    // If Shopify product ID provided, look up Judge.me internal ID
    if (options.shopifyProductId && !judgemeProductId) {
      const product = await this.getProductByExternalId(options.shopifyProductId);
      if (product) {
        judgemeProductId = product.id;
      }
    }

    const cacheKey = createCacheKey("reviews_count", {
      productId: judgemeProductId,
      rating: options.rating,
    });

    return cache.getOrFetch(
      cacheKey,
      async () => {
        const params: Record<string, string | number | undefined> = {
          product_id: judgemeProductId,  // Use Judge.me internal ID
          rating: options.rating,
        };

        return this.request<ReviewCountResponse>('/reviews/count', { params });
      },
      { ttl: TTL.FIFTEEN_MINUTES, bypassCache: this.cacheDisabled }
    );
  }

  /**
   * Curates a review (approve or mark as spam).
   *
   * @param id - Review ID
   * @param status - Curation status: 'ok' (approve) or 'spam' (hide)
   * @returns Updated review
   *
   * @invalidates review/*
   */
  async curateReview(id: number, status: 'ok' | 'spam'): Promise<{ review: Review }> {
    // Judge.me uses PUT to update review curation status
    // The curated field can be: 'ok' (published), 'spam' (hidden), or null (pending)
    const result = await this.request<{ review: Review }>(`/reviews/${id}`, {
      method: 'PUT',
      body: { curated: status },
    });
    // Invalidate review caches after mutation
    cache.invalidatePattern(/^review/);
    return result;
  }

  /**
   * Posts a public reply to a review.
   *
   * Public replies are visible on the storefront below the review.
   *
   * @param reviewId - Review ID to reply to
   * @param reply - Reply text content
   * @returns API response
   *
   * @invalidates review/{reviewId}
   */
  async replyToReview(reviewId: number, reply: string): Promise<unknown> {
    // POST /replies endpoint for public replies
    const result = await this.request<unknown>('/replies', {
      method: 'POST',
      body: {
        review_id: reviewId,
        body: reply
      },
    });
    // Invalidate specific review cache
    cache.invalidate(createCacheKey("review", { id: reviewId }));
    return result;
  }

  /**
   * Sends a private email reply to a reviewer.
   *
   * Unlike public replies, this sends a direct email to the reviewer
   * and is not displayed publicly.
   *
   * @param reviewId - Review ID to reply to
   * @param subject - Email subject line
   * @param body - Email body content
   * @returns API response
   */
  async sendPrivateReply(
    reviewId: number,
    subject: string,
    body: string
  ): Promise<unknown> {
    // POST /private_replies endpoint for private emails
    return this.request<unknown>('/private_replies', {
      method: 'POST',
      body: {
        review_id: reviewId,
        subject,
        body
      },
    });
  }

  // ============================================
  // REVIEWER OPERATIONS
  // ============================================

  /**
   * Gets reviewer details by ID.
   *
   * @param id - Reviewer ID
   * @returns Reviewer details including marketing preferences
   *
   * @cached TTL: 15 minutes
   */
  async getReviewerById(id: number): Promise<{ reviewer: Reviewer }> {
    const cacheKey = createCacheKey("reviewer", { id });

    return cache.getOrFetch(
      cacheKey,
      () => this.request<{ reviewer: Reviewer }>(`/reviewers/${id}`),
      { ttl: TTL.FIFTEEN_MINUTES, bypassCache: this.cacheDisabled }
    );
  }

  /**
   * Looks up a reviewer by email address.
   *
   * @param email - Reviewer email address
   * @returns Reviewer details if found
   *
   * @cached TTL: 15 minutes
   */
  async getReviewerByEmail(email: string): Promise<{ reviewer: Reviewer }> {
    const cacheKey = createCacheKey("reviewer_email", { email });

    return cache.getOrFetch(
      cacheKey,
      () => this.request<{ reviewer: Reviewer }>('/reviewers/find', {
        params: { email },
      }),
      { ttl: TTL.FIFTEEN_MINUTES, bypassCache: this.cacheDisabled }
    );
  }

  // ============================================
  // SHOP OPERATIONS
  // ============================================

  /**
   * Gets shop-level review metrics.
   *
   * Includes total review count, average rating, and plan info.
   *
   * @returns Shop info and aggregate metrics
   *
   * @cached TTL: 1 hour
   */
  async getShopInfo(): Promise<unknown> {
    return cache.getOrFetch(
      "shop_info",
      () => this.request<unknown>('/shops/info'),
      { ttl: TTL.HOUR, bypassCache: this.cacheDisabled }
    );
  }

  // ============================================
  // PRODUCT OPERATIONS
  // ============================================

  /**
   * Lists products tracked by Judge.me.
   *
   * @param options - Pagination options
   * @param options.page - Page number (1-indexed)
   * @param options.perPage - Results per page (max 100)
   * @returns Paginated product list with review stats
   *
   * @cached TTL: 1 hour
   */
  async listProducts(options: {
    page?: number;
    perPage?: number;
  } = {}): Promise<ProductsResponse> {
    const cacheKey = createCacheKey("products", {
      page: options.page,
      perPage: options.perPage,
    });

    return cache.getOrFetch(
      cacheKey,
      async () => {
        const params: Record<string, string | number | undefined> = {
          page: options.page,
          per_page: options.perPage,
        };

        return this.request<ProductsResponse>('/products', { params });
      },
      { ttl: TTL.HOUR, bypassCache: this.cacheDisabled }
    );
  }

  /**
   * Looks up a Judge.me product by Shopify product ID.
   *
   * Judge.me uses internal product IDs, but most operations reference
   * Shopify's external product ID. This method converts between them.
   *
   * @param externalId - Shopify product ID
   * @returns Judge.me product or null if not found
   *
   * @cached TTL: 1 hour
   */
  async getProductByExternalId(externalId: number): Promise<Product | null> {
    const cacheKey = createCacheKey("product_external", { externalId });

    return cache.getOrFetch(
      cacheKey,
      async () => {
        // Search through products to find one matching the Shopify external_id
        // Judge.me doesn't have a direct lookup endpoint, so we page through products
        let page = 1;
        const perPage = 100;

        while (true) {
          const response = await this.listProducts({ page, perPage });

          const product = response.products.find(p => p.external_id === externalId);
          if (product) {
            return product;
          }

          // If we got fewer than perPage, we've reached the end
          if (response.products.length < perPage) {
            return null;
          }

          page++;

          // Safety limit to prevent infinite loops
          if (page > 100) {
            return null;
          }
        }
      },
      { ttl: TTL.HOUR, bypassCache: this.cacheDisabled }
    );
  }

  // ============================================
  // SEARCH OPERATIONS
  // ============================================

  /**
   * Searches reviews by text content.
   *
   * Judge.me API doesn't support text search natively, so this method
   * pages through reviews and filters client-side. Use sparingly due
   * to high API call volume for large result sets.
   *
   * @param options - Search options
   * @param options.search - Text to search for in review title/body
   * @param options.rating - Filter by star rating (1-5)
   * @param options.maxPages - Max pages to search (default: 10)
   * @returns Matching reviews with search metadata
   */
  async searchReviews(options: {
    search: string;
    rating?: number;
    maxPages?: number;  // Limit pages to search (default 10)
  }): Promise<{ reviews: Review[]; pagesSearched: number; totalMatches: number }> {
    const searchTerm = options.search.toLowerCase();
    const maxPages = options.maxPages || 10;
    const perPage = 100;
    const matchingReviews: Review[] = [];
    let page = 1;

    while (page <= maxPages) {
      const response = await this.listReviews({
        page,
        perPage,
        rating: options.rating,
      });

      // Filter reviews by search term in body or title
      const matches = response.reviews.filter(r =>
        r.body?.toLowerCase().includes(searchTerm) ||
        r.title?.toLowerCase().includes(searchTerm)
      );

      matchingReviews.push(...matches);

      // If we got fewer than perPage, we've reached the end
      if (response.reviews.length < perPage) {
        break;
      }

      page++;
    }

    return {
      reviews: matchingReviews,
      pagesSearched: page,
      totalMatches: matchingReviews.length,
    };
  }

  // ============================================
  // UTILITY
  // ============================================

  /** Returns list of available CLI commands. */
  listTools(): string[] {
    return [
      'list-reviews',
      'get-review',
      'count-reviews',
      'curate-review',
      'reply-to-review',
      'private-reply',
      'get-reviewer',
      'shop-info',
      'list-products',
      'lookup-product',
      'search-reviews',
      'cache-stats',
      'cache-clear',
      'list-tools',
    ];
  }
}
