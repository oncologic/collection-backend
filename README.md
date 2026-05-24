# Collections Backend

Express backend for the Collections platform. It provides APIs for users,
tenants, resources, collections, events, metadata, attachments, AI-assisted
workflows, subscriptions, integrations, and public sharing.

## Tech Stack

- Node.js with Express
- PostgreSQL with Drizzle ORM
- Clerk authentication
- Optional integrations for Azure Blob Storage, OpenAI, Anthropic, Resend,
  Twilio, and Slack
- Jest for tests

## Prerequisites

- Node.js 18 or newer
- PostgreSQL 14 or newer
- A local or hosted database
- Provider credentials for any optional integrations you enable

## Getting Started

Install dependencies:

```bash
npm install
```

Create a local environment file:

```bash
touch .env.local
```

Then add the database/auth variables needed for your environment using the
template below. The app listens on port `3002` unless `PORT` is set.

Run the development server:

```bash
npm run dev
```

Run the production entrypoint:

```bash
npm start
```

## Environment Variables

The exact set depends on which features are enabled. Keep all real values out of
Git.

### Core

```env
NODE_ENV=development
PORT=3002
FRONTEND_URL=http://localhost:3000
EXTERNAL_ALLOWED_ORIGINS=http://localhost:3000
```

### Database

Use either a single connection string:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/database
DB_SSL=false
```

or individual local connection fields:

```env
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=postgres
DB_NAME=postgres
```

### Auth and Tenancy

```env
CLERK_SECRET_KEY=
CLERK_PUBLISHABLE_KEY=
CLERK_WEBHOOK_SECRET=
KIDNEY_TENANT_ID=
COMMUNITY_TENANT=
JWT_SECRET=
```

### Optional Services

```env
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
OCR_SERVICE_URL=
OCR_API_KEY=

# Optional: route backend chat/text LLM calls through an OpenAI-compatible
# gateway such as LiteLLM or a local Ollama server. The app keeps its existing
# RAG/reference hydration contract. OCR/image processing still uses OCR_SERVICE_URL.
LLM_GATEWAY=litellm
LITELLM_BASE_URL=http://localhost:4000
OPENAI_COMPATIBLE_BASE_URL=
OPENAI_COMPATIBLE_API_KEY=
LITELLM_API_KEY=
LITELLM_DEFAULT_MODEL=gpt-4o-mini
LITELLM_FAST_MODEL=
LITELLM_REASONING_MODEL=
LITELLM_GEMINI_MODEL=
LITELLM_DISABLE_JSON_RESPONSE_FORMAT=false
# Optional JSON for exact legacy-to-proxy model aliases:
# LITELLM_MODEL_MAP={"claude-haiku-4-5":"my-fast-model","claude-3-5-sonnet-20241022":"my-reasoning-model","gemini-2.5-flash":"my-default-model"}

AZURE_STORAGE_ACCOUNT_NAME=
AZURE_STORAGE_ACCOUNT_KEY=
AZURE_STORAGE_CONTAINER_NAME=
# Optional alternative to account name/key. The container name is still required.
AZURE_STORAGE_CONNECTION_STRING=
# Optional for custom domains, private endpoints, or Azurite.
AZURE_STORAGE_BLOB_ENDPOINT=
# Set true only if the container/blob access level is intentionally public.
AZURE_STORAGE_PUBLIC_ACCESS=false

RESEND_API_KEY=
RESEND_FROM_EMAIL=
ADMIN_EMAIL=

TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=
BASE_URL=

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=

