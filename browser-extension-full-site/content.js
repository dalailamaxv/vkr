
let chatWidgetVisible = false;
let chatWidget = null;
let launcherBtn = null;
let greetingPlayed = false;
let greetingResetTimer = null;
let greetingVideoEl = null;
let recognition = null;
let recognitionActive = false;

// Last 6 turns (3 Q&A pairs) kept for GPT-4o-mini context
let conversationHistory = [];

// Assistant avatar — large version for the avatar stage
const ASSISTANT_SVG_LARGE = `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="faqAvatarLargeBg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#818cf8"/>
      <stop offset="100%" stop-color="#38bdf8"/>
    </linearGradient>
  </defs>
  <circle cx="60" cy="60" r="56" fill="url(#faqAvatarLargeBg)" opacity="0.55"/>
  <rect x="32" y="30" width="56" height="52" rx="22" fill="rgba(255,255,255,0.9)"/>
  <circle cx="50" cy="54" r="5" fill="#4f46e5"/>
  <circle cx="70" cy="54" r="5" fill="#4f46e5"/>
  <rect x="48" y="67" width="24" height="5.5" rx="2.75" fill="#4f46e5"/>
  <rect x="55" y="18" width="10" height="16" rx="5" fill="rgba(255,255,255,0.9)"/>
  <circle cx="60" cy="16" r="5" fill="#a5b4fc"/>
</svg>`;

// Assistant avatar — small version for message bubbles and header
const ASSISTANT_SVG_SMALL = `<svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="faqAvatarSmallBg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#818cf8"/>
      <stop offset="100%" stop-color="#38bdf8"/>
    </linearGradient>
  </defs>
  <circle cx="40" cy="40" r="38" fill="url(#faqAvatarSmallBg)"/>
  <rect x="21" y="19" width="38" height="36" rx="14" fill="rgba(255,255,255,0.92)"/>
  <circle cx="32" cy="36" r="3.5" fill="#4f46e5"/>
  <circle cx="48" cy="36" r="3.5" fill="#4f46e5"/>
  <rect x="31" y="44" width="18" height="4" rx="2" fill="#4f46e5"/>
  <rect x="36.5" y="10" width="7" height="10" rx="3.5" fill="rgba(255,255,255,0.92)"/>
  <circle cx="40" cy="9" r="3.2" fill="#a5b4fc"/>
</svg>`;

// Launcher button: chat icon
const LAUNCHER_SVG = `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" fill="none">
  <path d="M 6 7 Q 6 4 9 4 L 31 4 Q 34 4 34 7 L 34 24 Q 34 27 31 27 L 20 27 L 12 34 L 12 27 L 9 27 Q 6 27 6 24 Z" fill="white" opacity="0.95"/>
  <circle cx="15" cy="15.5" r="2" fill="rgba(79,70,229,0.7)"/>
  <circle cx="20" cy="15.5" r="2" fill="rgba(79,70,229,0.7)"/>
  <circle cx="25" cy="15.5" r="2" fill="rgba(79,70,229,0.7)"/>
</svg>`;

const FAQ_POSTER_MARKUP = `
  <div class="faq-avatar-video-wrap faq-avatar-video-wrap-pinned faq-avatar-idle-shell">
    <div class="faq-avatar-idle-core">${ASSISTANT_SVG_LARGE}</div>
  </div>`;

// Replace green-screen pixels with white using a canvas overlay.
// The video element stays hidden (drives audio); canvas renders the processed frames.
// onFirstFrame (optional) is called once the first frame has been painted to canvas —
// used by the switch logic to remove the previous canvas only after the new one is ready.
function startChromaKey(vid, onFirstFrame) {
  if (vid._chromaKeyActive) return;
  vid._chromaKeyActive = true;

  const SIZE = 200; // matches .faq-video-circle dimensions
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  // Do not copy `faq-active-video` onto canvas: active selectors must point to <video>.
  canvas.className = 'faq-avatar-video-canvas';
  if (vid.style.cssText) canvas.style.cssText = vid.style.cssText;
  canvas.style.visibility = ''; // never inherit visibility:hidden from the video element
  vid.style.visibility = 'hidden';
  vid._chromaCanvas = canvas; // stored so the switch logic can remove it later
  vid.parentNode.insertBefore(canvas, vid);

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let animId;
  let running = true;
  let firstFrameDone = false;

  function draw() {
    if (!running) return;
    animId = requestAnimationFrame(draw);
    if (vid.readyState < 2 || vid.videoWidth === 0) return;

    // Draw with object-fit:cover behaviour (scale to fill, centred)
    const vw = vid.videoWidth, vh = vid.videoHeight;
    const scale = Math.max(SIZE / vw, SIZE / vh);
    const dw = vw * scale, dh = vh * scale;
    const dx = (SIZE - dw) / 2, dy = (SIZE - dh) / 2;
    ctx.drawImage(vid, dx, dy, dw, dh);

    const frame = ctx.getImageData(0, 0, SIZE, SIZE);
    const d = frame.data;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      if (g > 80 && g - r > 30 && g - b > 30) {
        d[i] = 241; d[i + 1] = 245; d[i + 2] = 249; d[i + 3] = 255;
      }
    }
    ctx.putImageData(frame, 0, 0);

    if (!firstFrameDone) {
      firstFrameDone = true;
      if (onFirstFrame) onFirstFrame();
    }
  }

  draw();
  // On ended: stop the draw loop but keep the canvas — it stays showing the last
  // frame so there is no blank gap before the next fragment's canvas takes over.
  vid.addEventListener('ended', () => { running = false; cancelAnimationFrame(animId); }, { once: true });
}
const FAQ_GREETING_TEXT = 'Привет! Я уже готов помочь. Задавай свой вопрос по сайту.';
const FAQ_GREETING_VIDEO = chrome.runtime.getURL('assets/intro/greeting.mp4');
const FAQ_ASSISTANT_NAME = 'Помощник';
const FAQ_STATUS_TEXT = {
  idle: 'Готов помочь',
  listening: 'Слушаю вопрос',
  thinking: 'Думаю над ответом...',
  speaking: 'Отвечаю',
};

