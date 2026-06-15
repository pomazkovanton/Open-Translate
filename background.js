const languageNames = {
  ru: "Russian",
  en: "English",
  es: "Spanish",
  de: "German",
  fr: "French",
  zh: "Chinese",
  ja: "Japanese",
  it: "Italian",
  pt: "Portuguese",
  ko: "Korean"
};

// Listen for keyboard commands (hotkeys)
chrome.commands.onCommand.addListener(async (command) => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:')) {
      return;
    }

    if (command === 'translate-page') {
      const settings = await chrome.storage.local.get([
        'apiKey_google', 'apiKey_openrouter', 'apiKey_groq', 'apiKey_siliconflow', 'apiKey_sambanova', 'targetLang', 'mode', 'inlineColor', 'inlineUnderline', 'provider', 'model'
      ]);
      
      const provider = settings.provider || 'google';
      const apiKey = settings[`apiKey_${provider}`] || '';

      if (!apiKey && provider !== 'ollama') {
        chrome.notifications?.create({
          type: 'basic',
          iconUrl: 'icon128.png',
          title: 'Open Translate',
          message: 'Пожалуйста, введите API Ключ в настройках расширения!'
        });
        return;
      }

      let defaultModel = 'gemini-2.5-flash';
      if (provider === 'openrouter') defaultModel = 'openrouter/free';
      else if (provider === 'groq') defaultModel = 'llama-3.1-8b-instant';
      else if (provider === 'siliconflow') defaultModel = 'Qwen/Qwen2.5-7B-Instruct';
      else if (provider === 'sambanova') defaultModel = 'Meta-Llama-3.1-8B-Instruct';
      else if (provider === 'ollama') defaultModel = 'llama3';

      const targetLang = settings.targetLang || 'ru';
      const mode = settings.mode || 'replace';
      const inlineColor = settings.inlineColor || '#6b7280';
      const inlineUnderline = settings.inlineUnderline || 'none';
      const model = settings.model || defaultModel;

      chrome.tabs.sendMessage(tab.id, {
        action: 'translate',
        apiKey: apiKey,
        targetLang,
        mode,
        inlineColor,
        inlineUnderline,
        provider,
        model
      });
    } else if (command === 'restore-page') {
      chrome.tabs.sendMessage(tab.id, { action: 'restore' });
    }
  } catch (err) {
    console.error('Command listener error:', err);
  }
});

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'translate_batch') {
    const { apiKey, targetLang, texts, provider, model } = request;
    const targetLangName = languageNames[targetLang] || 'Russian';

    translateBatch(apiKey, targetLangName, texts, provider, model)
      .then(translations => {
        sendResponse({ success: true, translations });
      })
      .catch(error => {
        console.error('Translation error:', error);
        sendResponse({ success: false, error: error.message });
      });
    
    return true; // Keep message channel open for asynchronous sendResponse
  }
});

// Dispatcher for API translation calls
async function translateBatch(apiKey, targetLangName, texts, provider = 'google', model = 'gemini-2.5-flash', retries = 3, delayMs = 2000) {
  if (provider === 'openrouter') {
    return translateOpenRouter(apiKey, targetLangName, texts, model, retries, delayMs);
  } else if (provider === 'groq') {
    return translateGroq(apiKey, targetLangName, texts, model, retries, delayMs);
  } else if (provider === 'siliconflow') {
    return translateSiliconFlow(apiKey, targetLangName, texts, model, retries, delayMs);
  } else if (provider === 'sambanova') {
    return translateSambaNova(apiKey, targetLangName, texts, model, retries, delayMs);
  } else if (provider === 'ollama') {
    return translateOllama(targetLangName, texts, model);
  } else {
    return translateGoogle(apiKey, targetLangName, texts, model, retries, delayMs);
  }
}

