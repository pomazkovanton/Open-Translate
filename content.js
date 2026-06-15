// Inject inline translation styles
const style = document.createElement('style');
style.id = 'gemini-translation-styles';
style.textContent = `
  .gemini-translation-inline {
    display: inline !important;
    margin-left: 6px !important;
    white-space: normal !important;
    opacity: 1 !important;
    visibility: visible !important;
    word-break: break-word !important;
  }
  #gemini-translation-indicator {
    position: fixed !important;
    bottom: 20px !important;
    right: 20px !important;
    background: rgba(15, 23, 42, 0.95) !important;
    border: 1px solid rgba(129, 140, 248, 0.45) !important;
    border-radius: 30px !important;
    padding: 8px 16px !important;
    color: #e2e8f0 !important;
    font-size: 12px !important;
    font-weight: 600 !important;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
    z-index: 2147483647 !important;
    backdrop-filter: blur(8px) !important;
    box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3) !important;
    display: flex !important;
    align-items: center !important;
    gap: 8px !important;
    transition: opacity 0.3s ease, transform 0.3s ease !important;
    pointer-events: none !important;
    opacity: 0 !important;
    transform: translateY(10px) !important;
  }
  #gemini-translation-indicator.visible {
    opacity: 1 !important;
    transform: translateY(0) !important;
  }
  .gemini-loader {
    width: 12px;
    height: 12px;
    border: 2px solid rgba(255, 255, 255, 0.2);
    border-top: 2px solid #818cf8;
    border-radius: 50%;
    animation: gemini-spin 0.8s linear infinite;
  }
  .gemini-indicator-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }
  .gemini-indicator-dot.success {
    background-color: #10b981;
    box-shadow: 0 0 6px #10b981;
  }
  .gemini-indicator-dot.error {
    background-color: #ef4444;
    box-shadow: 0 0 6px #ef4444;
  }
  @keyframes gemini-spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
`;
document.head.appendChild(style);

let isTranslated = false;
let translatedNodes = [];
let addedTranslationSpans = [];
const originalTexts = new WeakMap();

let currentInlineColor = '#6b7280';
let currentInlineUnderline = 'none';
let currentProvider = 'google';
let currentModel = 'gemini-2.5-flash';

// Show page action status indicator in the bottom-left corner
function updatePageIndicator(text, type = 'loading') {
  let indicator = document.getElementById('gemini-translation-indicator');
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.id = 'gemini-translation-indicator';
    document.body.appendChild(indicator);
  }

  indicator.innerHTML = '';

  if (type === 'loading') {
    const loader = document.createElement('div');
    loader.className = 'gemini-loader';
    indicator.appendChild(loader);
  } else if (type === 'success' || type === 'error') {
    const dot = document.createElement('div');
    dot.className = `gemini-indicator-dot ${type}`;
    indicator.appendChild(dot);
  }

  const textNode = document.createElement('span');
  textNode.textContent = text;
  indicator.appendChild(textNode);

  // Trigger animation
  requestAnimationFrame(() => {
    indicator.classList.add('visible');
  });

  if (type === 'success') {
    setTimeout(() => {
      indicator.classList.remove('visible');
    }, 2500);
  } else if (type === 'error') {
    setTimeout(() => {
      indicator.classList.remove('visible');
    }, 4500);
  }
}

let isTranslating = false;

// Listen for messages from popup or background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'translate') {
    if (isTranslating) {
      sendResponse({ success: false, error: 'Перевод уже выполняется. Пожалуйста, подождите.' });
      return false;
    }

    const { apiKey, targetLang, mode, inlineColor, inlineUnderline, provider, model } = request;
    
    currentInlineColor = inlineColor || '#6b7280';
    currentInlineUnderline = inlineUnderline || 'none';
    currentProvider = provider || 'google';
    currentModel = model || 'gemini-2.5-flash';

    if (isTranslated) {
      restore();
    }

    isTranslating = true;
    const providerNames = {
      google: 'Google',
      openrouter: 'OpenRouter',
      groq: 'Groq',
      siliconflow: 'SiliconFlow',
      sambanova: 'SambaNova',
      ollama: 'Ollama'
    };
    const providerLabel = providerNames[provider] || provider;
    updatePageIndicator(`Перевод: ${model} (${providerLabel})...`, 'loading');

    translatePage(apiKey, targetLang, mode)
      .then((count) => {
        isTranslated = true;
        isTranslating = false;
        updatePageIndicator(`Переведено фрагментов: ${count}`, 'success');
        sendResponse({ success: true, count });
      })
      .catch((err) => {
        isTranslating = false;
        console.error('Translation error:', err);
        updatePageIndicator(`Ошибка перевода: ${err.message}`, 'error');
        sendResponse({ success: false, error: err.message });
      });

    return true; // Keep message channel open for asynchronous sendResponse
  } else if (request.action === 'restore') {
    if (isTranslating) {
      sendResponse({ success: false, error: 'Пожалуйста, подождите окончания перевода.' });
      return false;
    }
    if (isTranslated) {
      restore();
      updatePageIndicator('Перевод сброшен', 'success');
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, error: 'Страница еще не переведена' });
    }
  }
});