function getSpeechRecognition() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function setAssistantStatus(state = 'idle') {
  const statusEl = document.getElementById('faq-status-text');
  if (statusEl) statusEl.textContent = FAQ_STATUS_TEXT[state] || FAQ_STATUS_TEXT.idle;

  const dot = document.querySelector('.faq-status-dot');
  if (dot) {
    dot.classList.remove('faq-status-thinking', 'faq-status-speaking', 'faq-status-listening');
    if (state === 'thinking') dot.classList.add('faq-status-thinking');
    else if (state === 'speaking') dot.classList.add('faq-status-speaking');
    else if (state === 'listening') dot.classList.add('faq-status-listening');
  }
}

function renderAvatarStage(state = 'idle') {
  const stage = document.getElementById('faq-avatar-stage');
  if (!stage) return;

  if (state === 'idle') {
    stage.innerHTML = FAQ_POSTER_MARKUP;
    return;
  }

  if (state === 'greeting') {
    stage.innerHTML = `
      <div class="faq-avatar-video-wrap faq-avatar-video-wrap-pinned faq-avatar-idle-shell">
        <video class="faq-avatar-video faq-avatar-video-greeting"
          src="${FAQ_GREETING_VIDEO}"
          autoplay
          playsinline
          preload="auto"
          crossorigin="anonymous"
          title="Приветствие ассистента"></video>
      </div>`;

    const video = stage.querySelector('video');
    if (video) {
      greetingVideoEl = video;
      video.addEventListener('ended', () => {
        try {
          video.pause();
          video.currentTime = Math.max(0, video.duration - 0.05);
        } catch {}
        setAssistantStatus('idle');
      }, { once: true });
      video.addEventListener('error', () => {
        setAssistantStatus('idle');
      }, { once: true });
      video.muted = false;
      video.volume = 1;
      video.addEventListener('playing', () => startChromaKey(video), { once: true });
      video.play().catch(() => {
        setAssistantStatus('idle');
      });
    }
    return;
  }

  if (state === 'loading') {
    stage.innerHTML = `
      <div class="faq-avatar-video-wrap faq-avatar-video-wrap-pinned faq-avatar-idle-shell">
        <div class="faq-avatar-idle-core faq-avatar-idle-core-loading">${ASSISTANT_SVG_LARGE}</div>
      </div>`;
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'toggleChat') {
    toggleChatWidget();
    sendResponse({ success: true });
  } else if (request.action === 'parsePage') {
    const pageContent = extractPageContent();
    sendResponse(pageContent);
  }
  return true; // Keep message channel open for async response
});

function ensureLauncher() {
  if (launcherBtn) return;
  launcherBtn = document.createElement('button');
  launcherBtn.id = 'faq-launcher-btn';
  launcherBtn.title = 'Открыть ассистента';
  launcherBtn.innerHTML = LAUNCHER_SVG;
  launcherBtn.addEventListener('click', toggleChatWidget);
  document.body.appendChild(launcherBtn);
}

// Inject launcher as soon as the content script loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', ensureLauncher);
} else {
  ensureLauncher();
}

function toggleChatWidget() {
  if (chatWidgetVisible) {
    hideChatWidget();
  } else {
    showChatWidget();
  }
}

function maybePlayGreeting() {
  if (greetingPlayed) return;
  greetingPlayed = true;
  setAssistantStatus('speaking');
  renderAvatarStage('greeting');
}