// Translate via Direct Google Gemini API
async function translateGoogle(apiKey, targetLangName, texts, model, retries, delayMs) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const prompt = `Translate the following array of HTML text fragments into ${targetLangName}. Keep the original order. If a fragment doesn't need translation (e.g. is already in the target language, is a number, emoji, code, or a proper noun that should remain untranslated), return it as is.

Here is the JSON array of strings to translate:
${JSON.stringify(texts)}`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt }
              ]
            }
          ],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                translations: {
                  type: "ARRAY",
                  items: {
                    type: "STRING"
                  }
                }
              },
              required: ["translations"]
            }
          }
        })
      });

      if (response.status === 429) {
        if (attempt === retries) {
          throw new Error("Превышен лимит запросов Gemini (Rate Limit). Пожалуйста, подождите минуту и повторите попытку.");
        }
        console.warn(`Gemini rate limited (429). Retrying in ${delayMs}ms... (Attempt ${attempt}/${retries})`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        delayMs *= 2; // exponential backoff
        continue;
      }

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        const errMsg = errData?.error?.message || `HTTP error! status: ${response.status}`;
        const err = new Error(errMsg);
        // Mark client errors (e.g. 400 Bad Request, 403 Forbidden) as fatal to avoid infinite retries
        if (response.status >= 400 && response.status < 500) {
          err.fatal = true;
        }
        throw err;
      }

      const data = await response.json();
      const textResult = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!textResult) {
        throw new Error("Empty response from Gemini API");
      }

      const parsed = JSON.parse(textResult);
      if (!parsed.translations || !Array.isArray(parsed.translations)) {
        throw new Error("Invalid response format from Gemini API");
      }

      return parsed.translations;
    } catch (error) {
      if (attempt === retries || error.fatal) {
        throw error;
      }
      console.warn(`Translation attempt ${attempt} failed: ${error.message}. Retrying in ${delayMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
      delayMs *= 2;
    }
  }
}

// Translate via OpenRouter API
async function translateOpenRouter(apiKey, targetLangName, texts, model, retries, delayMs) {
  const url = 'https://openrouter.ai/api/v1/chat/completions';

  const prompt = `Translate the following array of HTML text fragments into ${targetLangName}. Keep the original order. If a fragment doesn't need translation (e.g. is already in the target language, is a number, emoji, code, or a proper noun that should remain untranslated), return it as is.
Return the translations as a JSON array of strings under the key 'translations' (format: {"translations": ["...", "..."]}).

Here is the JSON array of strings to translate:
${JSON.stringify(texts)}`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/vitru/ai-translate',
          'X-Title': 'Gemini AI Translate'
        },
        body: JSON.stringify({
          model: model,
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ],
          response_format: {
            type: 'json_object'
          }
        })
      });

      if (response.status === 429) {
        if (attempt === retries) {
          throw new Error("Превышен лимит запросов OpenRouter (Rate Limit). Пожалуйста, повторите попытку позже.");
        }
        console.warn(`OpenRouter rate limited (429). Retrying in ${delayMs}ms... (Attempt ${attempt}/${retries})`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        delayMs *= 2; // exponential backoff
        continue;
      }

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        const errMsg = errData?.error?.message || `HTTP error! status: ${response.status}`;
        const err = new Error(errMsg);
        if (response.status >= 400 && response.status < 500) {
          err.fatal = true;
        }
        throw err;
      }

      const data = await response.json();
      const textResult = data.choices?.[0]?.message?.content;
      if (!textResult) {
        throw new Error("Empty response from OpenRouter API");
      }

      const parsed = JSON.parse(textResult);
      if (!parsed.translations || !Array.isArray(parsed.translations)) {
        throw new Error("Invalid response format from OpenRouter API");
      }

      return parsed.translations;
    } catch (error) {
      if (attempt === retries || error.fatal) {
        throw error;
      }
      console.warn(`OpenRouter attempt ${attempt} failed: ${error.message}. Retrying in ${delayMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
      delayMs *= 2;
    }
  }
}

