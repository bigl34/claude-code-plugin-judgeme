#!/usr/bin/env npx tsx

import { z, createCommand, runCli, cacheCommands, cliTypes, wrapUntrustedField, buildSafeOutput, TRUNCATION_DEFAULTS } from "@local/cli-utils";
import { JudgemeClient } from "./judgeme-client.js";

const BODY = TRUNCATION_DEFAULTS.body;
const SUBJECT = TRUNCATION_DEFAULTS.subject;
const NAME = TRUNCATION_DEFAULTS.displayName;
const nonBlankText = z.string().trim().min(1);

const commands = {
  "list-tools": createCommand(
    z.object({}),
    async (_args, client: JudgemeClient) => ({ tools: client.listTools() }),
    "List all available CLI commands",
    { sideEffect: "read" }
  ),

  "list-reviews": createCommand(
    z.object({
      page: cliTypes.int(1).optional().describe("Page number"),
      perPage: cliTypes.int(1, 100).optional().describe("Results per page (max 100)"),
      productId: cliTypes.int(1).optional().describe("Shopify product ID to filter by"),
      rating: cliTypes.int(1, 5).optional().describe("Filter by star rating (1-5)"),
    }),
    async (args, client: JudgemeClient) => {
      const { page, perPage, productId, rating } = args as {
        page?: number; perPage?: number; productId?: number; rating?: number;
      };
      const result: any = await client.listReviews({
        page, perPage, shopifyProductId: productId, rating,
      });

      const shopDomain = client.getShopDomain();

      const reviews = (result?.reviews || result?.data || []);
      const wrappedReviews = (Array.isArray(reviews) ? reviews : []).map((r: any) => {
        const reply = r.reply
          ? {
              body: wrapUntrustedField("reply.body", r.reply.body ?? "", { maxChars: BODY }),
              created_at: r.reply.created_at,
            }
          : null;
        return {
          metadata: {
            id: r.id,
            rating: r.rating,
            created_at: r.created_at,
            curated: r.curated,
            verified: r.verified,
            source: r.source,
            product_id: r.product_id,
            product_external_id: r.product_external_id,
            published: r.published,
            hidden: r.hidden,
            updated_at: r.updated_at,
            reviewer_id: r.reviewer?.id,
            shop_domain: shopDomain,
          },
          content: {
            title: wrapUntrustedField("title", r.title, { maxChars: SUBJECT }),
            body: wrapUntrustedField("body", r.body, { maxChars: BODY }),
            reviewerName: wrapUntrustedField("reviewer.name", r.reviewer?.name, { maxChars: NAME }),
            reviewerEmail: wrapUntrustedField("reviewer.email", r.reviewer?.email, { maxChars: NAME }),
            productTitle: wrapUntrustedField("product_title", r.product_title, { maxChars: SUBJECT }),
            pictures: r.pictures,
            reply,
          },
        };
      });

      return buildSafeOutput(
        { command: "list-reviews", count: wrappedReviews.length, page: result?.current_page, totalPages: result?.total_pages },
        { reviews: wrappedReviews }
      );
    },
    "List product reviews with optional filters",
    { sideEffect: "read" }
  ),

  "get-review": createCommand(
    z.object({
      id: cliTypes.int(1).describe("Review ID"),
    }),
    async (args, client: JudgemeClient) => {
      const { id } = args as { id: number };
      const result: any = await client.getReview(id);

      const r = result?.review || result;
      return buildSafeOutput(
        {
          command: "get-review",
          id: r.id,
          rating: r.rating,
          created_at: r.created_at,
          updated_at: r.updated_at,
          curated: r.curated,
          verified: r.verified,
          source: r.source,
          product_id: r.product_id,
        },
        {
          title: wrapUntrustedField("title", r.title, { maxChars: 500 }),
          body: wrapUntrustedField("body", r.body, { maxChars: 8000 }),
          reviewerName: wrapUntrustedField("reviewer.name", r.reviewer?.name, { maxChars: 200 }),
          reviewerEmail: wrapUntrustedField("reviewer.email", r.reviewer?.email, { maxChars: 200 }),
          productTitle: wrapUntrustedField("product_title", r.product_title, { maxChars: 500 }),
        }
      );
    },
    "Get a specific review by ID",
    { sideEffect: "read" }
  ),

  "count-reviews": createCommand(
    z.object({
      productId: cliTypes.int(1).optional().describe("Shopify product ID to filter by"),
      rating: cliTypes.int(1, 5).optional().describe("Filter by star rating (1-5)"),
    }),
    async (args, client: JudgemeClient) => {
      const { productId, rating } = args as { productId?: number; rating?: number };
      return client.countReviews({
        shopifyProductId: productId,
        rating,
      });
    },
    "Get review count with optional filters",
    { sideEffect: "read" }
  ),

  "search-reviews": createCommand(
    z.object({
      search: z.string().min(1).describe("Search term"),
      rating: cliTypes.int(1, 5).optional().describe("Filter by star rating (1-5)"),
      maxPages: cliTypes.int(1, 10).optional().describe("Max pages to search (default: 5)"),
    }),
    async (args, client: JudgemeClient) => {
      const { search, rating, maxPages } = args as {
        search: string; rating?: number; maxPages?: number;
      };
      const result: any = await client.searchReviews({ search, rating, maxPages });

      const reviews = (result?.reviews || result?.data || result || []);
      const wrappedReviews = (Array.isArray(reviews) ? reviews : []).map((r: any) => ({
        metadata: {
          id: r.id,
          rating: r.rating,
          created_at: r.created_at,
          curated: r.curated,
          verified: r.verified,
          product_id: r.product_id,
        },
        content: {
          title: wrapUntrustedField("title", r.title, { maxChars: 500 }),
          body: wrapUntrustedField("body", r.body, { maxChars: 8000 }),
          reviewerName: wrapUntrustedField("reviewer.name", r.reviewer?.name, { maxChars: 200 }),
          reviewerEmail: wrapUntrustedField("reviewer.email", r.reviewer?.email, { maxChars: 200 }),
          productTitle: wrapUntrustedField("product_title", r.product_title, { maxChars: 500 }),
        },
      }));

      return buildSafeOutput(
        { command: "search-reviews", search, count: wrappedReviews.length },
        { reviews: wrappedReviews }
      );
    },
    "Search reviews by keyword",
    { sideEffect: "read" }
  ),

  "curate-review": createCommand(
    z.object({
      id: cliTypes.int(1).describe("Review ID"),
      status: z.enum(["ok", "spam"]).describe("Curation status"),
    }),
    async (args, client: JudgemeClient, globals) => {
      const { id, status } = args as { id: number; status: "ok" | "spam" };
      if (globals?.dryRun) {
        return { dryRun: true, wouldCurate: { id, status } };
      }
      return client.curateReview(id, status);
    },
    "Mark review as ok or spam",
    { sideEffect: "write", requiresConfirmation: true, dryRunSupported: true }
  ),

  "reply-to-review": createCommand(
    z.object({
      reviewId: cliTypes.int(1).describe("Review ID to reply to"),
      reply: nonBlankText.describe("Public reply text"),
    }),
    async (args, client: JudgemeClient) => {
      const { reviewId, reply } = args as { reviewId: number; reply: string };
      return client.replyToReview(reviewId, reply);
    },
    "Post a public reply to a review",
    { sideEffect: "external_send", requiresConfirmation: true }
  ),

  "private-reply": createCommand(
    z.object({
      reviewId: cliTypes.int(1).describe("Review ID to reply to"),
      subject: nonBlankText.describe("Email subject"),
      body: nonBlankText.describe("Email body"),
    }),
    async (args, client: JudgemeClient) => {
      const { reviewId, subject, body } = args as {
        reviewId: number;
        subject: string;
        body: string;
      };
      return client.sendPrivateReply(reviewId, subject, body);
    },
    "Send private email reply to reviewer",
    { sideEffect: "external_send", requiresConfirmation: true }
  ),

  "get-reviewer": createCommand(
    z.object({
      id: cliTypes.int(1).optional().describe("Reviewer ID"),
      email: z.string().email().optional().describe("Reviewer email"),
    }).refine(
      (data) => data.id !== undefined || data.email !== undefined,
      { message: "Either --id or --email is required" }
    ),
    async (args, client: JudgemeClient) => {
      const { id, email } = args as { id?: number; email?: string };
      const result: any = id ? await client.getReviewerById(id) : await client.getReviewerByEmail(email!);

      const reviewer = result?.reviewer || result;
      return buildSafeOutput(
        {
          command: "get-reviewer",
          id: reviewer.id,
          reviews_count: reviewer.reviews_count,
        },
        {
          name: wrapUntrustedField("name", reviewer.name, { maxChars: 200 }),
          email: wrapUntrustedField("email", reviewer.email, { maxChars: 200 }),
        }
      );
    },
    "Get reviewer info by ID or email",
    { sideEffect: "read" }
  ),

  "shop-info": createCommand(
    z.object({}),
    async (_args, client: JudgemeClient) => client.getShopInfo(),
    "Get shop information and statistics",
    { sideEffect: "read" }
  ),

  "list-products": createCommand(
    z.object({
      page: cliTypes.int(1).optional().describe("Page number"),
      perPage: cliTypes.int(1, 100).optional().describe("Results per page (max 100)"),
    }),
    async (args, client: JudgemeClient) => {
      const { page, perPage } = args as { page?: number; perPage?: number };
      const result: any = await client.listProducts({ page, perPage });

      const products = (result?.products || result?.data || []);
      const wrappedProducts = (Array.isArray(products) ? products : []).map((p: any) => ({
        metadata: {
          id: p.id,
          external_id: p.external_id,
          reviews_count: p.reviews_count,
          average_rating: p.average_rating,
        },
        content: {
          title: wrapUntrustedField("title", p.name || p.title, { maxChars: 500 }),
        },
      }));

      return buildSafeOutput(
        { command: "list-products", count: wrappedProducts.length },
        { products: wrappedProducts }
      );
    },
    "List products with reviews",
    { sideEffect: "read" }
  ),

  "lookup-product": createCommand(
    z.object({
      shopifyId: cliTypes.int(1).describe("Shopify product ID"),
    }),
    async (args, client: JudgemeClient) => {
      const { shopifyId } = args as { shopifyId: number };
      const product: any = await client.getProductByExternalId(shopifyId);
      if (!product) {
        throw new Error("Product not found");
      }

      const p = product;
      return buildSafeOutput(
        {
          command: "lookup-product",
          id: p.id,
          external_id: p.external_id,
          reviews_count: p.reviews_count,
          average_rating: p.average_rating,
        },
        {
          title: wrapUntrustedField("title", p.name || p.title, { maxChars: 500 }),
        }
      );
    },
    "Look up a product by Shopify product ID",
    { sideEffect: "read" }
  ),

  ...cacheCommands<JudgemeClient>(),
};

runCli(commands, JudgemeClient, {
  programName: "judgeme-cli",
  description: "Judge.me product review management",
});