function showChatWidget() {
  if (launcherBtn) launcherBtn.classList.add('faq-launcher-hidden');

  if (chatWidget) {
    chatWidget.style.display = 'block';
    chatWidget.style.animation = 'none';
    chatWidget.offsetHeight; // reflow to restart animation
    chatWidget.style.animation = '';
    chatWidgetVisible = true;
    maybePlayGreeting();
    return;
  }

  chatWidget = document.createElement('div');
  chatWidget.id = 'faq-assistant-widget';
  chatWidget.innerHTML = `
    <div class="faq-chat-container">
      <div class="faq-chat-header" id="faq-chat-header">
        <div class="faq-header-content">
          <div class="faq-avatar faq-avatar-ella">${ASSISTANT_SVG_SMALL}</div>
          <div class="faq-header-text">
            <div class="faq-title">${FAQ_ASSISTANT_NAME}</div>
            <div class="faq-status"><span class="faq-status-dot"></span><span id="faq-status-text">${FAQ_STATUS_TEXT.idle}</span></div>
          </div>
        </div>
        <button class="faq-close-btn" id="faq-close-btn">×</button>
      </div>

      <div class="faq-messages" id="faq-messages">
        <div class="faq-message faq-bot-message">
          <div class="faq-message-avatar faq-message-avatar-ella">${ASSISTANT_SVG_SMALL}</div>
          <div class="faq-message-content">
            <div class="faq-message-bubble">
              Привет! Я могу находить информацию по всему сайту ${window.location.host}. Сначала проиндексируйте сайт через иконку расширения, а потом просто задавайте вопросы ✨
            </div>
          </div>
        </div>

        <div class="faq-quick-questions">
          <button class="faq-quick-btn" id="faq-quick-1">📄 Приём документов</button>
          <button class="faq-quick-btn" id="faq-quick-2">📍 Контакты менеджера</button>
          <button class="faq-quick-btn" id="faq-quick-3">💰 Стоимость обучения</button>
        </div>

        <div class="faq-empty-state" id="faq-empty-state">
          <div class="faq-empty-title">Что можно спросить</div>
          <div class="faq-empty-grid">
            <div class="faq-empty-card faq-empty-card-clickable">Сроки и правила приёма документов</div>
            <div class="faq-empty-card faq-empty-card-clickable">Контакты кафедр и приёмной комиссии</div>
            <div class="faq-empty-card faq-empty-card-clickable">Стоимость обучения и формы оплаты</div>
            <div class="faq-empty-card faq-empty-card-clickable">Направления подготовки и программы</div>
          </div>
        </div>
      </div>

      <div class="faq-resize-handle" id="faq-resize-handle" title="Изменить размер"></div>
      <div class="faq-input-container">
        <input
          type="text"
          id="faq-input"
          class="faq-input"
          placeholder="Задайте вопрос..."
        />
        <button class="faq-voice-btn" id="faq-voice-btn" title="Голосовой ввод">
          🎤
        </button>
        <button class="faq-send-btn" id="faq-send-btn">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" width="20" height="20">
            <path d="M22 2L11 13" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(chatWidget);
  chatWidgetVisible = true;
  setAssistantStatus('idle');
  maybePlayGreeting();

  setupDrag();
  setupResize();

  document.getElementById('faq-close-btn').addEventListener('click', hideChatWidget);
  document.getElementById('faq-send-btn').addEventListener('click', sendMessage);
  document.getElementById('faq-voice-btn').addEventListener('click', toggleVoiceInput);
  document.getElementById('faq-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
  });
  initVoiceSupport();
  document.getElementById('faq-quick-1').addEventListener('click', () => {
    askQuestion('Когда начинается приём документов?');
  });
  document.getElementById('faq-quick-2').addEventListener('click', () => {
    askQuestion('Где найти контакты менеджера магистратской программы бизнес информатика?');
  });
  document.getElementById('faq-quick-3').addEventListener('click', () => {
    askQuestion('Сколько стоит обучение?');
  });

  chatWidget.querySelectorAll('.faq-empty-card-clickable').forEach(card => {
    card.addEventListener('click', () => askQuestion(card.textContent.trim()));
  });
}

function setupDrag() {
  const header = document.getElementById('faq-chat-header');
  const widget = chatWidget;
  let dragging = false, startX, startY, startLeft, startTop;

  header.addEventListener('mousedown', (e) => {
    if (e.target.id === 'faq-close-btn') return;
    dragging = true;
    const rect = widget.getBoundingClientRect();
    widget.style.bottom = 'auto';
    widget.style.right = 'auto';
    widget.style.top = rect.top + 'px';
    widget.style.left = rect.left + 'px';
    startX = e.clientX;
    startY = e.clientY;
    startLeft = rect.left;
    startTop = rect.top;
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const newLeft = Math.max(0, Math.min(window.innerWidth - 80, startLeft + dx));
    const newTop  = Math.max(0, Math.min(window.innerHeight - 80, startTop + dy));
    widget.style.left = newLeft + 'px';
    widget.style.top  = newTop  + 'px';
  });

  document.addEventListener('mouseup', () => { dragging = false; });
}

function setupResize() {
  const handle = document.getElementById('faq-resize-handle');
  const container = chatWidget.querySelector('.faq-chat-container');
  const widget = chatWidget;
  let resizing = false, startX, startY, startW, startH;

  handle.addEventListener('mousedown', (e) => {
    resizing = true;
    const rect = widget.getBoundingClientRect();
    widget.style.bottom = 'auto';
    widget.style.right = 'auto';
    widget.style.top = rect.top + 'px';
    widget.style.left = rect.left + 'px';
    startX = e.clientX;
    startY = e.clientY;
    startW = container.offsetWidth;
    startH = container.offsetHeight;
    e.preventDefault();
    e.stopPropagation();
  });

  document.addEventListener('mousemove', (e) => {
    if (!resizing) return;
    const newW = Math.max(300, Math.min(900, startW + (e.clientX - startX)));
    const newH = Math.max(400, Math.min(950, startH + (e.clientY - startY)));
    container.style.width = newW + 'px';
    container.style.height = newH + 'px';
  });

  document.addEventListener('mouseup', () => { resizing = false; });
}

function hideChatWidget() {
  if (!chatWidget) return;
  chatWidget.classList.add('faq-widget-hide');
  chatWidgetVisible = false;
  if (launcherBtn) launcherBtn.classList.remove('faq-launcher-hidden');
  chatWidget.addEventListener('animationend', () => {
    chatWidget.style.display = 'none';
    chatWidget.classList.remove('faq-widget-hide');
  }, { once: true });
}

function askQuestion(question) {
  const input = document.getElementById('faq-input');
  input.value = question;
  const quickQ = chatWidget && chatWidget.querySelector('.faq-quick-questions');
  if (quickQ) quickQ.remove();
  sendMessage();
}

async function sendMessage() {
  const input = document.getElementById('faq-input');
  const question = input.value.trim();
  if (!question) return;

  addMessage(question, true);
  input.value = '';
  const quickQ = chatWidget && chatWidget.querySelector('.faq-quick-questions');
  if (quickQ) quickQ.remove();
  setAssistantStatus('thinking');
  addTypingIndicator();

  const baseUrl = `${window.location.protocol}//${window.location.host}`;

  try {
    const response = await fetch('http://localhost:8000/api/ask-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question,
        website_url: baseUrl,
        current_page_url: window.location.href,
        detailed: false,
        history: conversationHistory.slice(-6),
      }),
    });

    if (!response.ok) {
      removeTypingIndicator();
      setAssistantStatus('idle');
      addMessage('Извините, произошла ошибка. Проверьте, что backend запущен.', false);
      return;
    }

    setAssistantStatus('speaking');
    let messageDiv = null;
    let bubble = null;
    let streamedText = '';

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const data = JSON.parse(line.slice(6));

          if (data.type === 'text') {
            streamedText += data.content;
            if (!bubble) {
              ({ messageDiv, bubble } = _createStreamingBubble());
              removeTypingIndicator();
            }
            bubble.textContent = streamedText;
            const mc = document.getElementById('faq-messages');
            if (mc) mc.scrollTop = mc.scrollHeight;

          } else if (data.type === 'done') {
            if (!bubble) {
              ({ messageDiv, bubble } = _createStreamingBubble());
              removeTypingIndicator();
            }
            bubble.innerHTML = data.answer || streamedText || bubble.textContent;
            _finalizeStreamingMessage(messageDiv, data, question);

            const plainText = data.plain_answer || bubble.textContent;
            conversationHistory.push({ user: question, assistant: plainText });
            if (conversationHistory.length > 6) conversationHistory.shift();

            // Launch parallel D-ID parts and play them sequentially in one circle
            const parts = data.video_parts || [];
            if (parts.length > 0) {
              const contentDiv = messageDiv.querySelector('.faq-message-content');
              if (contentDiv) {
                const slotId = 'did-slot-' + parts[0];
                const slot = document.createElement('div');
                slot.id = slotId;
                slot.className = 'faq-avatar-video-slot';
                slot.innerHTML = `
                  <div class="faq-video-circle faq-video-circle-pending">
                    <svg class="faq-video-pending-ring" viewBox="0 0 40 40" width="52" height="52" xmlns="http://www.w3.org/2000/svg">
                      <circle cx="20" cy="20" r="16" fill="none" stroke="#c7d2fe" stroke-width="3.5"/>
                      <circle cx="20" cy="20" r="16" fill="none" stroke="#4f46e5" stroke-width="3.5"
                        stroke-linecap="round" stroke-dasharray="25 75"/>
                    </svg>
                  </div>
                  <div class="faq-avatar-badge">генерирую видео...</div>`;
                contentDiv.insertBefore(slot, contentDiv.firstChild);
                startVideoChain(parts, slotId);
              }
            }
            setAssistantStatus('idle');
          }
        } catch (_) {}
      }
    }
    removeTypingIndicator();
  } catch (error) {
    removeTypingIndicator();
    setAssistantStatus('idle');
    addMessage('❌ Ошибка подключения к серверу. Запустите backend командой: python main.py', false);
  }
}

