# Local Embedding and Hybrid Retrieval Plan

## Goal

Move embedding generation to a local model while keeping the existing RAG behavior that can return collections, resources, videos, external links, link groups, attachments, events, notations, organizations, and related references. Search should not depend on semantic search alone; exact text and structured filters remain part of retrieval.

## Provider Strategy

- Use Ollama as the local embedding endpoint.
- Default model: `nomic-embed-text`.
- Keep current database storage at `vector(1536)` to avoid rewriting every vector column and index.
- Normalize local model output to 1536 dimensions before storing/querying.
- Regenerate all existing embeddings after switching providers because OpenAI and local embedding spaces are not comparable.

## Embedding Freshness

Automated embedding updates should run after create/update for:

- Resources
- Collections
- External links
- Link groups
- Attachments
- Organizations
- Events
- Notations

Backfill and health checks should use `npm run embeddings` so missing or stale embeddings can be regenerated without relying on app traffic.

## Retrieval Strategy

The retrieval path should remain hybrid:

- Use semantic vector search when embeddings exist and the question is conceptual or exploratory.
- Use keyword/text search when the prompt contains exact titles, names, dates, or known entities.
- Combine both for broad questions like “what do I need to build this app?” so template collections, workflow steps, linked resources, videos, and calendar/event artifacts can all be returned.
- Preserve existing permission and tenant filters before results are sent to the AI layer.

## Current Implementation Status

- Local embedding provider configuration is in `src/services/vectorService.js`.
- The embedding CLI reports provider/model configuration and can backfill all supported content types.
- Event embeddings have been added because events previously had text-only search.
- Create/update service hooks keep embeddings current for newly created or edited events.

## Operational Steps

1. Start Ollama locally.
2. Pull the embedding model: `ollama pull nomic-embed-text`.
3. Set local embedding env values:
   - `EMBEDDING_PROVIDER=ollama`
   - `EMBEDDING_BASE_URL=http://localhost:11434`
   - `EMBEDDING_MODEL=nomic-embed-text`
   - `EMBEDDING_MODEL_DIMENSIONS=768`
4. Run database migrations.
5. Run a forced full embedding backfill.
6. Use embedding health checks to confirm no missing embeddings remain.
