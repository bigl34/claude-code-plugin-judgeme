<!-- AUTO-GENERATED README — DO NOT EDIT. Changes will be overwritten on next publish. -->
# claude-code-plugin-judgeme

Dedicated agent for Judge.me product reviews and ratings

![Version](https://img.shields.io/badge/version-1.1.10-blue) ![License: MIT](https://img.shields.io/badge/License-MIT-green) ![Node >= 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)

## Features

- Review Operations
- **list-reviews** — List all reviews
- **get-review** — Get specific review by ID
- **count-reviews** — Count reviews
- **curate-review** — Publish or hide a review
- **reply-to-review** — Add public reply to review
- **private-reply** — Send private email to reviewer
- Reviewer Operations
- **get-reviewer** — Get reviewer information
- Shop Operations
- **shop-info** — Get store information and Judge.me plan details
- Utility
- **list-tools** — List all available commands

## Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI
- API credentials for the target service (see Configuration)

## Quick Start

```bash
git clone https://github.com/YOUR_GITHUB_USER/claude-code-plugin-judgeme.git
cd claude-code-plugin-judgeme
cp config.template.json config.json  # fill in your credentials
cd scripts && npm install
```

```bash
node scripts/dist/cli.js list-reviews
```

## Installation

1. Clone this repository
2. Copy `config.template.json` to `config.json` and fill in your credentials
3. Install dependencies:
   ```bash
   cd scripts && npm install
   ```

## Available Commands

### Review Operations

| Command           | Description                    | Options                                                               |
| ----------------- | ------------------------------ | --------------------------------------------------------------------- |
| `list-reviews`    | List all reviews               | `--page`, `--per-page`, `--product-id`, `--rating`                    |
| `get-review`      | Get specific review by ID      | `--id` (required)                                                     |
| `count-reviews`   | Count reviews                  | `--product-id`, `--rating`                                            |
| `curate-review`   | Publish or hide a review       | `--id` (required), `--status` (ok/spam)                               |
| `reply-to-review` | Add public reply to review     | `--review-id` (required), `--reply` (required)                        |
| `private-reply`   | Send private email to reviewer | `--review-id` (required), `--subject` (required), `--body` (required) |

### Reviewer Operations

| Command        | Description              | Options                            |
| -------------- | ------------------------ | ---------------------------------- |
| `get-reviewer` | Get reviewer information | `--id` or `--email` (one required) |

### Shop Operations

| Command     | Description                                     |
| ----------- | ----------------------------------------------- |
| `shop-info` | Get store information and Judge.me plan details |

### Utility

| Command      | Description                 |
| ------------ | --------------------------- |
| `list-tools` | List all available commands |

## Usage Examples

```bash
# List recent reviews (default 10 per page)
node scripts/dist/cli.js list-reviews

# List reviews for a specific product
node scripts/dist/cli.js list-reviews --product-id 12345

# Filter by rating (1-5 stars)
node scripts/dist/cli.js list-reviews --rating 5

# Get a specific review
node scripts/dist/cli.js get-review --id 67890

# Count all reviews
node scripts/dist/cli.js count-reviews

# Publish a review (set status to 'ok')
node scripts/dist/cli.js curate-review --id 67890 --status ok

# Hide a review (set status to 'spam')
node scripts/dist/cli.js curate-review --id 67890 --status spam

# Reply publicly to a review
node scripts/dist/cli.js reply-to-review --review-id 67890 --reply "Thank you for your feedback!"

# Send private email to reviewer
node scripts/dist/cli.js private-reply --review-id 67890 --subject "Thank you" --body "We appreciate your review..."

# Get shop info
node scripts/dist/cli.js shop-info
```

## How It Works

This plugin connects directly to the service's HTTP API. The CLI handles authentication, request formatting, pagination, and error handling, returning structured JSON responses.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Authentication errors | Verify credentials in `config.json` |
| `ERR_MODULE_NOT_FOUND` | Run `cd scripts && npm install` |
| Rate limiting | The CLI handles retries automatically; wait and retry if persistent |
| Unexpected JSON output | Check API credentials haven't expired |

## Contributing

Issues and pull requests are welcome.

## License

MIT
