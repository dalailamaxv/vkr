
chrome.runtime.onInstalled.addListener(async () => {
  const { reloadTabId } = await chrome.storage.local.get('reloadTabId');
  if (reloadTabId) {
    await chrome.storage.local.remove('reloadTabId');
    chrome.tabs.reload(reloadTabId).catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'checkBackendStatus') {
    checkBackend().then(sendResponse);
    return true;
  }
  if (request.action === 'fetchBackend') {
    fetchBackendProxy(request.url, request.method, request.body).then(sendResponse);
    return true;
  }
});

async function fetchBackendProxy(url, method, body) {
  try {
    const response = await fetch(url, {
      method: method || 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json();
    return { ok: response.ok, status: response.status, data };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function checkBackend() {
  try {
    const response = await fetch('http://localhost:8000/health');
    return { available: response.ok };
  } catch (error) {
    return { available: false };
  }
}