// Main translate function dispatcher
async function translatePage(apiKey, targetLang, mode) {
  return translatePageInline(apiKey, targetLang, mode);
}

// Inline mode translation (Replace or Next-to)
async function translatePageInline(apiKey, targetLang, mode) {
  if (mode === 'replace') {
    const textNodes = collectTextNodes(document.body);
    if (textNodes.length === 0) {
      return 0;
    }
    const batches = partitionNodes(textNodes);
    return await processTextNodeBatches(batches, apiKey, targetLang);
  } else {
    const blocks = collectSemanticBlocks(document.body);
    if (blocks.length === 0) {
      return 0;
    }
    const batches = partitionBlocks(blocks);
    return await processBlockBatches(batches, apiKey, targetLang);
  }
}

const BLOCK_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'td', 'th', 'blockquote', 'figcaption', 'dd', 'dt']);
const EXCLUDED_TAGS = new Set(['script', 'style', 'noscript', 'iframe', 'canvas', 'svg', 'code', 'pre', 'textarea', 'input', 'kbd', 'option', 'select']);

function hasNonTrivialText(node) {
  const text = node.innerText || node.textContent || '';
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/^[0-9\s\p{P}]+$/u.test(trimmed)) return false;
  return true;
}

function hasBlockTagDescendant(element) {
  return element.querySelector('p, h1, h2, h3, h4, h5, h6, li, td, th, blockquote, figcaption, dd, dt') !== null;
}

// Collect semantic blocks for paragraph-level inline translation
function collectSemanticBlocks(root) {
  const blocks = [];
  
  function traverse(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    
    const tagName = node.tagName.toLowerCase();
    if (EXCLUDED_TAGS.has(tagName)) return;
    if (node.classList && node.classList.contains('gemini-translation-inline')) return;
    if (node.closest && node.closest('[contenteditable="true"]')) return;
    
    if (BLOCK_TAGS.has(tagName)) {
      if (hasNonTrivialText(node)) {
        blocks.push(node);
      }
      return;
    }
    
    const hasBlockDescendants = hasBlockTagDescendant(node);
    if (!hasBlockDescendants) {
      if (hasNonTrivialText(node)) {
        blocks.push(node);
        return;
      }
    }
    
    for (let child = node.firstChild; child; child = child.nextSibling) {
      traverse(child);
    }
  }
  
  traverse(root);
  return blocks;
}