SLACK_CLIENT_ID=
SLACK_CLIENT_SECRET=
SLACK_REDIRECT_URI=
```

For browser direct-to-Azure attachment uploads, configure Azure Storage CORS to
allow your frontend origin to send `PUT` requests with `content-type` and
`x-ms-blob-type` headers. Upload SAS URLs are signed with `JWT_SECRET`, so keep
that value stable across backend instances.

### LiteLLM setup notes

Use the LiteLLM proxy as an external gateway rather than adding the Python
package to this Node backend. Pin LiteLLM to a currently patched release before
deploying. As of May 2026, avoid compromised PyPI releases `1.82.7` and
`1.82.8`, and use a version at or above the currently patched line for recent
advisories (`>=1.83.10` based on public vulnerability guidance available at the
time this README was updated).

Typical local setup:

```bash
uv tool install 'litellm[proxy]'
export OPENAI_API_KEY=...
litellm --model gpt-4o-mini --port 4000
```

For production, run LiteLLM with a config file, virtual keys, provider API keys
stored outside the app, and point this backend at the proxy with
`LITELLM_BASE_URL` and `LITELLM_API_KEY`.

### Local Gemma 4 with Ollama

For a fully local model, run Gemma 4 through Ollama's OpenAI-compatible API and
point the backend directly at it:

```bash
brew install ollama
ollama serve
ollama pull gemma4:e4b
```

Then set:

```env
LLM_GATEWAY=openai-compatible
OPENAI_COMPATIBLE_BASE_URL=http://localhost:11434/v1
LITELLM_DEFAULT_MODEL=gemma4:e4b
LITELLM_FAST_MODEL=gemma4:e4b
LITELLM_REASONING_MODEL=gemma4:e4b
```

Use `gemma4:e2b` on smaller machines, `gemma4:e4b` for the default local setup,
and `gemma4:26b` or `gemma4:31b` only when the machine has enough memory/GPU
headroom. If Ollama rejects OpenAI JSON response format for a model, set
`LITELLM_DISABLE_JSON_RESPONSE_FORMAT=true`; the backend will still prompt for
JSON and parse the response.

## Database

Run Drizzle migrations:

```bash
npm run migrate
```

This command uses `src/db/migrate.js` and the migrations in `src/db/migrations`.
The repository also contains SQL migration files under `migrations/` and
`src/migrations/`; apply those according to your deployment process if your
environment depends on them.

Seed local data after migrations:

```bash
npm run seed
```

The seed script is idempotent and creates the baseline tenants, local users,
tenant memberships, roles, subscription plans, metadata lookup rows, tags, and
small sample collections/resources/links needed for a fresh database to be
usable. By default it uses these tenant IDs unless you override them:

```env
KIDNEY_TENANT_ID=00000000-0000-4000-8000-000000000001
COMMUNITY_TENANT=00000000-0000-4000-8000-000000000002
```

If you want the seeded admin to match a real Clerk user, set
`SEED_ADMIN_CLERK_USER_ID` before running the seed command.

To validate seed configuration without writing to the database, run
`npm run seed -- --dry-run`.

## Common Commands

```bash
npm run dev                 # Start with nodemon
npm start                   # Start with node
npm test                    # Run Jest
npm run test:detailed-export
npm run test:integration
npm run format              # Format source files
npm run embeddings          # Manage embedding tasks
npm run process-embeddings  # Process queued embedding work
npm run seed                # Seed local tenants and baseline data
```

## API Areas

Most routes are mounted under `/api`.

- `/api/users`
- `/api/tenants`
- `/api/resources`
- `/api/collections`
- `/api/events`
- `/api/metadata`
- `/api/tags`
- `/api/organizations`
- `/api/attachments`
- `/api/ai`
- `/api/public`
- `/api/shared-links`
- `/api/subscriptions`
- `/api/credits`
- `/api/invitations`
- `/api/tenant-invites`
- `/api/slack`
- `/api/sms`

Authentication is handled through Clerk middleware. Some routes also require
tenant context, usually supplied by authenticated user state or request headers.

## Project Structure

```text
src/
  app.js             Express app and route registration
  controllers/       Request handlers
  services/          Business logic and provider integrations
  models/            Drizzle table definitions
  routes/            Express routers
  middleware/        Auth, tenant, upload, rate limit, webhook middleware
  utils/             Shared helpers
  db/                Database connection and Drizzle migrations
scripts/             Maintenance and background jobs
migrations/          SQL migrations
tests/               Additional test files
```

## Security Notes

- Do not commit `.env`, `.env.local`, provider credentials, API keys, private
  keys, uploaded user files, or production runbooks.
- Keep public documentation focused on setup and usage. Internal security design
  notes, incident summaries, and operational procedures should live in a private
  system.
- Rotate any provider credentials that were ever committed, shared publicly, or
  exposed in logs.

## License

Apache-2.0. See [LICENSE](LICENSE).
