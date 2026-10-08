# RAG Demo

A hands-on, end-to-end **Retrieval-Augmented Generation** demo built over a fictional SaaS support
knowledge base ("DemoDesk"). It is deliberately layered: every stage of RAG is exposed as its own
mechanism with its own evaluation, so you can *see* what retrieval contributes and where it fails -
instead of hiding everything behind a chatbot.

The Markdown knowledge base in `kb/source/` is the **source of truth**. Qdrant is only a derived
search index that can be dropped and rebuilt at any time.

The pipeline is implemented incrementally and each step is measurable:

```
dense retrieval → metadata filtering → BM25 → hybrid (RRF) → reranking → LLM generation + citations → bounded agentic retrieval
```

---

## Table of contents

1. [What is RAG](#1-what-is-rag)
2. [How RAG is implemented in this project](#2-how-rag-is-implemented-in-this-project)
3. [Technical requirements](#3-technical-requirements)
4. [CLI reference](#4-cli-reference)

---

## 1. What is RAG

**Retrieval-Augmented Generation (RAG)** means answering a question with a Large Language Model whose
answer is *grounded in documents retrieved at query time*, rather than in whatever the model memorised
during training.

### Why it exists

LLMs on their own:

- **hallucinate** - they produce fluent but unsupported statements;
- have a **knowledge cutoff** - they don't know your private, recent, or changing content;
- **cannot cite** - you can't verify where an answer came from;
- **can't be updated cheaply** - retraining to change one policy is impractical.

RAG fixes this by separating two concerns: a **retriever** finds relevant source text, and a
**generator** writes an answer from that text only.

### The two phases

**Indexing (offline):** documents → parse → chunk → embed → store vectors + payload in a vector DB.

**Query time (online):** question → embed / tokenise → search the index → (optionally filter, fuse,
rerank) → build context → LLM → grounded answer.

```
INDEXING (offline, repeatable)
  Markdown KB ──► parse frontmatter ──► chunk ──► embeddings ──┐
                                                               ├──► Qdrant (dense + sparse + payload)
                                        BM25 sparse vectors ───┘

QUERY TIME (online)
  question ──► retrieve candidates ──► filter / fuse / rerank ──► top-k chunks ──► LLM ──► answer + citations
```

### Core principles this demo follows

| Principle | Consequence |
|---|---|
| The knowledge base is the source of truth; the vector DB is derived | You can `--reset` and rebuild the index at any time |
| Retrieval quality bounds answer quality | A correct answer needs the right chunk *in the candidate set* first |
| Dense and sparse retrieval are complementary | Dense wins on paraphrases, BM25 wins on exact identifiers |
| Fusion should use **ranks**, not raw scores | Cosine (~0.5), BM25 (unbounded) and RRF scores are not comparable |
| Reranking changes **order**, it cannot invent candidates | Candidate recall is measured before adding a reranker |
| Metadata filtering is a **restriction**, not similarity | `must`/`should` narrow the candidate set; ranking still uses similarity |
| The server, not the model, owns citations | Citations are validated against the sources actually provided |
| Measure, don't guess | Every stage has an eval set with Hit@k / Recall@k / MRR |
| Agentic retrieval must be bounded | Max 2 extra searches, max 12 unique chunks, same pipeline |

### Typical use cases

Support assistants over product docs, internal knowledge/enterprise search, documentation Q&A,
policy/compliance lookup, and *grounded* assistants where citations and "I don't know" matter more
than sounding confident.

---

## 2. How RAG is implemented in this project

### 2.1 Indexing pipeline

```
kb/source/*.md
     │  gray-matter (YAML frontmatter: id, title, category, locale, status, valid_from, valid_to, tags)
     ▼
chunker.ts  (structural: split on #/##/###, long sections split on paragraphs at 2000 chars)
     ▼
embeddings.ts (dense)                 qdrant.ts ingestion
     │  OpenAI text-embedding-3-small      │
     │  1536-dim cosine vector              │  sparse: { text, model: "qdrant/bm25" }  (computed by Qdrant)
     ▼                                      ▼
                 Qdrant collection "knowledge"
                 ├── dense  (named vector, 1536, Cosine)
                 ├── bm25   (sparse vector, modifier: idf)
                 └── payload (document_id, document_version, chunk_index, title, category,
                              locale, status, valid_from, valid_to, tags, source_file,
                              source_uri, updated_at, text)
```

Payload **indexes** are created for `status`, `locale`, `category`, `document_id`, `valid_from`,
`valid_to` so filtered search is efficient.

Each Qdrant **point = one chunk** (not a whole document). Point IDs are deterministic UUIDv5 values
derived from `documentId:chunkIndex`, so re-seeding overwrites the same points instead of duplicating.

### 2.2 Query-time retrieval

Four retrievers (`src/retrieval.ts`), all accepting the same metadata filter:

```
                      ┌── dense  : OpenAI query embedding → cosine over `dense`
question + filter ────┼── bm25   : Qdrant-side BM25 over `bm25`
                      ├── hybrid : dense ⊕ bm25 prefetched separately, fused with RRF (1:1)
                      └── rerank : (dense top-20 ∪ bm25 top-20) deduped → cross-encoder → top-k
```

- **Dense** - semantics; strong when wording differs (e.g. "I lost my phone" → the 2FA recovery
  section).
- **BM25** - lexical; strong on exact identifiers (e.g. `ERR-C91`).
- **Hybrid (RRF)** - Reciprocal Rank Fusion combines the two *rankings*. It can rescue a document
  that is strong in only one retriever.
- **Rerank** - a cross-encoder reads *(query, chunk)* together and reorders the candidate pool. We
  deliberately feed it the **union of dense + BM25 candidates**, not the RRF output, because RRF can
  discard a good candidate before the reranker sees it.

Metadata filtering is orthogonal and applied *before* fusion/reranking: `status`, `locale`,
`category`, and temporal validity (`asOf`: `valid_from <= asOf` AND (`valid_to >= asOf` OR empty)).

### 2.3 Generation and citations

```
top-k chunks (rerank + metadata)
     ▼
buildContext()  ──►  [S1] Document: … / Title: … / Chunk: … / Status: … / Valid: … / Source: doc:vN:chunk-N
     ▼
OpenAI Responses API, Structured Outputs (JSON schema, strict)
     ▼
{ status: "answered" | "insufficient", answer, citations: ["S1", …] }
     ▼
validateCitations()  ── server-side: unknown ids, unknown inline [Sn], answered-without-citation → rejected
```

The model sees **numbered, metadata-tagged sources** (including `Status`/`Valid`, so it can prefer
the current policy over an obsolete one) and must answer only from them, citing `[S#]` inline. Citation
identity is version-aware: `refunds-2026:v1:chunk-1`.

### 2.4 Bounded agentic retrieval

```
initial retrieval (deterministic, top-5)
     ▼
LLM decides (Responses API function tool)
     ├── enough  ──► final structured answer
     └── missing ──► search_kb({ query, category? })  → SAME pipeline (dense ∪ bm25 ∪ metadata ∪ rerank)
                        ▼ merge unique chunks, then loop
     hard limits: max 2 extra searches, max 12 unique chunks, 5 results/search
```

The application owns the base filters; the tool can only **narrow** by `category`, never bypass
tenant/ACL/status/locale. The initial retrieval is always deterministic.

### 2.5 The web UI

| Tab | What it shows |
|---|---|
| **Search** | Retrieval only (no LLM): ranked chunks, scores, and dense/BM25 ranks for the rerank retriever. Filter controls + applied-filters line. |
| **Answer** | One grounded RAG pass: answer with clickable `[S#]` citation badges and the source list. |
| **Agentic** | Like Answer, plus the retrieval trace (initial retrieval, `search_kb` steps), bounded. |
| **Eval** | Retrieval eval (Hit@k, Recall@k, MRR per retriever) and generation eval (answerable/unanswerable accuracy, citation validity, expected source hit). |

### 2.6 Stage → code → evaluation map

| Stage | Code | Eval |
|---|---|---|
| Embeddings | `src/embeddings.ts` | - |
| Chunking | `src/chunker.ts`, `src/id.ts` | - |
| Index / upsert | `src/seed.ts`, `src/qdrant.ts` | - |
| Dense / BM25 / Hybrid | `src/retrieval.ts` | `npm run eval` |
| Reranking | `src/reranker.ts`, `reranker/app.py` | `npm run eval` |
| Generation + citations | `src/generation.ts` | `npm run eval:gen` |
| Agentic | `src/agent.ts` | (UI trace) |
| Web API/UI | `src/server.ts`, `public/` | - |

### 2.7 Source layout

```
rag-demo/
├── docker-compose.yml        # Qdrant (ports 6333 REST / 6334 gRPC)
├── .env / .env.example       # configuration
├── kb/source/*.md            # 50 documents - the source of truth
├── eval/
│   ├── queries.json          # retrieval eval set (24 queries)
│   ├── generation.json       # generation eval set (12 questions)
│   └── results/              # saved reports
├── reranker/
│   ├── app.py                # local cross-encoder service (BAAI/bge-reranker-v2-m3)
│   └── requirements.txt
├── public/                   # UI (index.html, app.js, styles.css)
└── src/
    ├── config.ts             # typed env config
    ├── embeddings.ts         # OpenAI embedder (+ mock for offline)
    ├── chunker.ts            # structural markdown chunker
    ├── id.ts                 # deterministic UUIDv5 point ids
    ├── qdrant.ts             # collection, payload indexes, upsert, dense/bm25/hybrid queries
    ├── retrieval.ts          # unified search + filter builder
    ├── reranker.ts           # Voyage / Cohere / local / fallback reranker client
    ├── seed.ts               # parse → chunk → embed → upsert
    ├── create-collection.ts  # create collection + payload indexes
    ├── search.ts             # retrieval CLI
    ├── evaluate.ts           # retrieval eval CLI
    ├── generation.ts         # context builder, structured generator, citation validation
    ├── generation-eval.ts    # generation eval core
    ├── evaluate-generation.ts# generation eval CLI
    ├── agent.ts              # bounded agentic retrieval
    └── server.ts             # HTTP API + static UI
```

---

## 3. Technical requirements

### Required

| Component | Version / notes |
|---|---|
| **Node.js** | 20+ (uses ESM, global `fetch`, `node:` imports). `tsx` runs the TypeScript directly. |
| **npm** | ships with Node; dependencies in `package.json`. |
| **Docker + Docker Compose** | to run Qdrant. `docker compose up -d`. |
| **Qdrant** | latest, via `docker-compose.yml`. REST `6333`, gRPC `6334`, dashboard `http://localhost:6333/dashboard`. |
| **OpenAI API key** | used for embeddings (`text-embedding-3-small`, 1536-dim) **and** generation (`gpt-4o-mini`). |

### Optional

| Component | Purpose |
|---|---|
| **Voyage API key** | reranker provider `voyage` (`rerank-3-lite`). |
| **Cohere API key** | reranker provider `cohere` (`rerank-v4.0-fast`). |
| **Python 3.10+** | only for the self-hosted cross-encoder reranker (`reranker/app.py`), which needs `torch` (CPU) + `sentence-transformers` and downloads `BAAI/bge-reranker-v2-m3` (~2.3 GB). CPU inference is slow (~15 min for a full UI eval); an API provider is much faster. |

The pipeline can run **without any reranker** (`RERANKER_PROVIDER=fallback`) and **without an OpenAI
key** for retrieval only (`EMBEDDINGS_PROVIDER=mock`), which is useful for offline smoke tests.

### Installation

```bash
# 1. Dependencies
npm install

# 2. Qdrant
docker compose up -d

# 3. Configuration
cp .env.example .env
# set OPENAI_API_KEY (and, optionally, VOYAGE_API_KEY / COHERE_API_KEY)

# 4. Build the index
npm run seed -- --reset

# 5. (optional) local reranker service, if RERANKER_PROVIDER=local
python3 -m pip install --user torch --index-url https://download.pytorch.org/whl/cpu
python3 -m pip install --user -r reranker/requirements.txt
python3 reranker/app.py

# 6. UI
npm run web      # http://localhost:3000
```

### Environment variables (`.env`)

| Variable | Default | Meaning |
|---|---|---|
| `EMBEDDINGS_PROVIDER` | `openai` | `openai` or `mock` (deterministic offline vectors) |
| `OPENAI_API_KEY` | – | required for `openai` embeddings and for generation |
| `OPENAI_BASE_URL` | – | optional OpenAI-compatible gateway |
| `EMBEDDING_MODEL` | `text-embedding-3-small` | dense embedding model |
| `EMBEDDING_DIMENSIONS` | `1536` | dense vector size |
| `QDRANT_URL` | `http://localhost:6333` | Qdrant endpoint |
| `QDRANT_COLLECTION` | `knowledge` | collection name |
| `KB_SOURCE_DIR` | `kb/source` | knowledge base (source of truth) |
| `SEARCH_TOP_K` | `5` | final number of results / eval cutoff k |
| `SEARCH_PREFETCH_LIMIT` | `20` | per-branch candidate pool for hybrid RRF |
| `EVAL_CANDIDATE_DEPTH` | `20` | retrieval depth for Recall@10/@20 |
| `RERANKER_PROVIDER` | `local` | `local` \| `voyage` \| `cohere` \| `fallback` |
| `RERANKER_URL` | `http://localhost:8080` | local cross-encoder service |
| `RERANKER_MODEL` | `BAAI/bge-reranker-v2-m3` | local reranker model |
| `RERANK_CANDIDATES` | `20` | candidates fetched per branch before the union + rerank |
| `RERANK_TIMEOUT_MS` | `120000` | reranker request timeout |
| `VOYAGE_API_KEY` / `VOYAGE_BASE_URL` / `VOYAGE_RERANK_MODEL` | – / `https://api.voyageai.com` / `rerank-3-lite` | Voyage reranker |
| `COHERE_API_KEY` / `COHERE_BASE_URL` / `COHERE_RERANK_MODEL` | – / `https://api.cohere.com` / `rerank-v4.0-fast` | Cohere reranker |
| `GENERATION_MODEL` | `gpt-4o-mini` | answer generation model |
| `GENERATION_TOP_K` | `5` | chunks passed to the generator |
| `AGENT_MAX_SEARCHES` | `2` | max extra `search_kb` calls |
| `AGENT_MAX_CHUNKS` | `12` | max unique chunks accumulated |
| `AGENT_SEARCH_RESULTS` | `5` | results per agent search |
| `PORT` | `3000` | web UI / API port |

---

## 4. CLI reference

All commands are npm scripts; extra flags are passed after `--`.

### Indexing

```bash
# Create the collection + payload indexes only (idempotent)
npm run create-collection

# Parse kb/source/*.md, chunk, embed, create indexes, upsert; print stats
npm run seed

# Drop the collection and rebuild it from scratch (recommended after config/chunker changes)
npm run seed -- --reset
```
Output:
```
Documents: 50
Chunks:    235
Vectors:   235
Errors:    0
```
Re-seeding is idempotent: point IDs are deterministic, so `upsert` overwrites the same points.

### Retrieval

```bash
npm run search -- "I lost my phone and cannot log in"

# choose a retriever: dense | bm25 | hybrid | rerank
npm run search -- "ERR-C91 workspace does not exist" --retriever bm25
npm run search -- "I lost my phone" --retriever hybrid
npm run search -- "What permissions do workspace members have?" --retriever rerank

# result count
npm run search -- "How do refunds work?" --top 3

# metadata filters (apply to every retriever)
npm run search -- "What is the refund period?" --status active
npm run search -- "What was the refund period?" --as-of 2025-06-01
npm run search -- "Jak obnovím své heslo?" --locale cs
npm run search -- "How can I authenticate?" --category developers
```
Prints the query, retriever, applied filters, and the ranked chunks (score, title, `document · chunk`,
and for `rerank` also the dense/BM25 ranks).

### Retrieval evaluation

```bash
# Dense / Dense+meta / BM25 / BM25+meta / Hybrid / Hybrid+meta / Rerank / Rerank+meta
npm run eval

# options
npm run eval -- --top 5 --candidates 20          # final cutoff k and retrieval depth
npm run eval -- --json                            # machine-readable report to stdout
npm run eval -- --out eval/results/my-run.json    # save the report
npm run eval -- --file eval/queries.json          # custom eval set
```
Reports per-mode **Document/Chunk Hit@1/3/5, MRR@k, Recall@10/@20** plus a per-query rank comparison
table and a miss list. The frozen single-retriever baseline lives in `eval/results/dense-step1.json`.

### Generation evaluation

```bash
# 12 questions (8 answerable + 4 unanswerable) through the full generation + citation path
npm run eval:gen

npm run eval:gen -- --json
npm run eval:gen -- --out eval/results/generation.json
npm run eval:gen -- --file eval/generation.json
```
Reports **Answerable accuracy, Unanswerable accuracy, Citation validity, Expected source hit** and a
per-question table.

### Web UI / API

```bash
npm run web        # serves public/ and the API on http://localhost:3000
```
HTTP endpoints:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/` | the UI |
| `POST` | `/api/search` | `{ query, retriever?, filters? }` → ranked chunks |
| `POST` | `/api/answer` | `{ query, filters? }` → `{ status, answer, citations, sources }` |
| `POST` | `/api/agentic` | `{ query, filters?, forceSearch? }` → answer + retrieval trace |
| `GET` | `/api/eval/queries` | retrieval eval set |
| `POST` | `/api/eval` | `{ topK? }` → retrieval eval report |
| `GET` | `/api/generation/queries` | generation eval set |
| `POST` | `/api/generation/eval` | generation eval report |

### Reranker service (optional, provider=`local`)

```bash
python3 reranker/app.py
# env: RERANKER_MODEL (default BAAI/bge-reranker-v2-m3), RERANKER_PORT (default 8080)
# GET  /health  -> {"status":"ok","model":...}
# POST /rerank  {"query": str, "documents": [str]} -> [{"index", "score"}]
```

### Other

```bash
npm run typecheck                 # strict TypeScript check, no emit
docker compose up -d              # start Qdrant
docker compose down               # stop Qdrant
docker compose down -v            # stop Qdrant and delete its volume
```

### Quick start (copy-paste)

```bash
npm install
docker compose up -d
cp .env.example .env            # add OPENAI_API_KEY
npm run seed -- --reset
npm run eval                    # retrieval baseline
npm run eval:gen                # generation baseline
npm run web                     # open http://localhost:3000
```

> Note: without an OpenAI key you can still exercise retrieval offline with `EMBEDDINGS_PROVIDER=mock`
> (lexical-only vectors), but generation and the API rerankers need their respective keys.