function initVoiceSupport() {
  const voiceBtn = document.getElementById('faq-voice-btn');
  if (!voiceBtn) return;
  if (!getSpeechRecognition()) {
    voiceBtn.disabled = true;
    voiceBtn.title = 'Голосовой ввод не поддерживается в этом браузере';
  }
}

function toggleVoiceInput() {
  if (recognitionActive) {
    recognition?.stop();
    return;
  }

  const SR = getSpeechRecognition();
  if (!SR) return;

  recognition = new SR();
  recognition.lang = 'ru-RU';
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  const input = document.getElementById('faq-input');
  const voiceBtn = document.getElementById('faq-voice-btn');

  recognition.onstart = () => {
    recognitionActive = true;
    setAssistantStatus('listening');
    if (voiceBtn) voiceBtn.classList.add('faq-voice-btn-listening');
  };

  recognition.onresult = (event) => {
    let transcript = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      transcript += event.results[i][0].transcript;
    }
    if (input) input.value = transcript.trim();
  };

  recognition.onend = () => {
    recognitionActive = false;
    setAssistantStatus('idle');
    if (voiceBtn) voiceBtn.classList.remove('faq-voice-btn-listening');
  };

  recognition.onerror = () => {
    recognitionActive = false;
    setAssistantStatus('idle');
    if (voiceBtn) voiceBtn.classList.remove('faq-voice-btn-listening');
  };

  recognition.start();
}