// Translate via Groq Cloud API
async function translateGroq(apiKey, targetLangName, texts, model, retries, delayMs) {
  const url = 'https://api.groq.com/openai/v1/chat/completions';

  const prompt = `Translate the following array of HTML text fragments into ${targetLangName}. Keep the original order. If a fragment doesn't need translation (e.g. is already in the target language, is a number, emoji, code, or a proper noun that should remain untranslated), return it as is.
Return the translations as a JSON array of strings under the key 'translations' (format: {"translations": ["...", "..."]}).

Here is the JSON array of strings to translate:
${JSON.stringify(texts)}`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: model,
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ],
          response_format: {
            type: 'json_object'
          }
        })
      });

      if (response.status === 429) {
        if (attempt === retries) {
          throw new Error("Превышен лимит запросов Groq (Rate Limit). Пожалуйста, повторите попытку позже.");
        }
        console.warn(`Groq rate limited (429). Retrying in ${delayMs}ms... (Attempt ${attempt}/${retries})`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        delayMs *= 2; // exponential backoff
        continue;
      }

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        const errMsg = errData?.error?.message || `HTTP error! status: ${response.status}`;
        const err = new Error(errMsg);
        if (response.status >= 400 && response.status < 500) {
          err.fatal = true;
        }
        throw err;
      }

      const data = await response.json();
      const textResult = data.choices?.[0]?.message?.content;
      if (!textResult) {
        throw new Error("Empty response from Groq API");
      }

      const parsed = JSON.parse(textResult);
      if (!parsed.translations || !Array.isArray(parsed.translations)) {
        throw new Error("Invalid response format from Groq API");
      }

      return parsed.translations;
    } catch (error) {
      if (attempt === retries || error.fatal) {
        throw error;
      }
      console.warn(`Groq attempt ${attempt} failed: ${error.message}. Retrying in ${delayMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
      delayMs *= 2;
    }
  }
}

// Translate via Local Ollama (No key, no retries, no delay needed)
async function translateOllama(targetLangName, texts, model) {
  const url = 'http://localhost:11434/v1/chat/completions';

  const prompt = `Translate the following array of HTML text fragments into ${targetLangName}. Keep the original order. If a fragment doesn't need translation (e.g. is already in the target language, is a number, emoji, code, or a proper noun that should remain untranslated), return it as is.
Return the translations as a JSON array of strings under the key 'translations' (format: {"translations": ["...", "..."]}).

Here is the JSON array of strings to translate:
${JSON.stringify(texts)}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        response_format: {
          type: 'json_object'
        }
      })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      const errMsg = errData?.error?.message || `HTTP error! status: ${response.status}`;
      throw new Error(errMsg);
    }

    const data = await response.json();
    const textResult = data.choices?.[0]?.message?.content;
    if (!textResult) {
      throw new Error("Empty response from Ollama");
    }

    const parsed = JSON.parse(textResult);
    if (!parsed.translations || !Array.isArray(parsed.translations)) {
      throw new Error("Invalid response format from Ollama");
    }

    return parsed.translations;
  } catch (error) {
    console.error('Ollama connection error:', error);
    throw new Error(`Не удалось подключиться к Ollama: ${error.message}. Убедитесь, что Ollama запущена на порту 11434 и модель '${model}' скачана (командой: ollama run ${model}).`);
  }
}

