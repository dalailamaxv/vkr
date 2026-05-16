
function bgFetch(url, method = 'GET', body = null) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'fetchBackend', url, method, body }, resolve);
  });
}

let currentTab = null;

chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  currentTab = tabs[0];

  if (!currentTab || !currentTab.url || !currentTab.url.startsWith('http')) {
    updateStatus('⚠️ Откройте любой сайт для работы с ботом', '');
    document.getElementById('indexWebsite').disabled = true;
    document.getElementById('toggleChat').disabled = true;
    document.getElementById('checkStatus').disabled = true;
    return;
  }

  checkSiteStatus();
});

document.getElementById('toggleChat').addEventListener('click', async () => {
  chrome.tabs.sendMessage(currentTab.id, { action: 'toggleChat' }, (response) => {
    if (chrome.runtime.lastError) {
      updateStatus('❌ Обновите страницу и попробуйте снова', 'error');
      return;
    }
    if (response && response.success) {
      updateStatus('✅ Чат открыт на странице', 'active');
    }
  });
});

document.getElementById('indexWebsite').addEventListener('click', async () => {
  const baseUrl = getBaseUrl(currentTab.url);

  if (!confirm(`Проиндексировать весь сайт ${baseUrl}?\n\nИндексация пройдёт по всем доступным страницам без лимита.\nВы сможете закрыть это окно - индексация продолжится в фоне.`)) {
    return;
  }

  updateStatus('🔄 Запускаю индексацию...', 'indexing');
  document.getElementById('progress').style.display = 'block';

  try {
    const result = await bgFetch('http://localhost:8000/api/index-website', 'POST', {
      base_url: baseUrl,
      max_pages: 0,
      force_reindex: true,
    });

    if (result && result.ok) {
      const data = result.data;
      if (data.status === 'indexing') {
        updateStatus(`🔄 Индексация запущена для ${baseUrl}\nСтатус можно проверить кнопкой ниже`, 'indexing');
        startStatusPolling(baseUrl);
      } else if (data.status === 'completed') {
        updateStatus(`✅ Сайт уже проиндексирован\n${data.pages_scraped} страниц, ${data.total_chunks} фрагментов`, 'active');
        document.getElementById('progress').style.display = 'none';
      }
    } else {
      updateStatus(`❌ Ошибка запуска индексации: ${result?.error || 'нет ответа от сервера'}`, 'error');
      document.getElementById('progress').style.display = 'none';
    }
  } catch (error) {
    updateStatus('❌ Backend недоступен. Запустите сервер.', 'error');
    document.getElementById('progress').style.display = 'none';
  }
});

document.getElementById('checkStatus').addEventListener('click', async () => {
  checkSiteStatus();
});

async function checkSiteStatus() {
  if (!currentTab) return;

  const baseUrl = getBaseUrl(currentTab.url);

  try {
    const result = await bgFetch(`http://localhost:8000/api/index-status/${encodeURIComponent(baseUrl)}`);

    if (result && result.ok) {
      const data = result.data;
      if (data.status === 'completed') {
        const info = data.data;
        updateStatus(
          `✅ Сайт проиндексирован\n` +
          `📄 Страниц: ${info.pages_count}\n` +
          `📝 Фрагментов: ${info.chunks_count}\n` +
          `🕐 ${new Date(info.indexed_at).toLocaleString('ru')}`,
          'active'
        );
        document.getElementById('progress').style.display = 'none';
      } else {
        updateStatus(`⚠️ Сайт не проиндексирован\nНажмите "Проиндексировать весь сайт"`, '');
      }
    } else {
      updateStatus('❌ Backend недоступен', 'error');
    }
  } catch (error) {
    updateStatus('❌ Backend недоступен', 'error');
  }
}

function startStatusPolling(baseUrl) {
  const pollInterval = setInterval(async () => {
    try {
      const result = await bgFetch(`http://localhost:8000/api/index-status/${encodeURIComponent(baseUrl)}`);
      if (result && result.ok && result.data.status === 'completed') {
        clearInterval(pollInterval);
        updateStatus(`✅ Индексация завершена!\n${result.data.data.pages_count} страниц`, 'active');
        document.getElementById('progress').style.display = 'none';
      }
    } catch (_) { /* continue polling */ }
  }, 30000);

  setTimeout(() => clearInterval(pollInterval), 1800000);
}

function getBaseUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return url;
  }
}

function updateStatus(message, className) {
  const statusEl = document.getElementById('status');
  statusEl.textContent = message;
  statusEl.className = className ? `status ${className}` : 'status';
}

document.getElementById('reloadExtension').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await chrome.storage.local.set({ reloadTabId: tab.id });
  chrome.runtime.reload();
});

window.addEventListener('load', async () => {
  try {
    const result = await bgFetch('http://localhost:8000/health');
    if (result && result.ok) {
      const data = result.data;
      updateStatus(
        data.indexed_sites > 0
          ? `✅ Backend подключен\n${data.indexed_sites} сайтов проиндексировано`
          : '✅ Backend подключен\nСайтов пока не проиндексировано',
        'active'
      );
    } else {
      updateStatus('⚠️ Backend не запущен\nЗапустите: python main.py', 'error');
    }
  } catch (error) {
    updateStatus('⚠️ Backend не запущен\nЗапустите: python main.py', 'error');
  }
});
