
import { loadServiceConfig, z } from "@local/cli-utils";
import { PluginCache, TTL, createCacheKey } from "@local/plugin-cache";
import { fetchWithRetry } from "./vendor/retry/index.js";

const REQUEST_TIMEOUT_MS = 30_000;

const JudgemeConfigSchema = z.object({
  judgeme: z.object({
    shopDomain: z.string().min(1),
    publicApiToken: z.string().min(1),
    privateApiToken: z.string().min(1),
  }),
});

type Config = z.infer<typeof JudgemeConfigSchema>;

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
  id: number;
  external_id: number;
  title: string;
  handle: string;
}

interface ProductsResponse {
  products: Product[];
  current_page: number;
  per_page: number;
}

const cache = new PluginCache({
  namespace: "judgeme-review-manager",
  defaultTTL: TTL.FIFTEEN_MINUTES,
});

export class JudgemeClient {
  private baseUrl = 'https://judge.me/api/v1';
  private config: Config;
  private cacheDisabled: boolean = false;

  constructor() {
    this.config = loadServiceConfig("judgeme-review-manager", {
      schema: JudgemeConfigSchema,
    });
  }

  getShopDomain(): string {
    return this.config.judgeme.shopDomain;
  }


  disableCache(): void {
    this.cacheDisabled = true;
    cache.disable();
  }

  enableCache(): void {
    this.cacheDisabled = false;
    cache.enable();
  }

  getCacheStats() {
    return cache.getStats();
  }

  clearCache(): number {
    return cache.clear();
  }

  invalidateCacheKey(key: string): boolean {
    return cache.invalidate(key);
  }


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

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        queryParams.append(key, String(value));
      }
    }

    const url = `${this.baseUrl}${endpoint}?${queryParams.toString()}`;

    const fetchOptions: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    if (body && method !== 'GET') {
      fetchOptions.body = JSON.stringify(body);
    }

    try {
      const response = await fetchWithRetry(
        url,
        fetchOptions,
        { maxRetries: 3, timeoutMs: REQUEST_TIMEOUT_MS },
        "Judgeme.request"
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Judge.me API error (${response.status}): ${errorText}`);
      }

      return response.json();
    } catch (error) {
      if (error instanceof Error && /(timed out|timeout|abort)/i.test(error.message)) {
        throw new Error(`Judge.me API request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
      }
      throw error;
    }
  }


  async listReviews(options: {
    page?: number;
    perPage?: number;
    productId?: number;
    shopifyProductId?: number;
    rating?: number;
  } = {}): Promise<ReviewsResponse> {
    let judgemeProductId = options.productId;

    if (options.shopifyProductId !== undefined && options.productId === undefined) {
      const product = await this.getProductByExternalId(options.shopifyProductId);
      if (product === null) {
        return {
          reviews: [],
          current_page: options.page ?? 1,
          per_page: options.perPage ?? 100,
        };
      }
      judgemeProductId = product.id;
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
          product_id: judgemeProductId,
          rating: options.rating,
        };

        return this.request<ReviewsResponse>('/reviews', { params });
      },
      { ttl: TTL.FIFTEEN_MINUTES, bypassCache: this.cacheDisabled }
    );
  }

  async getReview(id: number): Promise<{ review: Review }> {
    const cacheKey = createCacheKey("review", { id });

    return cache.getOrFetch(
      cacheKey,
      () => this.request<{ review: Review }>(`/reviews/${id}`),
      { ttl: TTL.FIVE_MINUTES, bypassCache: this.cacheDisabled }
    );
  }

  async countReviews(options: {
    productId?: number;
    shopifyProductId?: number;
    rating?: number;
  } = {}): Promise<ReviewCountResponse> {
    let judgemeProductId = options.productId;

    if (options.shopifyProductId !== undefined && options.productId === undefined) {
      const product = await this.getProductByExternalId(options.shopifyProductId);
      if (product === null) {
        return { count: 0 };
      }
      judgemeProductId = product.id;
    }

    const cacheKey = createCacheKey("reviews_count", {
      productId: judgemeProductId,
      rating: options.rating,
    });

    return cache.getOrFetch(
      cacheKey,
      async () => {
        const params: Record<string, string | number | undefined> = {
          product_id: judgemeProductId,
          rating: options.rating,
        };

        return this.request<ReviewCountResponse>('/reviews/count', { params });
      },
      { ttl: TTL.FIFTEEN_MINUTES, bypassCache: this.cacheDisabled }
    );
  }

  async curateReview(id: number, status: 'ok' | 'spam'): Promise<{ review: Review }> {
    const result = await this.request<{ review: Review }>(`/reviews/${id}`, {
      method: 'PUT',
      body: { curated: status },
    });
    cache.invalidatePattern(/^review/);
    return result;
  }

  async replyToReview(reviewId: number, reply: string): Promise<unknown> {
    const result = await this.request<unknown>('/replies', {
      method: 'POST',
      body: {
        review_id: reviewId,
        body: reply
      },
    });
    cache.invalidate(createCacheKey("review", { id: reviewId }));
    return result;
  }

  async sendPrivateReply(
    reviewId: number,
    subject: string,
    body: string
  ): Promise<unknown> {
    return this.request<unknown>('/private_replies', {
      method: 'POST',
      body: {
        review_id: reviewId,
        subject,
        body
      },
    });
  }


  async getReviewerById(id: number): Promise<{ reviewer: Reviewer }> {
    const cacheKey = createCacheKey("reviewer", { id });

    return cache.getOrFetch(
      cacheKey,
      () => this.request<{ reviewer: Reviewer }>(`/reviewers/${id}`),
      { ttl: TTL.FIFTEEN_MINUTES, bypassCache: this.cacheDisabled }
    );
  }

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


  async getShopInfo(): Promise<unknown> {
    return cache.getOrFetch(
      "shop_info",
      () => this.request<unknown>('/shops/info'),
      { ttl: TTL.HOUR, bypassCache: this.cacheDisabled }
    );
  }


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

  async getProductByExternalId(externalId: number): Promise<Product | null> {
    const cacheKey = createCacheKey("product_external", { externalId });

    return cache.getOrFetch(
      cacheKey,
      async () => {
        let page = 1;
        const perPage = 100;

        while (true) {
          const response = await this.listProducts({ page, perPage });

          const product = response.products.find(p => p.external_id === externalId);
          if (product) {
            return product;
          }

          if (response.products.length < perPage) {
            return null;
          }

          page++;

          if (page > 100) {
            return null;
          }
        }
      },
      { ttl: TTL.HOUR, bypassCache: this.cacheDisabled }
    );
  }


  async searchReviews(options: {
    search: string;
    rating?: number;
    maxPages?: number;
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

      const matches = response.reviews.filter(r =>
        r.body?.toLowerCase().includes(searchTerm) ||
        r.title?.toLowerCase().includes(searchTerm)
      );

      matchingReviews.push(...matches);

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