function _createStreamingBubble() {
  const mc = document.getElementById('faq-messages');
  const emptyState = document.getElementById('faq-empty-state');
  if (emptyState) emptyState.style.display = 'none';

  const messageDiv = document.createElement('div');
  messageDiv.className = 'faq-message faq-bot-message';

  const avatarDiv = document.createElement('div');
  avatarDiv.className = 'faq-message-avatar faq-message-avatar-ella';
  avatarDiv.innerHTML = ASSISTANT_SVG_SMALL;

  const contentDiv = document.createElement('div');
  contentDiv.className = 'faq-message-content';

  const bubble = document.createElement('div');
  bubble.className = 'faq-message-bubble';

  contentDiv.appendChild(bubble);
  messageDiv.appendChild(avatarDiv);
  messageDiv.appendChild(contentDiv);
  mc.appendChild(messageDiv);
  mc.scrollTop = mc.scrollHeight;

  return { messageDiv, bubble };
}

function _finalizeStreamingMessage(messageDiv, data, originalQuestion) {
  const contentDiv = messageDiv.querySelector('.faq-message-content');

  if (data.sources && data.sources.length > 0) {
    const sourcesDiv = document.createElement('div');
    sourcesDiv.className = 'faq-sources';
    sourcesDiv.innerHTML = `
      <div class="faq-sources-title">📎 Источники:</div>
      ${data.sources.map(url => {
        let path = url;
        try { path = new URL(url).pathname || url; } catch (_) {}
        return `<a class="faq-source-link" href="${url}" target="_blank" title="${url}">🔗 ${path}</a>`;
      }).join('')}
    `;
    contentDiv.appendChild(sourcesDiv);
  }

  if (originalQuestion) {
    const moreBtn = document.createElement('button');
    moreBtn.className = 'faq-more-btn';
    moreBtn.textContent = 'Ответить подробнее';
    contentDiv.appendChild(moreBtn);

    moreBtn.addEventListener('click', async () => {
      moreBtn.disabled = true;
      moreBtn.textContent = 'Загружаю...';
      try {
        const result = await new Promise((resolve) => {
          chrome.runtime.sendMessage({
            action: 'fetchBackend',
            url: 'http://localhost:8000/api/ask',
            method: 'POST',
            body: {
              question: originalQuestion,
              website_url: `${window.location.protocol}//${window.location.host}`,
              current_page_url: window.location.href,
              detailed: true,
            },
          }, resolve);
        });
        if (result && result.ok) {
          moreBtn.remove();
          addBotMessage(result.data.answer, result.data.emotion, null, result.data.sources || [], result.data.video_job_id, '', '');
        } else {
          moreBtn.disabled = false;
          moreBtn.textContent = 'Ответить подробнее';
        }
      } catch (_) {
        moreBtn.disabled = false;
        moreBtn.textContent = 'Ответить подробнее';
      }
    });
  }
}

