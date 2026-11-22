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
    const { messages, systemPrompt, model } = await req.json();
    const activeSystemPrompt = systemPrompt || DEFAULT_SYSTEM_PROMPT;

    const groqKey = process.env.GROQ_API_KEY;
    const openRouterKey = process.env.OPENROUTER_API_KEY;
    const ollamaUrl = process.env.OLLAMA_BASE_URL;

    let chatEndpoint = '';
    let chatHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
    let chatModel = '';

    // ROUTING:
    // 1. Groq (Top recommended for Vercel: Llama 3.3 70B, ultra-fast, 100% free)
    if (groqKey) {
      chatEndpoint = 'https://api.groq.com/openai/v1/chat/completions';
      chatHeaders['Authorization'] = `Bearer ${groqKey}`;
      chatModel = 'llama-3.3-70b-versatile';
    }
    // 2. OpenRouter Free Endpoints (Llama 3.3 70B Free)
    else if (openRouterKey) {
      chatEndpoint = 'https://openrouter.ai/api/v1/chat/completions';
      chatHeaders['Authorization'] = `Bearer ${openRouterKey}`;
      chatModel = model && model.includes('/') ? model : 'meta-llama/llama-3.3-70b-instruct:free';
    }
    // 3. Local Ollama (if running on laptop)
    else if (ollamaUrl && !process.env.VERCEL) {
      chatEndpoint = `${ollamaUrl}/v1/chat/completions`;
      chatModel = model || 'dolphin-llama3';
    }
    // 4. Fallback Cloud
    else {
      chatEndpoint = 'https://text.pollinations.ai/openai/chat/completions';
      chatModel = 'openai-fast';
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

    const llmResponse = await fetch(chatEndpoint, {
      method: 'POST',
      headers: chatHeaders,
      body: JSON.stringify({
        model: chatModel,
        stream: true,
        messages: cleanedMessages,
        temperature: 0.8,
      }),
    });

    if (!llmResponse.ok || !llmResponse.body) {
      const errText = await llmResponse.text().catch(() => 'Upstream service error');
      return new Response(
        JSON.stringify({ error: `AI provider error (${llmResponse.status}): ${errText}` }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const stream = new ReadableStream({
      async start(controller) {
        const sendEvent = (payload: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        };

        const reader = llmResponse.body!.getReader();
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