// Collect translatable text nodes from DOM (Replace Mode)
function collectTextNodes(root) {
  const textNodes = [];
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: function(node) {
        const parent = node.parentNode;
        if (!parent) return NodeFilter.FILTER_REJECT;
        
        const tagName = parent.tagName ? parent.tagName.toLowerCase() : '';
        const excludedTags = [
          'script', 'style', 'noscript', 'iframe', 'canvas', 'svg', 
          'code', 'pre', 'textarea', 'input', 'kbd'
        ];
        
        if (excludedTags.includes(tagName)) {
          return NodeFilter.FILTER_REJECT;
        }

        if (parent.classList && parent.classList.contains('gemini-translation-inline')) {
          return NodeFilter.FILTER_REJECT;
        }

        if (parent.closest && parent.closest('[contenteditable="true"]')) {
          return NodeFilter.FILTER_REJECT;
        }

        const text = node.nodeValue.trim();
        if (!text) {
          return NodeFilter.FILTER_REJECT;
        }

        if (/^[0-9\s\p{P}]+$/u.test(text)) {
          return NodeFilter.FILTER_REJECT;
        }

        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  let node;
  while (node = walker.nextNode()) {
    textNodes.push(node);
  }
  return textNodes;
}

// Partition text nodes (Replace Mode)
function partitionNodes(nodes, maxBatchCount = 50, maxCharCount = 5000) {
  const batches = [];
  let currentBatch = [];
  let currentChars = 0;

  for (const node of nodes) {
    const len = node.nodeValue.length;
    if (currentBatch.length >= maxBatchCount || (currentChars + len) > maxCharCount) {
      batches.push(currentBatch);
      currentBatch = [];
      currentChars = 0;
    }
    currentBatch.push(node);
    currentChars += len;
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

// Partition block elements (Insert Mode)
function partitionBlocks(blocks, maxBatchCount = 30, maxCharCount = 5000) {
  const batches = [];
  let currentBatch = [];
  let currentChars = 0;

  for (const el of blocks) {
    const text = el.innerText || el.textContent || '';
    const len = text.length;
    if (currentBatch.length >= maxBatchCount || (currentChars + len) > maxCharCount) {
      batches.push(currentBatch);
      currentBatch = [];
      currentChars = 0;
    }
    currentBatch.push(el);
    currentChars += len;
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

// Translate text nodes batches sequentially
async function processTextNodeBatches(batches, apiKey, targetLang) {
  let count = 0;
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const textsToTranslate = batch.map(n => n.nodeValue.trim());

    if (i > 0) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    try {
      const result = await sendTranslateRequest(apiKey, targetLang, textsToTranslate);
      if (result && result.success && Array.isArray(result.translations)) {
        for (let j = 0; j < batch.length; j++) {
          const node = batch[j];
          const translation = result.translations[j];
          
          if (translation && translation.trim() !== '') {
            if (!originalTexts.has(node)) {
              originalTexts.set(node, node.nodeValue);
              translatedNodes.push(node);
            }
            
            applyTranslationReplace(node, translation);
            count++;
          }
        }
      } else if (result && !result.success) {
        throw new Error(result.error || 'Failed to translate batch');
      }
    } catch (err) {
      console.error('Error translating batch:', err);
      throw err;
    }
  }
  return count;
}

// Translate block batches sequentially
async function processBlockBatches(batches, apiKey, targetLang) {
  let count = 0;
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const textsToTranslate = batch.map(el => (el.innerText || el.textContent || '').trim());

    if (i > 0) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    try {
      const result = await sendTranslateRequest(apiKey, targetLang, textsToTranslate);
      if (result && result.success && Array.isArray(result.translations)) {
        for (let j = 0; j < batch.length; j++) {
          const el = batch[j];
          const translation = result.translations[j];
          
          if (translation && translation.trim() !== '') {
            applyTranslationInsert(el, translation);
            count++;
          }
        }
      } else if (result && !result.success) {
        throw new Error(result.error || 'Failed to translate batch');
      }
    } catch (err) {
      console.error('Error translating batch:', err);
      throw err;
    }
  }
  return count;
}

// Send translation request to background script
function sendTranslateRequest(apiKey, targetLang, texts) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({
      action: 'translate_batch',
      apiKey,
      targetLang,
      texts,
      provider: currentProvider,
      model: currentModel
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.error("sendTranslateRequest error:", chrome.runtime.lastError.message);
        resolve({ success: false, error: `Ошибка связи с фоновым скриптом: ${chrome.runtime.lastError.message}` });
      } else {
        resolve(response || { success: false, error: 'Нет ответа от фонового скрипта' });
      }
    });
  });
}

// Apply translation: replace text node content while preserving whitespace
function applyTranslationReplace(node, translatedText) {
  const original = node.nodeValue;
  const leadingWhitespace = original.match(/^\s*/)[0];
  const trailingWhitespace = original.match(/\s*$/)[0];
  node.nodeValue = leadingWhitespace + translatedText + trailingWhitespace;
}

// Apply translation: append translated text in a span at the end of the block element
function applyTranslationInsert(element, translatedText) {
  const span = document.createElement('span');
  span.className = 'gemini-translation-inline';
  span.textContent = ` (${translatedText})`;
  
  // Set properties with !important to prevent page style overrides
  span.style.setProperty('color', currentInlineColor, 'important');
  if (currentInlineUnderline !== 'none') {
    span.style.setProperty('text-decoration', `underline ${currentInlineUnderline}`, 'important');
  } else {
    span.style.setProperty('text-decoration', 'none', 'important');
  }

  // Append span to the end of the element
  element.appendChild(span);
  addedTranslationSpans.push(span);
}

// Restore original page content
function restore() {
  // Restore replaced text values
  for (const node of translatedNodes) {
    if (originalTexts.has(node)) {
      node.nodeValue = originalTexts.get(node);
    }
  }
  translatedNodes = [];

  // Remove inserted translation spans
  for (const el of addedTranslationSpans) {
    if (el.parentNode) {
      el.parentNode.removeChild(el);
    }
  }
  addedTranslationSpans = [];

  // Hide page indicator if it's open
  const indicator = document.getElementById('gemini-translation-indicator');
  if (indicator) {
    indicator.classList.remove('visible');
  }

  isTranslated = false;
}
