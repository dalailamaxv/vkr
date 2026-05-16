"""
Embed already-scraped pages directly into ChromaDB — no scraping needed.

Reads from scrape_progress/<slug>.jsonl and creates embeddings via NVIDIA NIM.
Run this after cleanup_progress.py.

Usage:
  python embed_only.py https://example.com
"""

import hashlib
import json
import os
import sys
from datetime import datetime

from dotenv import load_dotenv
load_dotenv()

import httpx
from openai import OpenAI
os.environ.setdefault("ANONYMIZED_TELEMETRY", "False")
import chromadb


def _patch_httpx_proxies_arg():
    for cls in (httpx.Client, httpx.AsyncClient):
        orig_init = cls.__init__
        try:
            import inspect
            params = inspect.signature(orig_init).parameters
            if "proxies" in params:
                continue
        except Exception:
            continue

        def patched_init(self, *args, __orig_init=orig_init, proxies=None, **kwargs):
            if proxies is not None and "proxy" not in kwargs:
                kwargs["proxy"] = proxies
            return __orig_init(self, *args, **kwargs)

        cls.__init__ = patched_init


_patch_httpx_proxies_arg()

NVIDIA_API_KEY = os.getenv("NVIDIA_API_KEY", "")
EMBED_MODEL    = os.getenv("EMBED_MODEL", "nvidia/llama-3.2-nv-embedqa-1b-v2")
EMBED_BATCH_SIZE = int(os.getenv("EMBED_BATCH_SIZE", "32"))
PROGRESS_DIR   = "./scrape_progress"
METADATA_FILE  = "./indexed_sites_metadata.json"

nim_client = OpenAI(
    base_url="https://integrate.api.nvidia.com/v1",
    api_key=NVIDIA_API_KEY or "nvapi-placeholder",
)

chroma_client = chromadb.PersistentClient(
    path="./chroma_db",
    settings=chromadb.Settings(anonymized_telemetry=False),
)
try:
    collection = chroma_client.get_collection("websites")
except Exception:
    collection = chroma_client.create_collection(
        name="websites",
        metadata={"description": "All indexed websites"},
    )


def progress_file(base_url: str) -> str:
    slug = hashlib.md5(base_url.encode()).hexdigest()[:12]
    return os.path.join(PROGRESS_DIR, f"{slug}.jsonl")


def chunk_text(text: str, chunk_size: int = 500, overlap: int = 50):
    words = text.split()
    return [
        " ".join(words[i: i + chunk_size])
        for i in range(0, len(words), chunk_size - overlap)
        if len(" ".join(words[i: i + chunk_size])) > 50
    ]


def embed_pages(base_url: str):
    pfile = progress_file(base_url)
    if not os.path.exists(pfile):
        print(f"❌ Progress file not found: {pfile}")
        print("   Run cleanup_progress.py first")
        return

    pages = []
    with open(pfile, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                pages.append(json.loads(line))
            except Exception:
                pass

    print(f"📄 Loaded {len(pages)} pages from {pfile}")

    if not pages:
        print("❌ No pages found")
        return

    site_hash = hashlib.md5(base_url.encode()).hexdigest()[:8]
    try:
        collection.delete(where={"base_url": base_url})
        print(f"🗑️  Cleared old embeddings for {base_url}")
    except Exception as e:
        print(f"⚠️  Could not clear old embeddings: {e}")

    all_items = []
    for page_idx, page in enumerate(pages):
        chunks = chunk_text(page["content"])
        for chunk_idx, chunk in enumerate(chunks):
            doc_id = f"{site_hash}_page{page_idx}_chunk{chunk_idx}"
            meta = {
                "url": page["url"],
                "title": page["title"],
                "base_url": base_url,
                "chunk_id": chunk_idx,
                "total_chunks": len(chunks),
            }
            all_items.append((chunk, meta, doc_id))

    total = len(all_items)
    print(f"📊 Total chunks to embed: {total}  (batch_size={EMBED_BATCH_SIZE})")
    print(f"   Estimated API calls: {total // EMBED_BATCH_SIZE + 1}")
    print()

    total_chunks = 0
    for batch_start in range(0, total, EMBED_BATCH_SIZE):
        batch = all_items[batch_start: batch_start + EMBED_BATCH_SIZE]
        texts = [item[0] for item in batch]

        try:
            response = nim_client.embeddings.create(
                model=EMBED_MODEL,
                input=texts,
                encoding_format="float",
                extra_body={"input_type": "passage", "truncate": "NONE"},
            )
            embeddings = [d.embedding for d in response.data]
        except Exception as e:
            print(f"⚠️  Batch failed, retrying one-by-one: {e}")
            embeddings = []
            for text in texts:
                try:
                    r = nim_client.embeddings.create(
                        model=EMBED_MODEL,
                        input=text,
                        encoding_format="float",
                        extra_body={"input_type": "passage", "truncate": "NONE"},
                    )
                    embeddings.append(r.data[0].embedding)
                except Exception as e2:
                    print(f"❌ Skipping chunk: {e2}")
                    embeddings.append(None)

        valid_embs, valid_docs, valid_metas, valid_ids = [], [], [], []
        for (chunk, meta, doc_id), emb in zip(batch, embeddings):
            if emb is not None:
                valid_embs.append(emb)
                valid_docs.append(chunk)
                valid_metas.append(meta)
                valid_ids.append(doc_id)

        if valid_embs:
            collection.upsert(
                embeddings=valid_embs,
                documents=valid_docs,
                metadatas=valid_metas,
                ids=valid_ids,
            )
            total_chunks += len(valid_embs)

        done = min(batch_start + EMBED_BATCH_SIZE, total)
        pct = done / total * 100
        print(f"  [{pct:5.1f}%] {done}/{total} chunks embedded...")

    metadata = {}
    if os.path.exists(METADATA_FILE):
        try:
            with open(METADATA_FILE, "r", encoding="utf-8") as f:
                metadata = json.load(f)
        except Exception:
            pass

    metadata[base_url] = {
        "indexed_at": datetime.now().isoformat(),
        "pages_count": len(pages),
        "chunks_count": total_chunks,
        "site_hash": site_hash,
    }
    with open(METADATA_FILE, "w", encoding="utf-8") as f:
        json.dump(metadata, f, ensure_ascii=False, indent=2)

    print()
    print("=" * 60)
    print(f"✅ Done! Embedded {total_chunks} chunks from {len(pages)} pages")
    print(f"   Site: {base_url}")
    print(f"   Metadata saved to {METADATA_FILE}")
    print("=" * 60)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Использование: python embed_only.py <base_url>")
        print("Пример:        python embed_only.py https://example.com")
        sys.exit(1)

    base_url = sys.argv[1].rstrip("/")
    embed_pages(base_url)
