#!/usr/bin/env npx tsx
/**
 * Judge.me Review Manager CLI
 *
 * Zod-validated CLI for Judge.me product review management.
 */

import { z, createCommand, runCli, cacheCommands, cliTypes } from "@local/cli-utils";
import { JudgemeClient } from "./judgeme-client.js";

// Define commands with Zod schemas
const commands = {
  "list-tools": createCommand(
    z.object({}),
    async (_args, client: JudgemeClient) => ({ tools: client.listTools() }),
    "List all available CLI commands"
  ),

  // Review commands
  "list-reviews": createCommand(
    z.object({
      page: cliTypes.int(1).optional().describe("Page number"),
      perPage: cliTypes.int(1, 100).optional().describe("Results per page (max 100)"),
      productId: cliTypes.int(1).optional().describe("Shopify product ID to filter by"),
      rating: cliTypes.int(1, 5).optional().describe("Filter by star rating (1-5)"),
    }),
    async (args, client: JudgemeClient) => {
      const { page, perPage, productId, rating } = args as {
        page?: number;
        perPage?: number;
        productId?: number;
        rating?: number;
      };
      return client.listReviews({
        page,
        perPage,
        shopifyProductId: productId,
        rating,
      });
    },
    "List product reviews with optional filters"
  ),

  "get-review": createCommand(
    z.object({
      id: cliTypes.int(1).describe("Review ID"),
    }),
    async (args, client: JudgemeClient) => {
      const { id } = args as { id: number };
      return client.getReview(id);
    },
    "Get a specific review by ID"
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
    "Get review count with optional filters"
  ),

  "search-reviews": createCommand(
    z.object({
      search: z.string().min(1).describe("Search term"),
      rating: cliTypes.int(1, 5).optional().describe("Filter by star rating (1-5)"),
      maxPages: cliTypes.int(1, 10).optional().describe("Max pages to search (default: 5)"),
    }),
    async (args, client: JudgemeClient) => {
      const { search, rating, maxPages } = args as {
        search: string;
        rating?: number;
        maxPages?: number;
      };
      return client.searchReviews({ search, rating, maxPages });
    },
    "Search reviews by keyword"
  ),

  "curate-review": createCommand(
    z.object({
      id: cliTypes.int(1).describe("Review ID"),
      status: z.enum(["ok", "spam"]).describe("Curation status"),
    }),
    async (args, client: JudgemeClient) => {
      const { id, status } = args as { id: number; status: "ok" | "spam" };
      return client.curateReview(id, status);
    },
    "Mark review as ok or spam"
  ),

  "reply-to-review": createCommand(
    z.object({
      reviewId: cliTypes.int(1).describe("Review ID to reply to"),
      reply: z.string().min(1).describe("Public reply text"),
    }),
    async (args, client: JudgemeClient) => {
      const { reviewId, reply } = args as { reviewId: number; reply: string };
      return client.replyToReview(reviewId, reply);
    },
    "Post a public reply to a review"
  ),

  "private-reply": createCommand(
    z.object({
      reviewId: cliTypes.int(1).describe("Review ID to reply to"),
      subject: z.string().min(1).describe("Email subject"),
      body: z.string().min(1).describe("Email body"),
    }),
    async (args, client: JudgemeClient) => {
      const { reviewId, subject, body } = args as {
        reviewId: number;
        subject: string;
        body: string;
      };
      return client.sendPrivateReply(reviewId, subject, body);
    },
    "Send private email reply to reviewer"
  ),

  // Reviewer commands
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
      if (id) {
        return client.getReviewerById(id);
      }
      return client.getReviewerByEmail(email!);
    },
    "Get reviewer info by ID or email"
  ),

  // Shop commands
  "shop-info": createCommand(
    z.object({}),
    async (_args, client: JudgemeClient) => client.getShopInfo(),
    "Get shop information and statistics"
  ),

  // Product commands
  "list-products": createCommand(
    z.object({
      page: cliTypes.int(1).optional().describe("Page number"),
      perPage: cliTypes.int(1, 100).optional().describe("Results per page (max 100)"),
    }),
    async (args, client: JudgemeClient) => {
      const { page, perPage } = args as { page?: number; perPage?: number };
      return client.listProducts({ page, perPage });
    },
    "List products with reviews"
  ),

  "lookup-product": createCommand(
    z.object({
      shopifyId: cliTypes.int(1).describe("Shopify product ID"),
    }),
    async (args, client: JudgemeClient) => {
      const { shopifyId } = args as { shopifyId: number };
      const product = await client.getProductByExternalId(shopifyId);
      if (product) {
        return { product };
      }
      throw new Error("Product not found");
    },
    "Look up a product by Shopify product ID"
  ),

  // Pre-built cache commands
  ...cacheCommands<JudgemeClient>(),
};

// Run CLI
runCli(commands, JudgemeClient, {
  programName: "judgeme-cli",
  description: "Judge.me product review management",
});