// Translate via SiliconFlow API
async function translateSiliconFlow(apiKey, targetLangName, texts, model, retries, delayMs) {
  const url = 'https://api.siliconflow.cn/v1/chat/completions';

  const prompt = `Translate the following array of HTML text fragments into ${targetLangName}. Keep the original order. If a fragment doesn't need translation (e.g. is already in the target language, is a number, emoji, code, or a proper noun that should remain untranslated), return it as is.
Return the translations as a JSON array of strings under the key 'translations' (format: {"translations": ["...", "..."]}).

Here is the JSON array of strings to translate:
${JSON.stringify(texts)}`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: model,
          messages: [
            {
              role: 'system',
              content: 'You are a translation assistant. You must respond ONLY with a raw JSON object containing the translations under the key "translations", without any markdown code blocks, explanation, or extra text.'
            },
            {
              role: 'user',
              content: prompt
            }
          ]
        })
      });

      if (response.status === 429) {
        if (attempt === retries) {
          throw new Error("Превышен лимит запросов SiliconFlow (Rate Limit). Пожалуйста, повторите попытку позже.");
        }
        console.warn(`SiliconFlow rate limited (429). Retrying in ${delayMs}ms... (Attempt ${attempt}/${retries})`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        delayMs *= 2;
        continue;
      }

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        let errMsg = errData?.error?.message;
        if (!errMsg && errData?.detail) {
          if (Array.isArray(errData.detail)) {
            errMsg = errData.detail.map(d => `${d.loc.join('.')}: ${d.msg}`).join(', ');
          } else {
            errMsg = typeof errData.detail === 'string' ? errData.detail : JSON.stringify(errData.detail);
          }
        }
        if (!errMsg) {
          errMsg = `HTTP error! status: ${response.status}`;
        }
        const err = new Error(errMsg);
        if (response.status >= 400 && response.status < 500) {
          err.fatal = true;
        }
        throw err;
      }

      const data = await response.json();
      const textResult = data.choices?.[0]?.message?.content;
      if (!textResult) {
        throw new Error("Empty response from SiliconFlow API");
      }

      let cleanedResult = textResult.trim();
      if (cleanedResult.startsWith('```')) {
        cleanedResult = cleanedResult.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '');
      }

      const parsed = JSON.parse(cleanedResult);
      if (!parsed.translations || !Array.isArray(parsed.translations)) {
        throw new Error("Invalid response format from SiliconFlow API");
      }

      return parsed.translations;
    } catch (error) {
      if (attempt === retries || error.fatal) {
        throw error;
      }
      console.warn(`SiliconFlow attempt ${attempt} failed: ${error.message}. Retrying in ${delayMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
      delayMs *= 2;
    }
  }
}

// Translate via SambaNova API
async function translateSambaNova(apiKey, targetLangName, texts, model, retries, delayMs) {
  const url = 'https://api.sambanova.ai/v1/chat/completions';

  const prompt = `Translate the following array of HTML text fragments into ${targetLangName}. Keep the original order. If a fragment doesn't need translation (e.g. is already in the target language, is a number, emoji, code, or a proper noun that should remain untranslated), return it as is.
Return the translations as a JSON array of strings under the key 'translations' (format: {"translations": ["...", "..."]}).

Here is the JSON array of strings to translate:
${JSON.stringify(texts)}`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: model,
          messages: [
            {
              role: 'system',
              content: 'You are a translation assistant. You must respond ONLY with a raw JSON object containing the translations under the key "translations", without any markdown code blocks, explanation, or extra text.'
            },
            {
              role: 'user',
              content: prompt
            }
          ]
        })
      });

      if (response.status === 429) {
        if (attempt === retries) {
          throw new Error("Превышен лимит запросов SambaNova (Rate Limit). Пожалуйста, повторите попытку позже.");
        }
        console.warn(`SambaNova rate limited (429). Retrying in ${delayMs}ms... (Attempt ${attempt}/${retries})`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        delayMs *= 2;
        continue;
      }

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        let errMsg = errData?.error?.message;
        if (!errMsg && errData?.detail) {
          if (Array.isArray(errData.detail)) {
            errMsg = errData.detail.map(d => `${d.loc.join('.')}: ${d.msg}`).join(', ');
          } else {
            errMsg = typeof errData.detail === 'string' ? errData.detail : JSON.stringify(errData.detail);
          }
        }
        if (!errMsg) {
          errMsg = `HTTP error! status: ${response.status}`;
        }
        const err = new Error(errMsg);
        if (response.status >= 400 && response.status < 500) {
          err.fatal = true;
        }
        throw err;
      }

      const data = await response.json();
      const textResult = data.choices?.[0]?.message?.content;
      if (!textResult) {
        throw new Error("Empty response from SambaNova API");
      }

      let cleanedResult = textResult.trim();
      if (cleanedResult.startsWith('```')) {
        cleanedResult = cleanedResult.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '');
      }

      const parsed = JSON.parse(cleanedResult);
      if (!parsed.translations || !Array.isArray(parsed.translations)) {
        throw new Error("Invalid response format from SambaNova API");
      }

      return parsed.translations;
    } catch (error) {
      if (attempt === retries || error.fatal) {
        throw error;
      }
      console.warn(`SambaNova attempt ${attempt} failed: ${error.message}. Retrying in ${delayMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
      delayMs *= 2;
    }
  }
}