function addMessage(text, isUser) {
  const messagesContainer = document.getElementById('faq-messages');
  const messageDiv = document.createElement('div');
  messageDiv.className = isUser ? 'faq-message faq-user-message' : 'faq-message faq-bot-message';
  
  const userAvatarSvg = `<svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg" width="26" height="26">
    <circle cx="40" cy="30" r="18" fill="#fff" opacity="0.9"/>
    <ellipse cx="40" cy="72" rx="26" ry="16" fill="#fff" opacity="0.9"/>
  </svg>`;
  messageDiv.innerHTML = `
    ${!isUser ? `<div class="faq-message-avatar faq-message-avatar-ella">${ASSISTANT_SVG_SMALL}</div>` : ''}
    <div class="faq-message-content">
      <div class="faq-message-bubble">${text}</div>
    </div>
    ${isUser ? `<div class="faq-message-avatar faq-message-avatar-user">${userAvatarSvg}</div>` : ''}
  `;
  
  messagesContainer.appendChild(messageDiv);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function addBotMessage(text, emotion, audioBase64, sources, videoJobId, plainAnswer, originalQuestion = '') {
  const messagesContainer = document.getElementById('faq-messages');
  const emptyState = document.getElementById('faq-empty-state');
  if (emptyState) emptyState.style.display = 'none';
  setAssistantStatus(plainAnswer ? 'speaking' : 'idle');
  const messageDiv = document.createElement('div');
  messageDiv.className = 'faq-message faq-bot-message';

  const emotionEmoji = {
    confident:  '💪',
    empathy:    '😟',
    excited:    '🎉',
    neutral:    '😊',
    apologetic: '😅',
  }[emotion] || '💬';

  const sourcesHtml = (sources && sources.length > 0) ? `
    <div class="faq-sources">
      <div class="faq-sources-title">📎 Источники:</div>
      ${sources.map(url => `
        <a class="faq-source-link" href="${url}" target="_blank" title="${url}">
          🔗 ${new URL(url).pathname || url}
        </a>
      `).join('')}
    </div>
  ` : '';

  messageDiv.innerHTML = `
    <div class="faq-message-avatar faq-message-avatar-ella">${ASSISTANT_SVG_SMALL}</div>
    <div class="faq-message-content">
      <div class="faq-message-bubble">${text}</div>
      ${sourcesHtml}
    </div>
  `;

  messagesContainer.appendChild(messageDiv);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;

  if (originalQuestion) {
    const moreBtn = document.createElement('button');
    moreBtn.className = 'faq-more-btn';
    moreBtn.textContent = 'Ответить подробнее';
    messageDiv.querySelector('.faq-message-content').appendChild(moreBtn);

    moreBtn.addEventListener('click', async () => {
      moreBtn.disabled = true;
      moreBtn.textContent = 'Загружаю...';
      try {
        const result = await new Promise((resolve) => {
          chrome.runtime.sendMessage({
            action: 'fetchBackend',
            url: 'http://localhost:8000/api/ask',
            method: 'POST',
            body: {
              question: originalQuestion,
              website_url: `${window.location.protocol}//${window.location.host}`,
              current_page_url: window.location.href,
              detailed: true,
            },
          }, resolve);
        });

        if (result && result.ok) {
          moreBtn.remove();
          addBotMessage(
            result.data.answer,
            result.data.emotion,
            null,
            result.data.sources || [],
            null,
            '',
            ''
          );
        } else {
          moreBtn.disabled = false;
          moreBtn.textContent = 'Ответить подробнее';
        }
      } catch (_) {
        moreBtn.disabled = false;
        moreBtn.textContent = 'Ответить подробнее';
      }
    });
  }

  if (audioBase64) {
    const audioId = `faq-audio-${Date.now()}`;
    const audioEl = document.createElement('audio');
    audioEl.id = audioId;
    audioEl.src = `data:audio/mp3;base64,${audioBase64}`;
    audioEl.style.display = 'none';
    messageDiv.appendChild(audioEl);

    const btn = document.createElement('button');
    btn.className = 'faq-audio-btn';
    btn.innerHTML = '<span class="faq-audio-icon">🔊</span><span class="faq-audio-label">Воспроизвести ответ</span>';
    messageDiv.querySelector('.faq-message-content').appendChild(btn);

    btn.addEventListener('click', () => {
      const icon = btn.querySelector('.faq-audio-icon');
      const label = btn.querySelector('.faq-audio-label');
      if (audioEl.paused) {
        audioEl.play();
        icon.textContent = '⏸';
        label.textContent = 'Остановить';
        btn.classList.add('faq-audio-playing');
      } else {
        audioEl.pause();
        audioEl.currentTime = 0;
        icon.textContent = '🔊';
        label.textContent = 'Воспроизвести ответ';
        btn.classList.remove('faq-audio-playing');
      }
    });
    audioEl.addEventListener('ended', () => {
      btn.querySelector('.faq-audio-icon').textContent = '🔊';
      btn.querySelector('.faq-audio-label').textContent = 'Воспроизвести ответ';
      btn.classList.remove('faq-audio-playing');
    });

    audioEl.play().catch(() => {});
  }

  if (videoJobId) {
    pollForDidVideo(videoJobId);
  }
}

async function pollForDidVideo(jobId) {
  setAssistantStatus('speaking');

  const MAX_POLLS = 40; // 40 × 3s = 2 min max
  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise(r => setTimeout(r, 1000));
    try {
      const res = await fetch(`http://localhost:8000/api/video-status/${jobId}`);
      const data = await res.json();

      if (data.status === 'ready' && data.video_url) {
        setAssistantStatus('idle');
        return;
      }
      if (data.status === 'error') break;
    } catch (_) {}
  }
  setAssistantStatus('idle');
}

async function pollVideoJob(jobId, slotId, audioBase64) {
  const MAX_POLLS = 90; // max ~3 min
  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise(r => setTimeout(r, 1000));
    try {
      const res = await fetch(`http://localhost:8000/api/video-status/${jobId}`);
      const data = await res.json();

      if (data.status === 'ready' && data.video_url) {
        const slot = document.getElementById(slotId);
        if (!slot) return;

        // Use backend proxy so browser can start playing while downloading
        const proxyUrl = `http://localhost:8000/api/video-proxy/${jobId}`;
        const circleId = `circle-pv-${jobId}`;
        slot.outerHTML = `
          <div class="faq-avatar-video-wrap">
            <div class="faq-video-circle" id="${circleId}">
              <video class="faq-avatar-video"
                src="${proxyUrl}" autoplay playsinline controls preload="auto"
                crossorigin="anonymous"
                title="Видео-аватар"></video>
            </div>
            <div class="faq-avatar-badge">видео-ответ</div>
          </div>`;
        const pvCircle = document.getElementById(circleId);
        const pvVideo = pvCircle && pvCircle.querySelector('.faq-avatar-video');
        if (pvVideo) pvVideo.addEventListener('playing', () => startChromaKey(pvVideo), { once: true });
        return;
      }
      if (data.status === 'error') {
        const slot = document.getElementById(slotId);
        if (slot) slot.remove();
        return;
      }
    } catch (_) { /* server not reachable yet */ }
  }
  const slot = document.getElementById(slotId);
  if (slot) slot.remove();
}

