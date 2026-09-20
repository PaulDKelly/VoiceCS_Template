# KB Test Pack (Azure AI Search)

Use this to test RAG-style knowledge retrieval quickly with your current `knowledge_search` action node.

## 1) Set environment variables locally

```powershell
$env:AZURE_SEARCH_ENDPOINT="https://<your-search-service>.search.windows.net"
$env:AZURE_SEARCH_ADMIN_KEY="<your-admin-key>"
```

## 2) Create index + upload sample docs

From repo root:

```powershell
powershell -ExecutionPolicy Bypass -File dashboard/scripts/setup_kb_test_pack.ps1
```

This creates index `kb-test-pnj` and uploads sample docs.

## 3) Add runtime key in the voice agent environment

In ACA for the voice agent app, add:

- `AZURE_SEARCH_API_KEY` = query key (preferred) or admin key

Then restart/redeploy the voice agent so env vars are active.

## 4) Configure Knowledge Search node in Workflow Manager

In your Knowledge Base action node:

- `actionType`: `knowledge_search`
- `endpoint`: `https://<your-search-service>.search.windows.net`
- `index_name`: `kb-test-pnj`
- `api_version`: `2023-11-01`
- `api_key_env`: `AZURE_SEARCH_API_KEY`
- `query_template`: `{_last_user_input}`
- `top_k`: `3`
- `content_field`: `content`
- `title_field`: `title`
- `result_var`: `kb`
- `respond_immediately`: `false` (recommended)

## 5) Add a prompt node after the knowledge node

Example prompt text:

```text
Here is what I found: {kb.summary}
```

Fallback examples:

- `no_results_prompt`: `I couldn't find that in the knowledge base.`
- `error_prompt`: `I had trouble searching the knowledge base just now.`

## 6) Quick test questions

- "What are your office hours?"
- "What number should I call for emergency callouts?"
- "Which postcodes do you cover?"

If wired correctly, your prompt node should read back content from `{kb.summary}`.

