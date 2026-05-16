"""
Скрипт для индексации сайта со скрытыми страницами

Использование:
1. Отредактируй BASE_URL и MANUAL_URLS ниже
2. Запусти: python index_with_hidden_pages.py
"""

import requests
import time


BASE_URL = "https://example.com/"

MAX_PAGES = 0

MANUAL_URLS = [
    "https://example.com/",
    "https://example.com/ba/",
    "https://example.com/ma/",
]

FORCE_REINDEX = False

BACKEND_URL = "http://localhost:8000"



def index_website():
    """Запуск индексации"""
    
    print("=" * 60)
    print("🚀 Запуск индексации сайта")
    print("=" * 60)
    print(f"📍 Сайт: {BASE_URL}")
    print(f"📄 Макс. страниц: {MAX_PAGES}")
    print(f"📝 Ручных URL: {len(MANUAL_URLS)}")
    print(f"🔄 Ре-индексация: {FORCE_REINDEX}")
    print("=" * 60)
    
    try:
        health = requests.get(f"{BACKEND_URL}/health", timeout=5)
        if health.status_code != 200:
            print("❌ Backend недоступен!")
            print(f"   Запустите: python backend-full-site/main.py")
            return
        print("✅ Backend доступен")
    except:
        print("❌ Backend недоступен на", BACKEND_URL)
        print("   Запустите: python backend-full-site/main.py")
        return
    
    print()
    
    payload = {
        "base_url": BASE_URL,
        "max_pages": MAX_PAGES,
        "force_reindex": FORCE_REINDEX,
    }
    
    if MANUAL_URLS:
        payload["manual_urls"] = MANUAL_URLS
        print(f"📝 Добавлено {len(MANUAL_URLS)} ручных URL:")
        for url in MANUAL_URLS[:5]:  # Показываем первые 5
            print(f"   • {url}")
        if len(MANUAL_URLS) > 5:
            print(f"   ... и ещё {len(MANUAL_URLS) - 5}")
        print()
    
    print("🔄 Отправляю запрос на индексацию...")
    
    try:
        response = requests.post(
            f"{BACKEND_URL}/api/index-website",
            json=payload,
            timeout=10
        )
        
        if response.status_code == 200:
            data = response.json()
            
            if data["status"] == "indexing":
                print("✅ Индексация запущена!")
                print()
                print("⏳ Это займёт 5-15 минут для 500 страниц")
                print("   Можешь закрыть этот скрипт - индексация идёт в фоне")
                print()
                print("📊 Проверить статус:")
                print(f"   curl {BACKEND_URL}/api/index-status/{BASE_URL}")
                
                if input("\nЖдать завершения? (y/n): ").lower() == 'y':
                    wait_for_completion()
                
            elif data["status"] == "completed":
                print("ℹ️  Сайт уже проиндексирован:")
                print(f"   📄 Страниц: {data['pages_scraped']}")
                print(f"   📝 Фрагментов: {data['total_chunks']}")
                print()
                print("💡 Для ре-индексации установи FORCE_REINDEX = True")
        else:
            print(f"❌ Ошибка: {response.status_code}")
            print(response.text)
            
    except Exception as e:
        print(f"❌ Ошибка: {e}")


def wait_for_completion():
    """Ожидание завершения индексации"""
    print()
    print("⏳ Проверяю статус каждые 30 секунд...")
    print("   (нажми Ctrl+C для выхода)")
    print()
    
    try:
        while True:
            time.sleep(30)
            
            response = requests.get(
                f"{BACKEND_URL}/api/index-status/{BASE_URL}",
                timeout=5
            )
            
            if response.status_code == 200:
                data = response.json()
                
                if data["status"] == "completed":
                    info = data["data"]
                    print()
                    print("=" * 60)
                    print("🎉 ИНДЕКСАЦИЯ ЗАВЕРШЕНА!")
                    print("=" * 60)
                    print(f"📄 Страниц проиндексировано: {info['pages_count']}")
                    print(f"📝 Создано фрагментов: {info['chunks_count']}")
                    print(f"🕐 Время: {info['indexed_at']}")
                    print("=" * 60)
                    break
                else:
                    print("⏳ Всё ещё индексируется...")
            else:
                print("⚠️  Не могу проверить статус")
                
    except KeyboardInterrupt:
        print()
        print("⏹️  Остановлено. Индексация продолжится в фоне.")


def check_status():
    """Проверка текущего статуса индексации"""
    print("🔍 Проверка статуса индексации...")
    
    try:
        response = requests.get(
            f"{BACKEND_URL}/api/index-status/{BASE_URL}",
            timeout=5
        )
        
        if response.status_code == 200:
            data = response.json()
            
            if data["status"] == "completed":
                info = data["data"]
                print()
                print("✅ Сайт проиндексирован:")
                print(f"   📄 Страниц: {info['pages_count']}")
                print(f"   📝 Фрагментов: {info['chunks_count']}")
                print(f"   🕐 {info['indexed_at']}")
            else:
                print()
                print("⚠️  Сайт не проиндексирован")
                print("   Запустите индексацию")
        else:
            print(f"❌ Ошибка: {response.status_code}")
            
    except Exception as e:
        print(f"❌ Ошибка: {e}")


if __name__ == "__main__":
    import sys
    
    if len(sys.argv) > 1 and sys.argv[1] == "status":
        check_status()
    else:
        index_website()