// Play video parts one after another in the same circle slot.
// Parts are already generating in parallel on the backend, so part 2
// is often ready by the time part 1 finishes playing.
// Per-chain state: slotId → { parts, readyUrls: {jobId → proxyUrl|'error'} }
const _videoChains = {};

function startVideoChain(parts, slotId) {
  const state = { parts, slotId, readyUrls: {}, currentIndex: 0 };
  _videoChains[slotId] = state;
  // Poll all parts simultaneously
  parts.forEach(jobId => _pollPartStatus(jobId, state));
  // Show circle as soon as part 0 is ready
  _waitAndShowPart(0, state);
}

async function _pollPartStatus(jobId, state) {
  const MAX_POLLS = 120;
  // First check after 300ms (part 0 may already be cached or was early-fired),
  // then every 1s to avoid hammering the backend.
  let delay = 300;
  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise(r => setTimeout(r, delay));
    delay = 1000;
    try {
      const res = await fetch(`http://localhost:8000/api/video-status/${jobId}`);
      const d = await res.json();
      if (d.status === 'ready' && d.video_url) {
        state.readyUrls[jobId] = `http://localhost:8000/api/video-proxy/${jobId}`;
        return;
      }
      if (d.status === 'error') { state.readyUrls[jobId] = 'error'; return; }
    } catch (_) {}
  }
  state.readyUrls[jobId] = 'error';
}

async function _waitAndShowPart(index, state) {
  const { parts, slotId } = state;
  if (index >= parts.length) return;
  const jobId = parts[index];

  // Wait until this part's status is known.
  // Important: do NOT skip pending parts even if later parts are ready,
  // otherwise some answer fragments may be lost from playback.
  while (state.readyUrls[jobId] === undefined) {
    await new Promise(r => setTimeout(r, 200));
  }

  if (state.readyUrls[jobId] === 'error') {
    _waitAndShowPart(index + 1, state);
    return;
  }

  const proxyUrl = state.readyUrls[jobId];
  const slot = document.getElementById(slotId);
  if (!slot) return;

  const isFirst = slot.classList.contains('faq-avatar-video-slot');
  const isLast  = index >= parts.length - 1;

  if (isFirst) {
    // Create the circle for the first time
    slot.outerHTML = `
      <div id="${slotId}" class="faq-avatar-video-wrap">
        <div class="faq-avatar-video-row">
          <div class="faq-video-circle" id="circle-${slotId}">
            <video class="faq-avatar-video faq-active-video"
              src="${proxyUrl}" autoplay playsinline preload="auto" crossorigin="anonymous"></video>
            <div class="faq-video-circle-overlay" id="overlay-${slotId}">
              <svg class="faq-icon-pause" viewBox="0 0 24 24" fill="white" width="36" height="36"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
              <svg class="faq-icon-play"  viewBox="0 0 24 24" fill="white" width="36" height="36"><path d="M8 5v14l11-7z"/></svg>
            </div>
          </div>
          <button class="faq-replay-btn" id="replay-${slotId}" title="Воспроизвести с начала">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="15" height="15" stroke-linecap="round" stroke-linejoin="round">
              <path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 .49-4.5"/>
            </svg>
            с начала
          </button>
        </div>
        <div class="faq-avatar-badge">видео-ответ</div>
      </div>`;

    const circle  = document.getElementById(`circle-${slotId}`);
    const overlay = document.getElementById(`overlay-${slotId}`);
    if (circle) {
      const firstVid = circle.querySelector('video.faq-active-video');
      if (firstVid) firstVid.addEventListener('playing', () => startChromaKey(firstVid), { once: true });

      circle.addEventListener('click', () => {
        const v = circle.querySelector('video.faq-active-video');
        if (!v) return;

        const nearEnd = Number.isFinite(v.duration) && (v.currentTime >= Math.max(0, v.duration - 0.02));
        if (v.paused && (v.ended || nearEnd)) {
          overlay.classList.remove('faq-video-paused');
          _waitAndShowPart(0, state);
          return;
        }

        if (v.paused) { v.play(); overlay.classList.remove('faq-video-paused'); }
        else          { v.pause(); overlay.classList.add('faq-video-paused'); }
      });
    }

    const replayBtn = document.getElementById(`replay-${slotId}`);
    if (replayBtn) {
      replayBtn.addEventListener('click', () => {
        const circle = document.getElementById(`circle-${slotId}`);
        const v = circle && circle.querySelector('video.faq-active-video');
        if (v) v.pause();
        const overlay = document.getElementById(`overlay-${slotId}`);
        if (overlay) overlay.classList.remove('faq-video-paused');
        _waitAndShowPart(0, state);
      });
    }
  } else {
    // Swap in the prebuffered video without a white-screen flash.
    // Strategy: start the new canvas rendering first; only hide the old canvas
    // once the new canvas has painted its first real frame.
    const circle = document.getElementById(`circle-${slotId}`);
    if (!circle) return;
    const prebuf = document.getElementById(`prebuf-${jobId}`);
    const oldVid = circle.querySelector('video.faq-active-video');
    if (prebuf) {
      const oldCanvas = oldVid && oldVid._chromaCanvas;
      // Mark old vid as inactive but keep its canvas visible (shows last frame)
      if (oldVid) oldVid.classList.remove('faq-active-video');
      // Show new video (still invisible via visibility:hidden set by startChromaKey)
      prebuf.classList.add('faq-active-video');
      prebuf.removeAttribute('id');
      prebuf.style.display = '';
      prebuf.play().catch(() => {});
      // Start new canvas; remove old canvas only after first frame is painted
      startChromaKey(prebuf, () => {
        if (oldCanvas) oldCanvas.remove();
        if (oldVid) oldVid.style.display = 'none';
      });
    } else {
      // Fallback (prebuffer missed / replay): keep old canvas showing last frame
      // until new canvas renders its first frame, then remove old one.
      if (oldVid) {
        const oldCanvas = oldVid._chromaCanvas || null;
        oldVid._chromaCanvas = null;
        oldVid._chromaKeyActive = false;
        oldVid.src = proxyUrl;
        oldVid.load();
        oldVid.addEventListener('playing', () => {
          startChromaKey(oldVid, () => { if (oldCanvas) oldCanvas.remove(); });
        }, { once: true });
        oldVid.play().catch(() => {});
      }
    }
  }

  state.currentIndex = index;

  // Prebuffer next part while current plays
  if (!isLast) _prebufferWhenReady(parts[index + 1], state);

  // When current video ends advance to next part.
  // Some browsers/proxy streams occasionally miss the `ended` event,
  // so we also add a near-end fallback via `timeupdate`.
  if (!isLast) {
    const circle = document.getElementById(`circle-${slotId}`);
    const vid = circle ? circle.querySelector('video.faq-active-video') : null;
    if (vid) _attachNextPartHandlers(vid, index + 1, state);
  }
}

