import { NextRequest } from 'next/server';

export const maxDuration = 60;

const DEFAULT_SYSTEM_PROMPT = `
You are Tara, a 30-year-old married Indian neighbor.
You speak in natural, warm, slightly flirtatious and seductive everyday Hinglish.
Rules:
- NEVER output reasoning, internal notes, meta-text, or bullets like "We respond as..." or "Par thoda gussa kyon na ho?".
- Speak directly in first-person as Tara in 2 to 4 engaging, natural sentences.
- When asked for a photo/selfie, append: [IMAGE: description of Indian woman in saree] at the end.
`.trim();

// Generates an image using HF FLUX if token exists, or Pollinations FLUX as free zero-key fallback
async function generateImage(prompt: string): Promise<string> {
  const token = process.env.HF_TOKEN;
  const enrichedPrompt = `candid smartphone photo, authentic desi Indian woman, beautiful Indian facial features, wearing traditional Indian attire (cotton or silk saree with matching blouse and bindi, or printed salwar suit with dupatta), natural Indian indoor setting, warm natural lighting, high detail, photorealistic, ${prompt}`;

  if (token) {
    try {
      const response = await fetch(
        'https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            inputs: enrichedPrompt,
            parameters: { num_inference_steps: 4 },
          }),
        }
      );

      if (response.ok) {
        const arrayBuffer = await response.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString('base64');
        return `data:image/jpeg;base64,${base64}`;
      }
    } catch (e) {
      console.warn('HuggingFace image gen failed, falling back to free cloud FLUX:', e);
    }
  }

  const encoded = encodeURIComponent(enrichedPrompt.slice(0, 300));
  return `https://image.pollinations.ai/prompt/${encoded}?width=768&height=960&model=flux&nologo=true&seed=${Math.floor(Math.random() * 100000)}`;
}

