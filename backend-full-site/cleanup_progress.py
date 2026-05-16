"""
Deduplicate scraped progress file and prepare for embedding.

Steps:
  1. Read existing .jsonl progress file
  2. Remove duplicate URLs (keep first occurrence)
  3. Remove pages with identical content (MD5 fingerprint)
  4. Write clean file back to disk
  5. Delete queue file so next run skips scraping and goes straight to embedding

Usage:
  python cleanup_progress.py https://example.com
"""

import hashlib
import json
import os
import sys


PROGRESS_DIR = "./scrape_progress"


def slug(base_url: str) -> str:
    return hashlib.md5(base_url.encode()).hexdigest()[:12]


def progress_file(base_url: str) -> str:
    return os.path.join(PROGRESS_DIR, f"{slug(base_url)}.jsonl")


def queue_file(base_url: str) -> str:
    return os.path.join(PROGRESS_DIR, f"{slug(base_url)}_queue.json")


def cleanup(base_url: str):
    pfile = progress_file(base_url)
    qfile = queue_file(base_url)

    if not os.path.exists(pfile):
        print(f"❌ Progress file not found: {pfile}")
        print(f"   Make sure you run this from the backend-full-site directory")
        return

    print(f"📂 Reading: {pfile}")

    pages = []
    errors = 0
    with open(pfile, "r", encoding="utf-8") as f:
        for i, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                pages.append(json.loads(line))
            except Exception:
                errors += 1

    total_raw = len(pages)
    print(f"📄 Loaded {total_raw} pages ({errors} parse errors ignored)")

    seen_urls = set()
    dedup_url = []
    for p in pages:
        url = p.get("url", "")
        if url and url not in seen_urls:
            seen_urls.add(url)
            dedup_url.append(p)

    dup_url_count = total_raw - len(dedup_url)
    print(f"🔗 Removed {dup_url_count} duplicate URLs → {len(dedup_url)} remaining")

    seen_hashes = set()
    dedup_content = []
    for p in dedup_url:
        content = p.get("content", "")
        fp = hashlib.md5(content[:2000].encode()).hexdigest()
        if fp not in seen_hashes:
            seen_hashes.add(fp)
            dedup_content.append(p)

    dup_content_count = len(dedup_url) - len(dedup_content)
    print(f"📝 Removed {dup_content_count} duplicate content pages → {len(dedup_content)} remaining")

    total_removed = total_raw - len(dedup_content)
    print(f"\n✅ Total removed: {total_removed} pages ({total_removed/total_raw*100:.1f}%)")
    print(f"✅ Clean pages:   {len(dedup_content)}")

    backup = pfile + ".bak"
    os.replace(pfile, backup)
    print(f"\n💾 Backup saved: {backup}")

    with open(pfile, "w", encoding="utf-8") as f:
        for p in dedup_content:
            f.write(json.dumps(p, ensure_ascii=False) + "\n")

    print(f"💾 Clean file written: {pfile}")

    if os.path.exists(qfile):
        os.unlink(qfile)
        print(f"🗑️  Queue file deleted (next run will skip scraping)")

    print()
    print("=" * 60)
    print("Следующий шаг:")
    print("  Запусти сервер и отправь POST /api/index-website")
    print("  с параметром force_reindex: false")
    print("  ИЛИ запусти embed_only.py для прямой индексации")
    print("=" * 60)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Использование: python cleanup_progress.py <base_url>")
        print("Пример:        python cleanup_progress.py https://example.com")
        sys.exit(1)

    base_url = sys.argv[1].rstrip("/")
    cleanup(base_url)
