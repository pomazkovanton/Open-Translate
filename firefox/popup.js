document.addEventListener('DOMContentLoaded', async () => {
  const apiKeyInput = document.getElementById('api-key');
  const toggleKeyBtn = document.getElementById('toggle-key-visibility');
  const providerSelect = document.getElementById('provider-select');
  const modelSelect = document.getElementById('model-select');
  const customModelGroup = document.getElementById('custom-model-group');
  const customModelInput = document.getElementById('custom-model-input');
  const targetLangSelect = document.getElementById('target-lang');
  const translateBtn = document.getElementById('translate-btn');
  const restoreBtn = document.getElementById('restore-btn');
  const statusBar = document.getElementById('status-bar');
  const statusText = document.getElementById('status-text');
  
  const styleSettingsGroup = document.getElementById('style-settings-group');
  const inlineColorSelect = document.getElementById('inline-color');
  const inlineUnderlineSelect = document.getElementById('inline-underline');

  const modelsMap = {
    google: [
      { value: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
      { value: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash' },
      { value: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro' },
      { value: 'custom', name: 'Свой вариант...' }
    ],
    openrouter: [],
    groq: [],
    siliconflow: [],
    sambanova: [],
    ollama: [] // Will be loaded dynamically
  };

  const CACHE_KEY_OR_MODELS = 'openrouter_free_models';
  const CACHE_KEY_OR_TIME = 'openrouter_models_timestamp';
  
  const CACHE_KEY_GROQ_MODELS = 'groq_models';
  const CACHE_KEY_GROQ_TIME = 'groq_models_timestamp';
  const CACHE_KEY_GROQ_KEY_USED = 'groq_models_key_used';

  const CACHE_KEY_SF_MODELS = 'siliconflow_models';
  const CACHE_KEY_SF_TIME = 'siliconflow_models_timestamp';
  const CACHE_KEY_SF_KEY_USED = 'siliconflow_models_key_used';

  const CACHE_KEY_SN_MODELS = 'sambanova_models';
  const CACHE_KEY_SN_TIME = 'sambanova_models_timestamp';
  const CACHE_KEY_SN_KEY_USED = 'sambanova_models_key_used';
  
  const CACHE_DURATION_MS = 2 * 60 * 60 * 1000; // 2 hours

  // Asynchronously fetch or get cached OpenRouter free models
  const getOpenRouterModels = async () => {
    const cache = await chrome.storage.local.get([CACHE_KEY_OR_MODELS, CACHE_KEY_OR_TIME]);
    const now = Date.now();
    
    let cachedModels = cache[CACHE_KEY_OR_MODELS];
    const cacheTime = cache[CACHE_KEY_OR_TIME] || 0;
    
    if (cachedModels && (now - cacheTime < CACHE_DURATION_MS)) {
      return cachedModels;
    }
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000); // 6s timeout
      
      const response = await fetch('https://openrouter.ai/api/v1/models', { signal: controller.signal });
      clearTimeout(timeoutId);
      
      if (!response.ok) throw new Error('Network response was not ok');
      const json = await response.json();
      
      if (!json || !Array.isArray(json.data)) throw new Error('Invalid JSON data format');
      
      const freeModels = json.data
        .filter(m => {
          const pricing = m.pricing || {};
          return parseFloat(pricing.prompt || 1) === 0.0 && parseFloat(pricing.completion || 1) === 0.0;
        })
        .map(m => ({
          value: m.id,
          name: m.name.replace(' (free)', '').replace(' Free', '')
        }));
      
      const mainRouterIndex = freeModels.findIndex(m => m.value === 'openrouter/free');
      if (mainRouterIndex > -1) {
        const [mainRouter] = freeModels.splice(mainRouterIndex, 1);
        freeModels.unshift({ value: mainRouter.value, name: 'Авто-выбор модели' });
      } else {
        freeModels.unshift({ value: 'openrouter/free', name: 'Авто-выбор модели' });
      }

      freeModels.push({ value: 'custom', name: 'Свой вариант...' });
      
      await chrome.storage.local.set({
        [CACHE_KEY_OR_MODELS]: freeModels,
        [CACHE_KEY_OR_TIME]: now
      });
      
      return freeModels;
    } catch (err) {
      console.warn('Failed to fetch OpenRouter free models, using fallback/cache:', err);
      if (cachedModels) return cachedModels;
      
      return [
        { value: 'openrouter/free', name: 'Авто-выбор модели' },
        { value: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3 70B' },
        { value: 'meta-llama/llama-3.2-3b-instruct:free', name: 'Llama 3.2 3B' },
        { value: 'nousresearch/hermes-3-llama-3.1-405b:free', name: 'Hermes 3 405B' },
        { value: 'qwen/qwen3-coder:free', name: 'Qwen 3 Coder' },
        { value: 'custom', name: 'Свой вариант...' }
      ];
    }
  };

  // Asynchronously fetch or get cached Groq models using the API key
  const getGroqModels = async (apiKey) => {
    if (!apiKey) {
      return [
        { value: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B Instant' },
        { value: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B' },
        { value: 'gemma2-9b-it', name: 'Gemma 2 9B' },
        { value: 'custom', name: 'Свой вариант...' }
      ];
    }

    const cache = await chrome.storage.local.get([CACHE_KEY_GROQ_MODELS, CACHE_KEY_GROQ_TIME, CACHE_KEY_GROQ_KEY_USED]);
    const now = Date.now();
    
    let cachedModels = cache[CACHE_KEY_GROQ_MODELS];
    const cacheTime = cache[CACHE_KEY_GROQ_TIME] || 0;
    const cacheKeyUsed = cache[CACHE_KEY_GROQ_KEY_USED] || '';
    
    if (cachedModels && (now - cacheTime < CACHE_DURATION_MS) && cacheKeyUsed === apiKey) {
      return cachedModels;
    }
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000); // 6s timeout
      
      const response = await fetch('https://api.groq.com/openai/v1/models', {
        headers: {
          'Authorization': `Bearer ${apiKey}`
        },
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      
      if (!response.ok) throw new Error(`Network response was not ok (status: ${response.status})`);
      const json = await response.json();
      
      if (!json || !Array.isArray(json.data)) throw new Error('Invalid JSON data format');
      
      let groqModels = json.data
        .filter(m => {
          const id = m.id.toLowerCase();
          return !id.includes('whisper') && !id.includes('guard') && !id.includes('embed') && !id.includes('vision');
        })
        .map(m => {
          let displayName = m.id;
          if (m.id.startsWith('llama-3.1-8b-instant')) displayName = 'Llama 3.1 8B Instant';
          else if (m.id.startsWith('llama-3.3-70b-versatile')) displayName = 'Llama 3.3 70B Versatile';
          else if (m.id.startsWith('gemma2-9b-it')) displayName = 'Gemma 2 9B IT';
          else if (m.id.startsWith('deepseek-r1-distill-llama-70b')) displayName = 'DeepSeek R1 Distill Llama 70B';
          return {
            value: m.id,
            name: displayName
          };
        });

      groqModels.sort((a, b) => {
        const aVal = a.value.toLowerCase();
        const bVal = b.value.toLowerCase();
        if (aVal.includes('llama-3.1-8b-instant')) return -1;
        if (bVal.includes('llama-3.1-8b-instant')) return 1;
        if (aVal.includes('llama-3.3-70b')) return -1;
        if (bVal.includes('llama-3.3-70b')) return 1;
        return a.name.localeCompare(b.name);
      });
      
      groqModels.push({ value: 'custom', name: 'Свой вариант...' });
      
      await chrome.storage.local.set({
        [CACHE_KEY_GROQ_MODELS]: groqModels,
        [CACHE_KEY_GROQ_TIME]: now,
        [CACHE_KEY_GROQ_KEY_USED]: apiKey
      });
      
      return groqModels;
    } catch (err) {
      console.warn('Failed to fetch Groq models, using fallback/cache:', err);
      if (cachedModels) return cachedModels;
      
      return [
        { value: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B Instant' },
        { value: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B' },
        { value: 'gemma2-9b-it', name: 'Gemma 2 9B' },
        { value: 'custom', name: 'Свой вариант...' }
      ];
    }
  };

  // Asynchronously fetch or get cached SiliconFlow models using the API key
  const getSiliconFlowModels = async (apiKey) => {
    if (!apiKey) {
      return [
        { value: 'Qwen/Qwen2.5-7B-Instruct', name: 'Qwen 2.5 7B' },
        { value: 'meta-llama/Meta-Llama-3.1-8B-Instruct', name: 'Llama 3.1 8B' },
        { value: 'deepseek-ai/DeepSeek-V2.5', name: 'DeepSeek V2.5' },
        { value: 'custom', name: 'Свой вариант...' }
      ];
    }

    const cache = await chrome.storage.local.get([CACHE_KEY_SF_MODELS, CACHE_KEY_SF_TIME, CACHE_KEY_SF_KEY_USED]);
    const now = Date.now();
    
    let cachedModels = cache[CACHE_KEY_SF_MODELS];
    const cacheTime = cache[CACHE_KEY_SF_TIME] || 0;
    const cacheKeyUsed = cache[CACHE_KEY_SF_KEY_USED] || '';
    
    if (cachedModels && (now - cacheTime < CACHE_DURATION_MS) && cacheKeyUsed === apiKey) {
      return cachedModels;
    }
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000); // 6s timeout
      
      const response = await fetch('https://api.siliconflow.cn/v1/models?sub_type=chat', {
        headers: {
          'Authorization': `Bearer ${apiKey}`
        },
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      
      if (!response.ok) throw new Error(`Network response was not ok (status: ${response.status})`);
      const json = await response.json();
      
      if (!json || !Array.isArray(json.data)) throw new Error('Invalid JSON data format');
      
      let sfModels = json.data
        .filter(m => {
          const id = m.id.toLowerCase();
          return !id.includes('embed') && !id.includes('rerank');
        })
        .map(m => {
          let displayName = m.id;
          if (m.id.includes('Qwen2.5-7B-Instruct')) displayName = 'Qwen 2.5 7B';
          else if (m.id.includes('Meta-Llama-3.1-8B-Instruct')) displayName = 'Llama 3.1 8B';
          else if (m.id.includes('DeepSeek-V2.5')) displayName = 'DeepSeek V2.5';
          
          return {
            value: m.id,
            name: displayName
          };
        });

      // Sort: Qwen2.5-7B first, Meta-Llama-3.1-8B second, rest alphabetically
      sfModels.sort((a, b) => {
        const aVal = a.value.toLowerCase();
        const bVal = b.value.toLowerCase();
        if (aVal.includes('qwen2.5-7b-instruct')) return -1;
        if (bVal.includes('qwen2.5-7b-instruct')) return 1;
        if (aVal.includes('meta-llama-3.1-8b')) return -1;
        if (bVal.includes('meta-llama-3.1-8b')) return 1;
        return a.name.localeCompare(b.name);
      });
      
      sfModels.push({ value: 'custom', name: 'Свой вариант...' });
      
      await chrome.storage.local.set({
        [CACHE_KEY_SF_MODELS]: sfModels,
        [CACHE_KEY_SF_TIME]: now,
        [CACHE_KEY_SF_KEY_USED]: apiKey
      });
      
      return sfModels;
    } catch (err) {
      console.warn('Failed to fetch SiliconFlow models, using fallback/cache:', err);
      if (cachedModels) return cachedModels;
      
      return [
        { value: 'Qwen/Qwen2.5-7B-Instruct', name: 'Qwen 2.5 7B' },
        { value: 'meta-llama/Meta-Llama-3.1-8B-Instruct', name: 'Llama 3.1 8B' },
        { value: 'deepseek-ai/DeepSeek-V2.5', name: 'DeepSeek V2.5' },
        { value: 'custom', name: 'Свой вариант...' }
      ];
    }
  };

  // Asynchronously fetch or get cached SambaNova models using the API key
  const getSambaNovaModels = async (apiKey) => {
    if (!apiKey) {
      return [
        { value: 'Meta-Llama-3.1-8B-Instruct', name: 'Llama 3.1 8B Instruct (Быстрая)' },
        { value: 'Meta-Llama-3.1-70B-Instruct', name: 'Llama 3.1 70B Instruct (Мощная)' },
        { value: 'Meta-Llama-3.1-405B-Instruct', name: 'Llama 3.1 405B Instruct (Сверхмощная)' },
        { value: 'custom', name: 'Свой вариант...' }
      ];
    }

    const cache = await chrome.storage.local.get([CACHE_KEY_SN_MODELS, CACHE_KEY_SN_TIME, CACHE_KEY_SN_KEY_USED]);
    const now = Date.now();
    
    let cachedModels = cache[CACHE_KEY_SN_MODELS];
    const cacheTime = cache[CACHE_KEY_SN_TIME] || 0;
    const cacheKeyUsed = cache[CACHE_KEY_SN_KEY_USED] || '';
    
    if (cachedModels && (now - cacheTime < CACHE_DURATION_MS) && cacheKeyUsed === apiKey) {
      return cachedModels;
    }
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000); // 6s timeout
      
      const response = await fetch('https://api.sambanova.ai/v1/models', {
        headers: {
          'Authorization': `Bearer ${apiKey}`
        },
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      
      if (!response.ok) throw new Error(`Network response was not ok (status: ${response.status})`);
      const json = await response.json();
      
      if (!json || !Array.isArray(json.data)) throw new Error('Invalid JSON data format');
      
      let snModels = json.data
        .filter(m => {
          const id = m.id.toLowerCase();
          return !id.includes('embed');
        })
        .map(m => {
          let displayName = m.id;
          if (m.id.includes('8B-Instruct')) displayName = m.id.replace('-Instruct', '') + ' (Быстрая)';
          else if (m.id.includes('70B-Instruct')) displayName = m.id.replace('-Instruct', '') + ' (Мощная)';
          else if (m.id.includes('405B-Instruct')) displayName = m.id.replace('-Instruct', '') + ' (Сверхмощная)';
          
          return {
            value: m.id,
            name: displayName
          };
        });

      // Sort: 70B first, 8B second, 405B third, rest alphabetically
      snModels.sort((a, b) => {
        const aVal = a.value.toLowerCase();
        const bVal = b.value.toLowerCase();
        if (aVal.includes('70b-instruct')) return -1;
        if (bVal.includes('70b-instruct')) return 1;
        if (aVal.includes('8b-instruct')) return -1;
        if (bVal.includes('8b-instruct')) return 1;
        return a.name.localeCompare(b.name);
      });
      
      snModels.push({ value: 'custom', name: 'Свой вариант...' });
      
      await chrome.storage.local.set({
        [CACHE_KEY_SN_MODELS]: snModels,
        [CACHE_KEY_SN_TIME]: now,
        [CACHE_KEY_SN_KEY_USED]: apiKey
      });
      
      return snModels;
    } catch (err) {
      console.warn('Failed to fetch SambaNova models, using fallback/cache:', err);
      if (cachedModels) return cachedModels;
      
      return [
        { value: 'Meta-Llama-3.1-8B-Instruct', name: 'Llama 3.1 8B Instruct (Быстрая)' },
        { value: 'Meta-Llama-3.1-70B-Instruct', name: 'Llama 3.1 70B Instruct (Мощная)' },
        { value: 'Meta-Llama-3.1-405B-Instruct', name: 'Llama 3.1 405B Instruct (Сверхмощная)' },
        { value: 'custom', name: 'Свой вариант...' }
      ];
    }
  };

  // Asynchronously fetch locally installed Ollama models
  const getOllamaModels = async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000); // 2s timeout
      
      const response = await fetch('http://localhost:11434/api/tags', { signal: controller.signal });
      clearTimeout(timeoutId);
      
      if (!response.ok) throw new Error('Ollama local server not responding');
      const json = await response.json();
      
      if (!json || !Array.isArray(json.models)) throw new Error('Invalid tags format');
      
      const list = json.models.map(m => ({
        value: m.name,
        name: m.name
      }));
      
      list.push({ value: 'custom', name: 'Свой вариант...' });
      return list;
    } catch (err) {
      console.warn('Ollama server is offline, using fallbacks:', err);
      return [
        { value: 'llama3', name: 'Llama 3 (Локальная)' },
        { value: 'qwen2.5', name: 'Qwen 2.5 (Локальная)' },
        { value: 'gemma2', name: 'Gemma 2 (Локальная)' },
        { value: 'mistral', name: 'Mistral (Локальная)' },
        { value: 'custom', name: 'Свой вариант...' }
      ];
    }
  };

  const updateModelsList = async (provider, selectedModel = null) => {
    modelSelect.innerHTML = '';
    
    let models = [];
    if (provider === 'openrouter') {
      models = await getOpenRouterModels();
    } else if (provider === 'groq') {
      const apiKey = apiKeyInput.value.trim() || settings.apiKey_groq || '';
      models = await getGroqModels(apiKey);
    } else if (provider === 'siliconflow') {
      const apiKey = apiKeyInput.value.trim() || settings.apiKey_siliconflow || '';
      models = await getSiliconFlowModels(apiKey);
    } else if (provider === 'sambanova') {
      const apiKey = apiKeyInput.value.trim() || settings.apiKey_sambanova || '';
      models = await getSambaNovaModels(apiKey);
    } else if (provider === 'ollama') {
      models = await getOllamaModels();
    } else {
      models = modelsMap[provider] || [];
    }
    
    models.forEach(model => {
      const option = document.createElement('option');
      option.value = model.value;
      option.textContent = model.name;
      if (selectedModel) {
        if (model.value === selectedModel) {
          option.selected = true;
        } else if (provider === 'ollama' && (model.value.startsWith(selectedModel + ':') || model.value === selectedModel)) {
          // Select model if it starts with the base name (e.g. llama3:latest starts with llama3)
          option.selected = true;
        }
      }
      modelSelect.appendChild(option);
    });
  };

  const keyLinksMap = {
    google: 'Получить ключ: <a href="https://aistudio.google.com/" target="_blank">Google AI Studio</a>',
    openrouter: 'Получить ключ: <a href="https://openrouter.ai/keys" target="_blank">OpenRouter API Keys</a>',
    groq: 'Получить ключ: <a href="https://console.groq.com/keys" target="_blank">Groq Console API Keys</a>',
    siliconflow: 'Получить ключ: <a href="https://siliconflow.com" target="_blank">SiliconFlow Dashboard</a>',
    sambanova: 'Получить ключ: <a href="https://cloud.sambanova.ai/" target="_blank">SambaNova Cloud Keys</a>'
  };

  // Helper to load settings from storage
  const settings = await chrome.storage.local.get([
    'apiKey_google', 'apiKey_openrouter', 'apiKey_groq', 'apiKey_siliconflow', 'apiKey_sambanova', 'provider', 'model', 'customModel', 'targetLang', 'mode', 'inlineColor', 'inlineUnderline'
  ]);

  // Helper to toggle API key input styling and value based on provider
  const updateApiKeyInput = (provider) => {
    const apiKeyGroup = apiKeyInput.closest('.input-group');
    const helpSpan = document.getElementById('api-key-help');
    
    if (provider === 'ollama') {
      apiKeyInput.disabled = true;
      apiKeyInput.placeholder = 'Для Ollama ключ не требуется';
      apiKeyInput.value = '';
      apiKeyGroup.style.opacity = '0.4';
      if (helpSpan) {
        helpSpan.innerHTML = 'Для локального запуска Ollama ключ не нужен';
      }
    } else {
      apiKeyInput.disabled = false;
      apiKeyInput.placeholder = 'Введите ключ API...';
      apiKeyInput.value = settings[`apiKey_${provider}`] || '';
      apiKeyGroup.style.opacity = '1';
      if (helpSpan) {
        helpSpan.innerHTML = keyLinksMap[provider] || '';
      }
    }
  };

  // Helper to toggle style settings visibility
  const toggleStyleSettings = (mode) => {
    if (mode === 'insert') {
      styleSettingsGroup.classList.add('visible');
    } else {
      styleSettingsGroup.classList.remove('visible');
    }
  };

  // Setup initial state
  if (settings.provider) {
    providerSelect.value = settings.provider;
  }
  updateApiKeyInput(providerSelect.value);

  const currentProvider = providerSelect.value;
  let defaultModel = 'gemini-2.5-flash';
  if (currentProvider === 'openrouter') defaultModel = 'openrouter/free';
  else if (currentProvider === 'groq') defaultModel = 'llama-3.1-8b-instant';
  else if (currentProvider === 'siliconflow') defaultModel = 'Qwen/Qwen2.5-7B-Instruct';
  else if (currentProvider === 'sambanova') defaultModel = 'Meta-Llama-3.1-8B-Instruct';
  else if (currentProvider === 'ollama') defaultModel = 'llama3';

  const savedModel = settings.model || defaultModel;

  // Load models dropdown list
  await updateModelsList(currentProvider, savedModel);
  
  // Check if savedModel exists in list options
  const options = Array.from(modelSelect.options).map(opt => opt.value);
  let exists = options.includes(savedModel);
  let matchedValue = savedModel;
  
  if (!exists && currentProvider === 'ollama') {
    const match = options.find(opt => opt.startsWith(savedModel + ':') || opt === savedModel);
    if (match) {
      exists = true;
      matchedValue = match;
    }
  }

  if (!exists && savedModel !== 'custom') {
    modelSelect.value = 'custom';
    customModelGroup.style.display = 'flex';
    customModelInput.value = savedModel;
  } else {
    modelSelect.value = matchedValue;
    if (matchedValue === 'custom') {
      customModelGroup.style.display = 'flex';
      customModelInput.value = settings.customModel || '';
    } else {
      customModelGroup.style.display = 'none';
    }
  }

  if (settings.targetLang) {
    targetLangSelect.value = settings.targetLang;
  }
  if (settings.mode) {
    const radio = document.querySelector(`input[name="translation-mode"][value="${settings.mode}"]`);
    if (radio) {
      radio.checked = true;
      toggleStyleSettings(settings.mode);
    }
  } else {
    toggleStyleSettings('replace');
  }
  
  if (settings.inlineColor) {
    inlineColorSelect.value = settings.inlineColor;
  }
  if (settings.inlineUnderline) {
    inlineUnderlineSelect.value = settings.inlineUnderline;
  }

  // Toggle API Key visibility
  toggleKeyBtn.addEventListener('click', () => {
    if (providerSelect.value === 'ollama') return; // ignore click for ollama
    const isPassword = apiKeyInput.type === 'password';
    apiKeyInput.type = isPassword ? 'text' : 'password';
    toggleKeyBtn.style.color = isPassword ? '#f4f4f5' : '#71717a';
  });

  // Save settings on changes
  const saveSettings = () => {
    const provider = providerSelect.value;
    const apiKey = apiKeyInput.value.trim();
    if (provider !== 'ollama') {
      settings[`apiKey_${provider}`] = apiKey;
    }

    let model = modelSelect.value;
    const customModel = customModelInput.value.trim();
    
    if (model === 'custom') {
      customModelGroup.style.display = 'flex';
      model = customModel; // Use custom ID as the model to send
    } else {
      customModelGroup.style.display = 'none';
    }
    
    const targetLang = targetLangSelect.value;
    const mode = document.querySelector('input[name="translation-mode"]:checked').value;
    const inlineColor = inlineColorSelect.value;
    const inlineUnderline = inlineUnderlineSelect.value;
    
    const storageObj = { 
      provider, model, customModel, targetLang, mode, inlineColor, inlineUnderline 
    };
    if (provider !== 'ollama') {
      storageObj[`apiKey_${provider}`] = apiKey;
    }
    chrome.storage.local.set(storageObj);
    toggleStyleSettings(mode);
  };

  apiKeyInput.addEventListener('input', saveSettings);
  customModelInput.addEventListener('input', saveSettings);
  
  // Listen for key change to refetch models dynamically
  apiKeyInput.addEventListener('change', async () => {
    const provider = providerSelect.value;
    if (provider === 'groq' || provider === 'siliconflow' || provider === 'sambanova') {
      const storedKey = settings[`apiKey_${provider}`] || '';
      const currentKey = apiKeyInput.value.trim();
      if (currentKey !== storedKey) {
        settings[`apiKey_${provider}`] = currentKey;
        await updateModelsList(provider, modelSelect.value);
        saveSettings();
      }
    }
  });

  providerSelect.addEventListener('change', async () => {
    updateApiKeyInput(providerSelect.value);
    
    let defaultModel = 'gemini-2.5-flash';
    if (providerSelect.value === 'openrouter') defaultModel = 'openrouter/free';
    else if (providerSelect.value === 'groq') defaultModel = 'llama-3.1-8b-instant';
    else if (providerSelect.value === 'siliconflow') defaultModel = 'Qwen/Qwen2.5-7B-Instruct';
    else if (providerSelect.value === 'sambanova') defaultModel = 'Meta-Llama-3.1-8B-Instruct';
    else if (providerSelect.value === 'ollama') defaultModel = 'llama3';
    
    await updateModelsList(providerSelect.value, defaultModel);
    saveSettings();
  });
  
  modelSelect.addEventListener('change', saveSettings);
  targetLangSelect.addEventListener('change', saveSettings);
  inlineColorSelect.addEventListener('change', saveSettings);
  inlineUnderlineSelect.addEventListener('change', saveSettings);
  document.querySelectorAll('input[name="translation-mode"]').forEach(radio => {
    radio.addEventListener('change', saveSettings);
  });

  // Helper to update status bar
  const updateStatus = (text, type = 'ready') => {
    statusText.textContent = text;
    statusBar.className = 'status'; // reset
    if (type === 'loading') {
      statusBar.classList.add('loading');
    } else if (type === 'error') {
      statusBar.classList.add('error');
    }
  };

  // Translate page button click
  translateBtn.addEventListener('click', async () => {
    const provider = providerSelect.value;
    const apiKey = apiKeyInput.value.trim();
    
    if (!apiKey && provider !== 'ollama') {
      updateStatus('Введите API ключ!', 'error');
      apiKeyInput.focus();
      return;
    }

    let model = modelSelect.value;
    if (model === 'custom') {
      model = customModelInput.value.trim();
    }
    
    if (!model) {
      updateStatus('Введите ID модели!', 'error');
      customModelInput.focus();
      return;
    }

    const targetLang = targetLangSelect.value;
    const mode = document.querySelector('input[name="translation-mode"]:checked').value;
    const inlineColor = inlineColorSelect.value;
    const inlineUnderline = inlineUnderlineSelect.value;

    updateStatus('Идет перевод...', 'loading');
    translateBtn.disabled = true;

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) {
        updateStatus('Не удалось найти активную вкладку', 'error');
        translateBtn.disabled = false;
        return;
      }

      if (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:')) {
        updateStatus('Нельзя переводить служебные страницы', 'error');
        translateBtn.disabled = false;
        return;
      }

      // Send start translation message to content script
      chrome.tabs.sendMessage(tab.id, {
        action: 'translate',
        apiKey,
        provider,
        model,
        targetLang,
        mode,
        inlineColor,
        inlineUnderline
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.error(chrome.runtime.lastError);
          updateStatus('Ошибка: перезагрузите страницу', 'error');
          translateBtn.disabled = false;
          return;
        }

        if (response && response.success) {
          updateStatus(`Успешно переведено! Фрагментов: ${response.count}`);
        } else {
          updateStatus(response?.error || 'Произошла ошибка при переводе', 'error');
        }
        translateBtn.disabled = false;
      });
    } catch (err) {
      console.error(err);
      updateStatus('Неизвестная ошибка', 'error');
      translateBtn.disabled = false;
    }
  });

  // Restore page button click
  restoreBtn.addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) return;

      chrome.tabs.sendMessage(tab.id, { action: 'restore' }, (response) => {
        if (chrome.runtime.lastError) {
          updateStatus('Ошибка: перезагрузите страницу', 'error');
          return;
        }
        if (response && response.success) {
          updateStatus('Оригинальный текст восстановлен');
        } else {
          updateStatus('Нечего сбрасывать', 'error');
        }
      });
    } catch (err) {
      console.error(err);
      updateStatus('Ошибка при сбросе', 'error');
    }
  });
});