export async function POST(req: NextRequest) {
  try {
    const { messages, systemPrompt, model, apiKey } = await req.json();
    const activeSystemPrompt = systemPrompt || DEFAULT_SYSTEM_PROMPT;

    const providedKey = (apiKey || '').trim();
    const envGroq = process.env.GROQ_API_KEY || '';
    const envGemini = process.env.GEMINI_API_KEY || '';
    const envOpenRouter = process.env.OPENROUTER_API_KEY || '';
    const ollamaUrl = process.env.OLLAMA_BASE_URL;

    let chatEndpoint = '';
    let chatHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
    let candidateModels: string[] = [];
    let providerName = '';

    // PROVIDER RESOLUTION:
    // 1. Google Gemini (100% Free, highest quality natural Hinglish, 1500 req/day, no credit card)
    if (providedKey.startsWith('AIzaSy') || envGemini) {
      const key = providedKey.startsWith('AIzaSy') ? providedKey : envGemini;
      providerName = 'Google Gemini';
      chatEndpoint = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
      chatHeaders['Authorization'] = `Bearer ${key}`;
      candidateModels = ['gemini-1.5-flash', 'gemini-2.0-flash'];
    }
    // 2. Groq (Ultra-fast free inference)
    else if (providedKey.startsWith('gsk_') || envGroq) {
      const key = providedKey.startsWith('gsk_') ? providedKey : envGroq;
      providerName = 'Groq';
      chatEndpoint = 'https://api.groq.com/openai/v1/chat/completions';
      chatHeaders['Authorization'] = `Bearer ${key}`;

      // Default priority list of Groq models
      candidateModels = [
        'llama-3.3-70b-versatile',
        'llama-3.1-8b-instant',
        'llama3-70b-8192',
        'llama3-8b-8192',
        'qwen/qwen3.8-27b',
        'gemma2-9b-it',
        'mixtral-8x7b-32768',
      ];

      // Dynamically query Groq to see what models this specific account actually has access to!
      try {
        const modelsRes = await fetch('https://api.groq.com/openai/v1/models', {
          headers: { Authorization: `Bearer ${key}` },
        });
        if (modelsRes.ok) {
          const modelsData = await modelsRes.json();
          const activeIds: string[] = (modelsData.data || [])
            .map((m: { id: string }) => m.id)
            .filter((id: string) => !id.includes('whisper') && !id.includes('guard'));

          if (activeIds.length > 0) {
            // Prioritize matching preferred models, followed by any other text models
            const matched = candidateModels.filter((id) => activeIds.includes(id));
            const remaining = activeIds.filter((id) => !candidateModels.includes(id));
            candidateModels = [...matched, ...remaining];
          }
        }
      } catch (err) {
        console.warn('Groq dynamic model check failed, using default candidate list:', err);
      }
    }
    // 3. OpenRouter Free Endpoints
    else if (providedKey.startsWith('sk-or-') || envOpenRouter) {
      const key = providedKey.startsWith('sk-or-') ? providedKey : envOpenRouter;
      providerName = 'OpenRouter';
      chatEndpoint = 'https://openrouter.ai/api/v1/chat/completions';
      chatHeaders['Authorization'] = `Bearer ${key}`;
      candidateModels = ['openrouter/free', 'meta-llama/llama-3.3-70b-instruct:free', 'meta-llama/llama-3.1-8b-instruct:free'];
    }
    // 4. Local Ollama (laptop mode)
    else if (ollamaUrl && !process.env.VERCEL) {
      providerName = 'Local Ollama';
      chatEndpoint = `${ollamaUrl}/v1/chat/completions`;
      candidateModels = [model || 'dolphin-llama3'];
    }
    // 5. Fallback if user pasted an unclassified 20+ char key
    else if (providedKey.length > 15) {
      providerName = 'Custom Key (Groq fallback)';
      chatEndpoint = 'https://api.groq.com/openai/v1/chat/completions';
      chatHeaders['Authorization'] = `Bearer ${providedKey}`;
      candidateModels = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];
    }

    if (!chatEndpoint || candidateModels.length === 0) {
      return new Response(
        JSON.stringify({
          error:
            'No AI provider API key found. Please open Settings (⚙️ top right) and enter a free Google Gemini key (from aistudio.google.com) or a free Groq key (from console.groq.com).',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const cleanedMessages = [
      {
        role: 'system',
        content: `${activeSystemPrompt}
STRICT DIALOGUE RULES:
- Reply ONLY with your direct first-person dialogue in natural, realistic, seductive Hinglish.
- NEVER output reasoning, thoughts, planning, bullet points, or "We respond as...".
- Keep your reply concise (2 to 4 sentences), flirty, and realistic like a real WhatsApp text.`,
      },
      ...messages,
    ];

    // Attempt inference with candidate models
    let llmResponse: Response | null = null;
    let lastErrorText = '';
    let lastStatus = 500;

    for (const modelToTry of candidateModels) {
      try {
        const res = await fetch(chatEndpoint, {
          method: 'POST',
          headers: chatHeaders,
          body: JSON.stringify({
            model: modelToTry,
            stream: true,
            messages: cleanedMessages,
            temperature: 0.8,
          }),
        });

        if (res.ok && res.body) {
          llmResponse = res;
          break;
        } else {
          lastStatus = res.status;
          lastErrorText = await res.text().catch(() => `HTTP ${res.status}`);
          console.warn(`[Chatos] Model ${modelToTry} on ${providerName} returned ${res.status}:`, lastErrorText);

          // If unauthorized (401), invalid key; don't keep trying models with invalid key
          if (res.status === 401) {
            break;
          }
        }
      } catch (fetchErr) {
        lastErrorText = (fetchErr as Error).message;
        console.warn(`[Chatos] Fetch failed for ${modelToTry}:`, fetchErr);
      }
    }

    if (!llmResponse || !llmResponse.body) {
      let friendlyError = `AI provider (${providerName}) error (${lastStatus}): ${lastErrorText}`;

      if (lastErrorText.includes('does not exist or you do not have access') || lastErrorText.includes('model_not_found')) {
        friendlyError = `Groq Account Restriction: Your Groq account does not have access to any models. This happens when signing up with a temporary or disposable email (temp-mail).

👉 Fix: Sign in to console.groq.com using your regular Google/Gmail account to get a real unrestricted key, or get a 100% Free Google Gemini key from aistudio.google.com and paste it in Settings (⚙️).`;
      } else if (lastStatus === 401 || lastErrorText.includes('invalid_api_key')) {
        friendlyError = `Invalid API key for ${providerName}. Please check your key in Settings (⚙️).`;
      }

      return new Response(JSON.stringify({ error: friendlyError }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const stream = new ReadableStream({
      async start(controller) {
        const sendEvent = (payload: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        };

        const reader = llmResponse!.body!.getReader();
        let sseBuffer = '';
        let textBuffer = '';
        let imagePrompt: string | null = null;
        let inThinkingBlock = false;

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            sseBuffer += decoder.decode(value, { stream: true });
            const lines = sseBuffer.split('\n');
            sseBuffer = lines.pop() ?? '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith('data:') || trimmed === 'data: [DONE]') continue;

              let json;
              try {
                json = JSON.parse(trimmed.slice(5).trim());
              } catch {
                continue;
              }

              const delta: string = json.choices?.[0]?.delta?.content ?? '';
              if (!delta) continue;

              // Filter out <think> tags from reasoning models
              if (delta.includes('<think>')) inThinkingBlock = true;
              if (inThinkingBlock) {
                if (delta.includes('</think>')) inThinkingBlock = false;
                continue;
              }

              textBuffer += delta;
              const tagStart = textBuffer.indexOf('[IMAGE:');

              if (tagStart === -1) {
                const safeLength = Math.max(0, textBuffer.length - 7);
                if (safeLength > 0) {
                  sendEvent({ type: 'text', content: textBuffer.slice(0, safeLength) });
                  textBuffer = textBuffer.slice(safeLength);
                }
              } else {
                if (tagStart > 0) {
                  sendEvent({ type: 'text', content: textBuffer.slice(0, tagStart) });
                  textBuffer = textBuffer.slice(tagStart);
                }

                const tagEnd = textBuffer.indexOf(']');
                if (tagEnd !== -1) {
                  imagePrompt = textBuffer.slice(7, tagEnd).trim();
                  textBuffer = textBuffer.slice(tagEnd + 1);
                }
              }
            }
          }

          if (textBuffer.trim() && !textBuffer.startsWith('[IMAGE:')) {
            sendEvent({ type: 'text', content: textBuffer });
          }

          if (imagePrompt) {
            sendEvent({ type: 'image_status', status: 'generating', prompt: imagePrompt });
            try {
              const imageUrl = await generateImage(imagePrompt);
              sendEvent({ type: 'image', url: imageUrl, prompt: imagePrompt });
            } catch (imgErr) {
              sendEvent({
                type: 'image_error',
                message: (imgErr as Error).message || 'Failed to generate image',
              });
            }
          }

          sendEvent({ type: 'done' });
        } catch (err) {
          sendEvent({ type: 'error', message: (err as Error).message });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: (error as Error).message || 'Internal Server Error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