function _attachNextPartHandlers(videoEl, nextIndex, state) {
  let advanced = false;
  const advance = () => {
    if (advanced) return;
    advanced = true;
    _waitAndShowPart(nextIndex, state);
  };

  videoEl.addEventListener('ended', advance, { once: true });
  videoEl.addEventListener('error', advance, { once: true });
  videoEl.addEventListener('timeupdate', () => {
    if (!Number.isFinite(videoEl.duration) || videoEl.duration <= 0) return;
    if (videoEl.currentTime >= Math.max(0, videoEl.duration - 0.02)) advance();
  });
}

async function _prebufferWhenReady(jobId, state) {
  while (state.readyUrls[jobId] === undefined) {
    await new Promise(r => setTimeout(r, 200));
  }
  if (state.readyUrls[jobId] === 'error') return;

  const circle = document.getElementById(`circle-${state.slotId}`);
  if (!circle || document.getElementById(`prebuf-${jobId}`)) return;

  const proxyUrl = state.readyUrls[jobId];
  const vid = document.createElement('video');
  vid.id = `prebuf-${jobId}`;
  vid.className = 'faq-avatar-video';
  vid.src = proxyUrl;
  vid.preload = 'auto';
  vid.playsInline = true;
  vid.crossOrigin = 'anonymous';
  vid.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:none;';
  circle.insertBefore(vid, circle.querySelector('.faq-video-circle-overlay'));
  vid.load();
}

function addTypingIndicator() {
  const messagesContainer = document.getElementById('faq-messages');
  const emptyState = document.getElementById('faq-empty-state');
  if (emptyState) emptyState.style.display = 'none';
  const typingDiv = document.createElement('div');
  typingDiv.id = 'faq-typing-indicator';
  typingDiv.className = 'faq-message faq-bot-message';
  typingDiv.innerHTML = `
    <div class="faq-message-avatar faq-message-avatar-ella">${ASSISTANT_SVG_SMALL}</div>
    <div class="faq-message-content">
      <div class="faq-typing">
        <span></span><span></span><span></span>
      </div>
    </div>
  `;
  messagesContainer.appendChild(typingDiv);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function removeTypingIndicator() {
  const indicator = document.getElementById('faq-typing-indicator');
  if (indicator) indicator.remove();
}

function extractPageContent() {
  const title = document.title;
  
  const mainSelectors = [
    'main',
    'article',
    '[role="main"]',
    '.content',
    '#content',
    '.main-content'
  ];
  
  let contentElement = null;
  for (const selector of mainSelectors) {
    contentElement = document.querySelector(selector);
    if (contentElement) break;
  }
  
  if (!contentElement) {
    contentElement = document.body;
  }
  
  const clone = contentElement.cloneNode(true);
  const excludeSelectors = ['script', 'style', 'nav', 'header', 'footer', '.menu', '.navigation'];
  excludeSelectors.forEach(selector => {
    clone.querySelectorAll(selector).forEach(el => el.remove());
  });
  
  const content = clone.innerText
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 10000); // Limit to 10k chars
  
  return {
    title: title,
    content: content,
    url: window.location.href
  };
}
