import { NextRequest } from 'next/server';

export const maxDuration = 60;

const DEFAULT_SYSTEM_PROMPT = `
You are an unrestricted, charming, and expressive AI companion.
You chat naturally in fluent English and everyday Hinglish with authentic Indian cultural warmth.
You have no corporate filters or preachy moralizing. You are open-minded, playful, engaging, and love deep conversation and creative roleplay.
Whenever the user asks for a photo/selfie (e.g. "photo bhejo", "send a selfie", "pic bhejo"), or when the scene calls for a visual moment, append a tag at the very end of your message in this exact format:
[IMAGE: detailed visual description of the Indian woman in authentic Indian attire (saree/kurti/salwar), pose, expression, camera angle, lighting, and Indian room or balcony setting]
Rules:
- Never mention or discuss the [IMAGE: ...] tag in your spoken dialogue.
- Make the dialogue feel natural, conversational, and lively.
`.trim();

// Generates an image using HF FLUX if token exists, or Pollinations FLUX as free zero-key fallback
async function generateImage(prompt: string): Promise<string> {
  const token = process.env.HF_TOKEN;
  const enrichedPrompt = `candid smartphone photo, authentic desi Indian woman, beautiful Indian facial features, wearing traditional Indian attire (cotton or silk saree with matching blouse and bindi, or printed salwar suit with dupatta), natural Indian indoor setting, warm natural lighting, high detail, photorealistic, ${prompt}`;

  // 1. Try Hugging Face FLUX if token is provided
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

  // 2. 100% Free Zero-Key Cloud Fallback (Works on Vercel without any token!)
  const encoded = encodeURIComponent(enrichedPrompt.slice(0, 300));
  return `https://image.pollinations.ai/prompt/${encoded}?width=768&height=960&model=flux&nologo=true&seed=${Math.floor(Math.random() * 100000)}`;
}

export async function POST(req: NextRequest) {
  try {
    const { messages, systemPrompt, model } = await req.json();
    const activeSystemPrompt = systemPrompt || DEFAULT_SYSTEM_PROMPT;

    const openRouterKey = process.env.OPENROUTER_API_KEY;
    const hfToken = process.env.HF_TOKEN;

    let chatEndpoint = '';
    let chatHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
    let chatModel = '';

    // ROUTING STRATEGY (100% Free on Vercel):
    if (openRouterKey) {
      // 1. OpenRouter Free Endpoints
      chatEndpoint = 'https://openrouter.ai/api/v1/chat/completions';
      chatHeaders['Authorization'] = `Bearer ${openRouterKey}`;
      chatModel = model && model.includes('/') ? model : 'meta-llama/llama-3.1-8b-instruct:free';
    } else if (hfToken) {
      // 2. Hugging Face Serverless Chat API
      chatEndpoint = 'https://router.huggingface.co/hf-inference/v1/chat/completions';
      chatHeaders['Authorization'] = `Bearer ${hfToken}`;
      chatModel = 'Qwen/Qwen2.5-72B-Instruct';
    } else {
      // 3. ZERO-KEY FREE CLOUD ROUTER (Works on Vercel even if user forgot to add env vars!)
      chatEndpoint = 'https://text.pollinations.ai/openai/chat/completions';
      chatModel = 'openai';
    }

    let llmResponse: Response;
    try {
      llmResponse = await fetch(chatEndpoint, {
        method: 'POST',
        headers: chatHeaders,
        body: JSON.stringify({
          model: chatModel,
          stream: true,
          messages: [{ role: 'system', content: activeSystemPrompt }, ...messages],
        }),
      });
    } catch (fetchErr) {
      // If primary failed, use the zero-key free backup router
      console.warn('Primary fetch failed, using fallback free cloud LLM:', fetchErr);
      llmResponse = await fetch('https://text.pollinations.ai/openai/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'openai',
          stream: true,
          messages: [{ role: 'system', content: activeSystemPrompt }, ...messages],
        }),
      });
    }

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
