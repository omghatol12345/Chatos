'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Send,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Sparkles,
  Settings,
  RefreshCw,
  Image as ImageIcon,
  Loader2,
  AlertCircle,
  X,
  ChevronLeft,
  MessageCircle,
  Lock,
  Plus,
  Flame,
  Search,
  Trash2,
  Wand2,
  Play,
} from 'lucide-react';
import { Character, Situation } from '@/types/character';
import { CHARACTERS } from '@/data/characters';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  imageUrl?: string;
  imagePrompt?: string;
  isGeneratingImage?: boolean;
  imageError?: string;
}

const AVATAR_PRESETS = [
  { label: 'Saree', url: 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=600&q=80' },
  { label: 'Red Saree', url: 'https://images.unsplash.com/photo-1607746882042-944635dfe10e?auto=format&fit=crop&w=600&q=80' },
  { label: 'Kurti', url: 'https://images.unsplash.com/photo-1621784563330-caee0b138a00?auto=format&fit=crop&w=600&q=80' },
  { label: 'Corporate', url: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=600&q=80' },
  { label: 'Festive', url: 'https://images.unsplash.com/photo-1617627143750-d86bc21e42bb?auto=format&fit=crop&w=600&q=80' },
  { label: 'Home Wear', url: 'https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?auto=format&fit=crop&w=600&q=80' },
];

export default function ChatosApp() {
  const [characters, setCharacters] = useState<Character[]>(CHARACTERS);
  const [activeCharacter, setActiveCharacter] = useState<Character | null>(null);
  const [activeSituation, setActiveSituation] = useState<Situation | null>(null);
  const [view, setView] = useState<'explore' | 'profile' | 'chat'>('explore');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'characters' | 'situations'>('characters');

  // Chat State
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [voiceReplayEnabled, setVoiceReplayEnabled] = useState(true);
  const [isListening, setIsListening] = useState(false);
  const [activeSpeakingId, setActiveSpeakingId] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState('dolphin-llama3');
  const [apiKey, setApiKey] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);

  // New character form state
  const [newChar, setNewChar] = useState({
    name: '',
    age: 26,
    role: '',
    tag: 'HARD TO CRACK',
    about: '',
    firstMessage: '',
    systemPrompt: '',
    avatar: AVATAR_PRESETS[0].url,
  });

  const bottomRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const speechQueueRef = useRef<string[]>([]);
  const isSpeakingRef = useRef<boolean>(false);

  // Load custom characters and API key from localStorage on start
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedKey = localStorage.getItem('chatos_api_key');
      if (savedKey) setApiKey(savedKey);

      const savedChars = localStorage.getItem('custom_characters');
      if (savedChars) {
        try {
          const parsed = JSON.parse(savedChars);
          setCharacters([...CHARACTERS, ...parsed]);
        } catch (e) {
          console.error(e);
        }
      }
    }
  }, []);

  const getChatStorageKey = useCallback(
    (charId: string, sitId?: string | null) => {
      return sitId ? `chat_history_${charId}_${sitId}` : `chat_history_${charId}_main`;
    },
    []
  );

  const openCharacterProfile = (char: Character) => {
    setActiveCharacter(char);
    setActiveSituation(null);
    setView('profile');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const startChat = useCallback(
    (char: Character, sit?: Situation | null) => {
      setActiveCharacter(char);
      setActiveSituation(sit || null);
      setView('chat');

      const storageKey = getChatStorageKey(char.id, sit?.id);
      if (typeof window !== 'undefined') {
        const savedChat = localStorage.getItem(storageKey);
        if (savedChat) {
          try {
            const parsed = JSON.parse(savedChat);
            setMessages(parsed);
            return;
          } catch (e) {
            console.error(e);
          }
        }
      }

      const initialGreeting = sit?.firstMessage || char.firstMessage;
      setMessages([
        {
          id: `welcome-${char.id}-${sit?.id || 'main'}`,
          role: 'assistant',
          content: initialGreeting,
        },
      ]);
    },
    [getChatStorageKey]
  );

  // Auto-save chat history to localStorage
  useEffect(() => {
    if (activeCharacter && messages.length > 0 && typeof window !== 'undefined') {
      const storageKey = getChatStorageKey(activeCharacter.id, activeSituation?.id);
      localStorage.setItem(storageKey, JSON.stringify(messages));
    }
  }, [messages, activeCharacter, activeSituation, getChatStorageKey]);

  useEffect(() => {
    if (view === 'chat') {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isLoading, view]);

  const stopSpeech = useCallback(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    speechQueueRef.current = [];
    isSpeakingRef.current = false;
    setActiveSpeakingId(null);
  }, []);

  const processSpeechQueue = useCallback(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    if (isSpeakingRef.current || speechQueueRef.current.length === 0) return;

    const sentence = speechQueueRef.current.shift();
    if (!sentence || !sentence.trim()) {
      processSpeechQueue();
      return;
    }

    const cleanText = sentence
      .replace(/\[IMAGE:.*?\]/g, '')
      .replace(/[*_#`]/g, '')
      .trim();

    if (!cleanText) {
      processSpeechQueue();
      return;
    }

    isSpeakingRef.current = true;
    const utterance = new SpeechSynthesisUtterance(cleanText);

    const voices = window.speechSynthesis.getVoices();
    const voice =
      voices.find((v) => v.lang === 'en-US' && v.name.includes('Natural')) ||
      voices.find((v) => v.lang.startsWith('en') && (v.name.includes('Zira') || v.name.includes('Samantha') || v.name.includes('Google'))) ||
      voices.find((v) => v.lang.startsWith('en')) ||
      null;

    if (voice) utterance.voice = voice;
    utterance.rate = 1.05;

    utterance.onend = () => {
      isSpeakingRef.current = false;
      if (speechQueueRef.current.length > 0) {
        processSpeechQueue();
      } else {
        setActiveSpeakingId(null);
      }
    };

    utterance.onerror = () => {
      isSpeakingRef.current = false;
      processSpeechQueue();
    };

    window.speechSynthesis.speak(utterance);
  }, []);

  const queueSpeech = useCallback(
    (textChunk: string, messageId: string) => {
      if (!voiceReplayEnabled) return;
      setActiveSpeakingId(messageId);
      speechQueueRef.current.push(textChunk);
      processSpeechQueue();
    },
    [voiceReplayEnabled, processSpeechQueue]
  );

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const SpeechRecognition =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onresult = (event: any) => {
          let transcript = '';
          for (let i = 0; i < event.results.length; i++) {
            transcript += event.results[i][0].transcript;
          }
          setInput(transcript);
        };

        recognition.onerror = (event: any) => {
          console.error('Speech recognition error:', event.error);
          setIsListening(false);
        };

        recognition.onend = () => {
          setIsListening(false);
        };

        recognitionRef.current = recognition;
      }
    }

    return () => {
      stopSpeech();
    };
  }, [stopSpeech]);

  const toggleListening = () => {
    if (!recognitionRef.current) {
      alert('Speech recognition is supported in Google Chrome or Microsoft Edge.');
      return;
    }

    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      stopSpeech();
      setInput('');
      try {
        recognitionRef.current.start();
        setIsListening(true);
      } catch (err) {
        console.error(err);
      }
    }
  };

  const speakMessage = (text: string, id: string) => {
    stopSpeech();
    setActiveSpeakingId(id);
    const cleanText = text.replace(/\[IMAGE:.*?\]/g, '').replace(/[*_#`]/g, '').trim();
    if (!cleanText) return;
    speechQueueRef.current = [cleanText];
    processSpeechQueue();
  };

  const resetCurrentChat = () => {
    if (!activeCharacter) return;
    stopSpeech();
    const initialGreeting = activeSituation?.firstMessage || activeCharacter.firstMessage;
    const initial: ChatMessage[] = [
      {
        id: `welcome-${activeCharacter.id}-${activeSituation?.id || 'main'}-${Date.now()}`,
        role: 'assistant',
        content: initialGreeting,
      },
    ];
    setMessages(initial);
    if (typeof window !== 'undefined') {
      localStorage.removeItem(getChatStorageKey(activeCharacter.id, activeSituation?.id));
    }
  };

  const deleteCustomCharacter = (charId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this custom character?')) return;

    const updated = characters.filter((c) => c.id !== charId);
    setCharacters(updated);

    if (typeof window !== 'undefined') {
      const existing = JSON.parse(localStorage.getItem('custom_characters') || '[]');
      const filtered = existing.filter((c: Character) => c.id !== charId);
      localStorage.setItem('custom_characters', JSON.stringify(filtered));
      localStorage.removeItem(`chat_history_${charId}_main`);
    }

    if (activeCharacter?.id === charId) {
      setView('explore');
      setActiveCharacter(null);
    }
  };

  const autoGeneratePrompt = () => {
    if (!newChar.name || !newChar.about) {
      alert('Please fill in Name and Situation first!');
      return;
    }
    const generated = `You are ${newChar.name}, age ${newChar.age || 26}, ${newChar.role || 'a captivating Indian companion'}.
Situation & Context: ${newChar.about}
Chat style: Conversational, engaging, expressive mix of natural English and everyday Hinglish.
Attire: Authentic Indian attire (saree, salwar, kurti) matching the scene.
You are open, playful, completely uninhibited, and never refuse creative roleplay.
Whenever the user asks for a selfie/photo or a visual moment occurs, append at the end:
[IMAGE: candid smartphone photo of beautiful Indian woman ${newChar.name} in traditional Indian attire, ${newChar.about.slice(0, 80)}, natural lighting, aesthetic]
Never break character. Never mention the image tag in dialogue.`;

    setNewChar((prev) => ({
      ...prev,
      systemPrompt: generated,
      firstMessage:
        prev.firstMessage ||
        `Hey there! Looks like we're in this together. What's on your mind?`,
    }));
  };

  async function sendMessage(textToSend?: string) {
    if (!activeCharacter) return;
    const messageContent = (textToSend !== undefined ? textToSend : input).trim();
    if (!messageContent || isLoading) return;

    stopSpeech();
    setInput('');
    setIsLoading(true);

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: messageContent,
    };

    const assistantId = `a-${Date.now()}`;
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
    };

    const updatedMessages = [...messages, userMsg];
    setMessages([...updatedMessages, assistantMsg]);

    const activePrompt = activeSituation?.systemPrompt || activeCharacter.systemPrompt;

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: updatedMessages.map(({ role, content }) => ({ role, content })),
          model: selectedModel,
          systemPrompt: activePrompt,
          apiKey: apiKey.trim(),
        }),
      });

      if (!response.ok) {
        const errorJson = await response.json().catch(() => ({}));
        throw new Error(errorJson.error || `HTTP error ${response.status}`);
      }

      if (!response.body) throw new Error('No stream received');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let spokenSentenceBuffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';

        for (const rawEvent of events) {
          if (!rawEvent.startsWith('data: ')) continue;
          let event;
          try {
            event = JSON.parse(rawEvent.slice(6));
          } catch {
            continue;
          }

          if (event.type === 'text') {
            const chunk = event.content;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, content: m.content + chunk } : m
              )
            );

            if (voiceReplayEnabled) {
              spokenSentenceBuffer += chunk;
              const sentenceMatch = spokenSentenceBuffer.match(/([^\.!\?\n]+[\.!\?\n]+)/g);
              if (sentenceMatch) {
                for (const sentence of sentenceMatch) {
                  queueSpeech(sentence, assistantId);
                  spokenSentenceBuffer = spokenSentenceBuffer.replace(sentence, '');
                }
              }
            }
          } else if (event.type === 'image_status') {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, isGeneratingImage: true, imagePrompt: event.prompt }
                  : m
              )
            );
          } else if (event.type === 'image') {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      isGeneratingImage: false,
                      imageUrl: event.url,
                      imagePrompt: event.prompt,
                    }
                  : m
              )
            );
          } else if (event.type === 'image_error') {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, isGeneratingImage: false, imageError: event.message }
                  : m
              )
            );
          } else if (event.type === 'error') {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: m.content + `\n\n[Error: ${event.message}]` }
                  : m
              )
            );
          }
        }
      }

      if (voiceReplayEnabled && spokenSentenceBuffer.trim()) {
        queueSpeech(spokenSentenceBuffer, assistantId);
      }
    } catch (err: any) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                content:
                  m.content ||
                  `⚠️ Connection error: ${err.message || 'Make sure Ollama is running (`ollama run dolphin-llama3`)'}`,
              }
            : m
        )
      );
    } finally {
      setIsLoading(false);
    }
  }

  const handleCreateCharacter = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newChar.name || !newChar.about) return;

    const generatedPrompt =
      newChar.systemPrompt ||
      `You are ${newChar.name}, age ${newChar.age || 26}, ${newChar.role || 'an Indian companion'}. Context: ${newChar.about}. Chat naturally in fluent English and Hinglish. Output authentic Indian scenes on [IMAGE: ...] requests. Never break character.`;

    const created: Character = {
      id: `custom-${Date.now()}`,
      name: newChar.name,
      age: Number(newChar.age) || 26,
      role: newChar.role || 'Custom Persona',
      tag: newChar.tag || 'CUSTOM',
      avatar: newChar.avatar,
      about: newChar.about,
      firstMessage: newChar.firstMessage || `Hey! I'm ${newChar.name}. Nice to meet you!`,
      personality: 'Custom Persona',
      systemPrompt: generatedPrompt,
    };

    const updated = [...characters, created];
    setCharacters(updated);

    if (typeof window !== 'undefined') {
      const existing = JSON.parse(localStorage.getItem('custom_characters') || '[]');
      localStorage.setItem('custom_characters', JSON.stringify([...existing, created]));
    }

    setShowCreateModal(false);
    setNewChar({
      name: '',
      age: 26,
      role: '',
      tag: 'HARD TO CRACK',
      about: '',
      firstMessage: '',
      systemPrompt: '',
      avatar: AVATAR_PRESETS[0].url,
    });

    startChat(created);
  };

  // Filtered Characters List
  const filteredCharacters = characters.filter((c) => {
    const q = searchQuery.toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      c.role.toLowerCase().includes(q) ||
      c.about.toLowerCase().includes(q)
    );
  });

  // Aggregated Situations List across all characters
  const allSituations = characters.flatMap((char) =>
    (char.situations || []).map((sit) => ({
      ...sit,
      character: char,
    }))
  ).filter((sit) => {
    const q = searchQuery.toLowerCase();
    return (
      sit.title.toLowerCase().includes(q) ||
      sit.desc.toLowerCase().includes(q) ||
      sit.character.name.toLowerCase().includes(q)
    );
  });

  return (
    <div className="min-h-screen bg-[#0d090d] text-zinc-100 flex flex-col font-sans">
      {/* Top Navbar */}
      <nav className="border-b border-zinc-800/80 bg-[#140e14]/90 backdrop-blur sticky top-0 z-30 px-4 sm:px-8 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-8">
          {/* Logo */}
          <div
            onClick={() => {
              setView('explore');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className="flex items-center gap-2 cursor-pointer group"
          >
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-pink-600 to-rose-500 flex items-center justify-center shadow-lg shadow-pink-600/30 group-hover:scale-105 transition">
              <Flame className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-xl tracking-tight text-white group-hover:text-pink-400 transition">
              Chatos
            </span>
          </div>

          {/* Navigation Links: Characters vs Situations */}
          <div className="flex items-center gap-6 text-sm font-medium">
            <button
              onClick={() => {
                setView('explore');
                setActiveTab('characters');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className={`transition pb-1 ${
                view === 'explore' && activeTab === 'characters'
                  ? 'text-pink-400 font-semibold border-b-2 border-pink-500'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Characters
            </button>
            <button
              onClick={() => {
                setView('explore');
                setActiveTab('situations');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className={`transition pb-1 ${
                view === 'explore' && activeTab === 'situations'
                  ? 'text-pink-400 font-semibold border-b-2 border-pink-500'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Situations ({allSituations.length})
            </button>
          </div>
        </div>

        {/* Right Corner Buttons */}
        <div className="flex items-center gap-3">
          {view !== 'explore' && (
            <button
              onClick={() => {
                setView('explore');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-800/80 hover:bg-zinc-800 text-zinc-300 text-xs font-medium border border-zinc-700 transition"
            >
              <ChevronLeft className="w-4 h-4" />
              <span>Explore</span>
            </button>
          )}

          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-500 hover:to-rose-500 text-white text-xs font-semibold shadow-md shadow-pink-600/20 hover:shadow-pink-600/40 transition active:scale-95"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Add Character / Situation</span>
            <span className="sm:hidden">Create</span>
          </button>

          <button
            onClick={() => setShowSettings(true)}
            title="Configure Models"
            className="p-2 rounded-xl bg-zinc-800/60 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-zinc-700/60 transition"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </nav>

      {/* VIEW 1: EXPLORE (CHARACTERS OR SITUATIONS TAB) */}
      {view === 'explore' && (
        <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-8 py-8 space-y-8">
          {/* Header & Tabs */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                {activeTab === 'characters'
                  ? 'Explore Indian Personas'
                  : 'Explore Dramatic Situations'}
              </h2>
              <p className="text-sm text-zinc-400 mt-1">
                {activeTab === 'characters'
                  ? 'Choose an Indian character to explore their backstory, situations, and private chat.'
                  : 'Jump directly into an intriguing storyline or scenario.'}
              </p>
            </div>

            <div className="flex items-center gap-3">
              {/* Tab Pills */}
              <div className="flex rounded-xl bg-[#1b131b] border border-zinc-800 p-1">
                <button
                  onClick={() => setActiveTab('characters')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                    activeTab === 'characters'
                      ? 'bg-pink-600 text-white shadow'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  Characters ({filteredCharacters.length})
                </button>
                <button
                  onClick={() => setActiveTab('situations')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                    activeTab === 'situations'
                      ? 'bg-pink-600 text-white shadow'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  Situations ({allSituations.length})
                </button>
              </div>

              {/* Search input */}
              <div className="relative w-48 sm:w-64">
                <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search name, role, scenario..."
                  className="w-full bg-[#1b131b] border border-zinc-800 rounded-xl pl-9 pr-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-pink-500"
                />
              </div>
            </div>
          </div>

          {/* TAB 1: CHARACTERS GRID */}
          {activeTab === 'characters' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {filteredCharacters.map((char) => {
                const isCustom = char.id.startsWith('custom-');

                return (
                  <div
                    key={char.id}
                    onClick={() => openCharacterProfile(char)}
                    className="group cursor-pointer flex flex-col bg-[#160f16] border border-zinc-800/80 rounded-2xl overflow-hidden hover:border-pink-500/50 hover:shadow-2xl hover:shadow-pink-900/20 transition-all duration-300 relative"
                  >
                    <div className="relative aspect-[4/4.8] w-full overflow-hidden bg-zinc-900">
                      <img
                        src={char.avatar}
                        alt={char.name}
                        className="w-full h-full object-cover object-top group-hover:scale-105 transition-transform duration-500"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-[#160f16] via-transparent to-black/30" />

                      <div className="absolute top-3 left-3 flex flex-col gap-1.5 items-start">
                        {char.tag && (
                          <span className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-amber-500/90 text-black font-bold text-[10px] tracking-wider uppercase shadow-md">
                            <Lock className="w-3 h-3" />
                            {char.tag}
                          </span>
                        )}
                        {char.situationCount && (
                          <span className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-rose-600/90 text-white font-semibold text-[10px] tracking-wide shadow-md">
                            {char.situationCount}
                          </span>
                        )}
                      </div>

                      {isCustom && (
                        <div className="absolute top-3 right-3">
                          <button
                            onClick={(e) => deleteCustomCharacter(char.id, e)}
                            title="Delete custom persona"
                            className="p-1 rounded-full bg-black/60 hover:bg-rose-600 text-zinc-400 hover:text-white transition shadow"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="p-4 flex-1 flex flex-col justify-between space-y-4">
                      <div>
                        <div className="flex items-baseline gap-1.5">
                          <h3 className="font-bold text-lg text-white group-hover:text-pink-400 transition">
                            {char.name}
                          </h3>
                          <span className="text-zinc-400 text-sm">, {char.age}</span>
                        </div>
                        <p className="text-xs text-zinc-400 mt-0.5">{char.role}</p>

                        <div className="mt-3.5 pt-3 border-t border-zinc-800/60">
                          <span className="text-[10px] font-bold text-rose-400 tracking-wider uppercase block">
                            USKE BAARE MEIN
                          </span>
                          <p className="text-xs text-zinc-300 mt-1 line-clamp-3 leading-relaxed">
                            {char.about}
                          </p>
                        </div>
                      </div>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openCharacterProfile(char);
                        }}
                        className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-500 hover:to-rose-500 text-white font-medium text-xs flex items-center justify-center gap-2 shadow-lg shadow-pink-600/20 transition group-hover:shadow-pink-600/40"
                      >
                        <MessageCircle className="w-4 h-4" />
                        <span>View Situations & Chat</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* TAB 2: SITUATIONS GRID */}
          {activeTab === 'situations' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {allSituations.map((sit) => (
                <div
                  key={`${sit.character.id}-${sit.id}`}
                  onClick={() => startChat(sit.character, sit)}
                  className="group cursor-pointer flex flex-col bg-[#160f16] border border-zinc-800/80 rounded-2xl overflow-hidden hover:border-pink-500/50 hover:shadow-2xl hover:shadow-pink-900/20 transition-all duration-300"
                >
                  {/* Situation Image */}
                  <div className="relative aspect-[16/10] w-full overflow-hidden bg-zinc-900">
                    <img
                      src={sit.image || sit.character.avatar}
                      alt={sit.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#160f16] via-transparent to-black/40" />

                    {/* Character Tag Pill */}
                    <div className="absolute top-3 left-3 flex items-center gap-2 bg-black/70 backdrop-blur-md px-2.5 py-1 rounded-full border border-white/10">
                      <img
                        src={sit.character.avatar}
                        alt={sit.character.name}
                        className="w-5 h-5 rounded-full object-cover"
                      />
                      <span className="text-xs font-semibold text-white">
                        {sit.character.name}
                      </span>
                    </div>
                  </div>

                  {/* Situation Content */}
                  <div className="p-4 flex-1 flex flex-col justify-between space-y-4">
                    <div>
                      <h3 className="font-bold text-base text-white group-hover:text-pink-400 transition line-clamp-1">
                        {sit.title}
                      </h3>
                      <p className="text-xs text-zinc-300 mt-2 leading-relaxed line-clamp-3">
                        {sit.desc}
                      </p>
                    </div>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        startChat(sit.character, sit);
                      }}
                      className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-500 hover:to-rose-500 text-white font-medium text-xs flex items-center justify-center gap-2 shadow-lg shadow-pink-600/20 transition group-hover:shadow-pink-600/40"
                    >
                      <Play className="w-3.5 h-3.5 fill-white" />
                      <span>Enter Situation</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      )}

      {/* VIEW 2: CHARACTER PROFILE & SITUATIONS SHOWCASE */}
      {view === 'profile' && activeCharacter && (
        <main className="flex-1 max-w-4xl mx-auto w-full px-4 sm:px-6 py-8 space-y-6">
          <button
            onClick={() => setView('explore')}
            className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white transition mb-2"
          >
            <ChevronLeft className="w-4 h-4" /> Back to Explore
          </button>

          <div className="bg-[#191019] border border-zinc-800/90 rounded-3xl p-6 sm:p-8 space-y-6 shadow-2xl relative overflow-hidden">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 pb-6 border-b border-zinc-800/80">
              <div className="flex items-center gap-4">
                <img
                  src={activeCharacter.avatar}
                  alt={activeCharacter.name}
                  className="w-20 h-20 sm:w-24 sm:h-24 rounded-full object-cover border-4 border-pink-500/40 shadow-xl"
                />
                <div>
                  <h1 className="text-2xl sm:text-3xl font-extrabold text-white">
                    {activeCharacter.name}
                    <span className="text-zinc-400 font-normal text-lg sm:text-xl">, {activeCharacter.age}</span>
                  </h1>
                  <p className="text-sm text-zinc-400 mt-1">{activeCharacter.role}</p>
                </div>
              </div>

              <button
                onClick={() => startChat(activeCharacter)}
                className="px-6 py-3 rounded-2xl bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-500 hover:to-rose-500 text-white font-semibold text-sm shadow-xl shadow-pink-600/30 hover:scale-105 active:scale-95 transition flex items-center justify-center gap-2"
              >
                <MessageCircle className="w-5 h-5" />
                <span>Start chat</span>
              </button>
            </div>

            <div>
              <span className="text-[11px] font-bold text-rose-400 tracking-wider uppercase block">
                USKE BAARE MEIN
              </span>
              <p className="text-sm text-zinc-300 mt-2 leading-relaxed bg-[#120a12]/80 p-4 rounded-2xl border border-zinc-800/80">
                {activeCharacter.about}
              </p>
            </div>

            <div>
              <span className="text-[11px] font-bold text-zinc-400 tracking-wider uppercase block mb-2">
                PEHLA MESSAGE USKA
              </span>
              <div className="bg-[#211521] border border-pink-500/20 rounded-2xl p-4 text-sm text-zinc-200 leading-relaxed shadow-inner">
                "{activeCharacter.firstMessage}"
              </div>
            </div>

            {activeCharacter.situations && activeCharacter.situations.length > 0 && (
              <div className="pt-2">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-pink-400" />
                    <span className="text-xs font-bold text-rose-400 tracking-wider uppercase">
                      SITUATIONS ({activeCharacter.situations.length})
                    </span>
                  </div>
                  <span className="text-[11px] text-zinc-500">Pick a scenario to start</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {activeCharacter.situations.map((sit) => (
                    <div
                      key={sit.id}
                      onClick={() => startChat(activeCharacter, sit)}
                      className="group cursor-pointer bg-[#140d14] border border-zinc-800/80 hover:border-pink-500/60 rounded-2xl overflow-hidden transition-all duration-300 hover:shadow-xl hover:shadow-pink-900/20 flex flex-col"
                    >
                      {sit.image && (
                        <div className="h-32 w-full overflow-hidden bg-zinc-900">
                          <img
                            src={sit.image}
                            alt={sit.title}
                            className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                          />
                        </div>
                      )}
                      <div className="p-3.5 flex-1 flex flex-col justify-between">
                        <div>
                          <h4 className="font-semibold text-xs text-white group-hover:text-pink-400 transition line-clamp-1">
                            {sit.title}
                          </h4>
                          <p className="text-[11px] text-zinc-400 mt-1 line-clamp-2 leading-relaxed">
                            {sit.desc}
                          </p>
                        </div>
                        <div className="mt-3 flex items-center justify-between text-[11px] text-pink-400 font-medium">
                          <span>Enter Situation</span>
                          <Play className="w-3 h-3 fill-pink-400" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </main>
      )}

      {/* VIEW 3: DEDICATED CHAT VIEW */}
      {view === 'chat' && activeCharacter && (
        <main className="flex-1 flex flex-col max-w-4xl mx-auto w-full border-x border-zinc-800/80 bg-[#120c12] shadow-2xl min-h-[calc(100vh-57px)]">
          {/* Chat Header */}
          <header className="px-5 py-3.5 border-b border-zinc-800 bg-[#170e17] flex items-center justify-between sticky top-[57px] z-20">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setView('profile')}
                className="p-1.5 -ml-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>

              <div className="relative">
                <img
                  src={activeCharacter.avatar}
                  alt={activeCharacter.name}
                  className="w-10 h-10 rounded-full object-cover border-2 border-pink-500/50"
                />
                <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-500 border-2 border-zinc-950" />
              </div>

              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold text-white text-base">{activeCharacter.name}</h2>
                  <span className="text-xs text-zinc-400">({activeCharacter.age})</span>
                  {activeSituation ? (
                    <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30">
                      {activeSituation.title}
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-pink-500/10 text-pink-400 border border-pink-500/20">
                      Main Story
                    </span>
                  )}
                </div>
                <p className="text-xs text-zinc-400 truncate max-w-xs">{activeCharacter.role}</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setVoiceReplayEnabled(!voiceReplayEnabled);
                  if (voiceReplayEnabled) stopSpeech();
                }}
                title={voiceReplayEnabled ? 'Voice Replay ON (Click to mute)' : 'Voice Replay OFF (Click to unmute)'}
                className={`p-2 rounded-xl border transition-all text-xs flex items-center gap-1.5 ${
                  voiceReplayEnabled
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20'
                    : 'bg-zinc-800/60 border-zinc-700 text-zinc-400 hover:bg-zinc-800'
                }`}
              >
                {voiceReplayEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                <span className="hidden sm:inline">{voiceReplayEnabled ? 'Voice ON' : 'Voice Muted'}</span>
              </button>

              <button
                onClick={resetCurrentChat}
                title="Reset Chat for this situation"
                className="p-2 rounded-xl bg-zinc-800/60 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-zinc-700/60 transition"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          </header>

          {/* Scenario Banner */}
          <div className="px-5 py-2.5 bg-pink-950/20 border-b border-pink-900/30 flex items-start gap-2 text-xs text-pink-200/90">
            <Sparkles className="w-4 h-4 text-pink-400 flex-shrink-0 mt-0.5" />
            <p className="line-clamp-2">
              <span className="font-semibold text-pink-300">Situation: </span>
              {activeSituation ? activeSituation.desc : activeCharacter.about}
            </p>
          </div>

          {/* Messages Feed */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
            {messages.map((msg) => {
              const isUser = msg.role === 'user';
              const isSpeakingThis = activeSpeakingId === msg.id;

              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} transition-all`}
                >
                  <div
                    className={`group relative rounded-2xl p-4 max-w-[85%] sm:max-w-[78%] leading-relaxed ${
                      isUser
                        ? 'bg-gradient-to-tr from-pink-600 to-rose-600 text-white shadow-md shadow-pink-600/10'
                        : 'bg-[#1a121a] border border-zinc-800 text-zinc-200 shadow-sm'
                    }`}
                  >
                    {msg.content ? (
                      <p className="whitespace-pre-wrap text-sm leading-relaxed">{msg.content}</p>
                    ) : (
                      <div className="flex items-center gap-2 text-zinc-500 text-sm py-1">
                        <Loader2 className="w-4 h-4 animate-spin text-pink-400" />
                        <span>{activeCharacter.name} is typing...</span>
                      </div>
                    )}

                    {msg.isGeneratingImage && (
                      <div className="mt-3 rounded-xl bg-zinc-950/70 border border-zinc-800 p-3.5 flex items-center gap-3 animate-pulse">
                        <div className="w-8 h-8 rounded-lg bg-pink-500/20 flex items-center justify-center">
                          <ImageIcon className="w-4 h-4 text-pink-400 animate-bounce" />
                        </div>
                        <div>
                          <p className="text-xs font-medium text-pink-300">Sending a photo...</p>
                          <p className="text-[11px] text-zinc-500 truncate max-w-xs">{msg.imagePrompt}</p>
                        </div>
                      </div>
                    )}

                    {msg.imageUrl && (
                      <div className="mt-3 group/img relative overflow-hidden rounded-xl border border-zinc-700/80 bg-zinc-950">
                        <img
                          src={msg.imageUrl}
                          alt={msg.imagePrompt || 'Generated photo'}
                          className="w-full h-auto max-h-96 object-cover rounded-xl transition duration-300 hover:scale-[1.02]"
                        />
                        {msg.imagePrompt && (
                          <div className="p-2.5 bg-zinc-900/90 text-[11px] text-zinc-400 border-t border-zinc-800">
                            📸 {msg.imagePrompt}
                          </div>
                        )}
                      </div>
                    )}

                    {msg.imageError && (
                      <div className="mt-3 rounded-xl bg-amber-500/10 border border-amber-500/20 p-2.5 flex items-center gap-2 text-amber-300 text-xs">
                        <AlertCircle className="w-4 h-4 flex-shrink-0" />
                        <span>Image generation failed: {msg.imageError}</span>
                      </div>
                    )}

                    {!isUser && msg.content && (
                      <div className="mt-2.5 pt-2 border-t border-zinc-800/80 flex items-center justify-between text-xs text-zinc-400">
                        <button
                          onClick={() => speakMessage(msg.content, msg.id)}
                          className={`flex items-center gap-1.5 px-2 py-1 rounded-lg transition ${
                            isSpeakingThis
                              ? 'text-pink-400 bg-pink-500/10 font-medium'
                              : 'hover:text-zinc-200 hover:bg-zinc-800'
                          }`}
                        >
                          <Volume2 className={`w-3.5 h-3.5 ${isSpeakingThis ? 'animate-pulse' : ''}`} />
                          <span>{isSpeakingThis ? 'Speaking...' : 'Play Voice'}</span>
                        </button>
                        {isSpeakingThis && (
                          <button
                            onClick={stopSpeech}
                            className="text-zinc-500 hover:text-zinc-300 text-[11px] px-1.5 py-0.5 rounded hover:bg-zinc-800"
                          >
                            Stop
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>

          {/* Quick Contextual Suggestions */}
          {messages.length <= 3 && (
            <div className="px-5 py-2 flex items-center gap-2 overflow-x-auto no-scrollbar bg-[#140d14]/40">
              <Sparkles className="w-3.5 h-3.5 text-pink-400 flex-shrink-0" />
              {[
                `Send me a selfie right now!`,
                `What are you thinking about?`,
                `Let's talk in Hinglish...`,
              ].map((s, idx) => (
                <button
                  key={idx}
                  onClick={() => sendMessage(s)}
                  className="text-xs bg-[#1f151f] hover:bg-[#2b1d2b] text-zinc-300 border border-zinc-800 px-3 py-1.5 rounded-full whitespace-nowrap transition"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* Input Controls */}
          <div className="p-4 border-t border-zinc-800 bg-[#140e14]">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                sendMessage();
              }}
              className="flex items-center gap-2"
            >
              <button
                type="button"
                onClick={toggleListening}
                title={isListening ? 'Stop listening' : 'Start voice chat'}
                className={`p-3 rounded-2xl border transition-all ${
                  isListening
                    ? 'bg-rose-600 text-white border-rose-500 animate-pulse shadow-lg shadow-rose-600/30'
                    : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border-zinc-700'
                }`}
              >
                {isListening ? <Mic className="w-5 h-5 text-white" /> : <MicOff className="w-5 h-5" />}
              </button>

              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={
                  isListening
                    ? 'Listening to your voice...'
                    : `Message ${activeCharacter.name}... (e.g. "Send me a photo")`
                }
                className={`flex-1 rounded-2xl bg-[#1d141d] border px-4 py-3 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none transition ${
                  isListening
                    ? 'border-rose-500 ring-1 ring-rose-500'
                    : 'border-zinc-800 focus:border-pink-500 focus:ring-1 focus:ring-pink-500'
                }`}
              />

              <button
                type="submit"
                disabled={!input.trim() || isLoading}
                className="p-3 rounded-2xl bg-gradient-to-tr from-pink-600 to-rose-600 hover:from-pink-500 hover:to-rose-500 disabled:opacity-40 disabled:cursor-not-allowed text-white shadow-md shadow-pink-600/20 transition"
              >
                <Send className="w-5 h-5" />
              </button>
            </form>
            <p className="text-[11px] text-zinc-500 text-center mt-2">
              Isolated chat for {activeCharacter.name} ({activeSituation?.title || 'Main Story'}) · Ollama · Voice STT/TTS · FLUX Images
            </p>
          </div>
        </main>
      )}

      {/* FLOATING ACTION BUTTON */}
      <button
        onClick={() => setShowCreateModal(true)}
        className="fixed bottom-6 right-6 z-40 flex items-center gap-2.5 px-4 py-3 rounded-full bg-gradient-to-r from-pink-600 via-rose-600 to-amber-500 text-white font-semibold text-sm shadow-2xl shadow-pink-600/50 hover:shadow-pink-500/80 hover:scale-105 active:scale-95 transition-all border border-pink-400/30 group"
      >
        <Plus className="w-5 h-5 group-hover:rotate-90 transition-transform duration-300" />
        <span className="tracking-wide">Create Persona & Situation</span>
      </button>

      {/* CREATE NEW PERSONA MODAL */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-[#181118] border border-zinc-700/80 rounded-2xl w-full max-w-xl p-6 space-y-4 shadow-2xl my-8">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3.5">
              <div>
                <h3 className="font-bold text-lg text-white flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-pink-400" /> Add New Indian Persona & Situation
                </h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Insert your scenario prompt. It will be added to the catalog and saved with its own private chat.
                </p>
              </div>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-zinc-400 hover:text-white p-1 rounded-lg hover:bg-zinc-800 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateCharacter} className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-zinc-300 mb-1">
                    Character Name *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Natasha / Simran"
                    value={newChar.name}
                    onChange={(e) => setNewChar({ ...newChar, name: e.target.value })}
                    className="w-full bg-[#120c12] border border-zinc-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-pink-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1">Age</label>
                  <input
                    type="number"
                    value={newChar.age}
                    onChange={(e) => setNewChar({ ...newChar, age: Number(e.target.value) })}
                    className="w-full bg-[#120c12] border border-zinc-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-pink-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1">
                    Role / Subtitle
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Pados wali bhabhi / College senior"
                    value={newChar.role}
                    onChange={(e) => setNewChar({ ...newChar, role: e.target.value })}
                    className="w-full bg-[#120c12] border border-zinc-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-pink-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1">Tag / Badge</label>
                  <select
                    value={newChar.tag}
                    onChange={(e) => setNewChar({ ...newChar, tag: e.target.value })}
                    className="w-full bg-[#120c12] border border-zinc-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-pink-500"
                  >
                    <option value="HARD TO CRACK">🔒 HARD TO CRACK</option>
                    <option value="NEW">★ NEW</option>
                    <option value="POPULAR">🔥 POPULAR</option>
                    <option value="ROMANTIC">💖 ROMANTIC</option>
                    <option value="MYSTERY">🕵️ MYSTERY</option>
                  </select>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-zinc-300">
                    Situation Prompt / Storyline ("Uske Baare Mein") *
                  </label>
                  <button
                    type="button"
                    onClick={autoGeneratePrompt}
                    className="text-[11px] text-pink-400 hover:text-pink-300 flex items-center gap-1 transition"
                  >
                    <Wand2 className="w-3 h-3" /> Auto-build AI Prompt
                  </button>
                </div>
                <textarea
                  rows={3}
                  required
                  placeholder="Tum dono kaise mile? Kya situation hai? Describe the scenario in Hindi/Hinglish..."
                  value={newChar.about}
                  onChange={(e) => setNewChar({ ...newChar, about: e.target.value })}
                  className="w-full bg-[#120c12] border border-zinc-700 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-pink-500 leading-relaxed"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                  Choose Indian Attire Portrait
                </label>
                <div className="grid grid-cols-6 gap-2">
                  {AVATAR_PRESETS.map((preset, idx) => (
                    <button
                      type="button"
                      key={idx}
                      onClick={() => setNewChar({ ...newChar, avatar: preset.url })}
                      className={`relative aspect-square rounded-xl overflow-hidden border-2 transition ${
                        newChar.avatar === preset.url
                          ? 'border-pink-500 scale-105 shadow-md shadow-pink-500/30'
                          : 'border-zinc-800 opacity-60 hover:opacity-100'
                      }`}
                    >
                      <img src={preset.url} alt={preset.label} className="w-full h-full object-cover" />
                      <span className="absolute bottom-0 inset-x-0 bg-black/70 text-[9px] text-center text-zinc-300 py-0.5">
                        {preset.label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1">
                  First Greeting Message
                </label>
                <input
                  type="text"
                  placeholder="The first line the character will say when the chat starts"
                  value={newChar.firstMessage}
                  onChange={(e) => setNewChar({ ...newChar, firstMessage: e.target.value })}
                  className="w-full bg-[#120c12] border border-zinc-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-pink-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-1">
                  Secret AI System Prompt (Optional)
                </label>
                <textarea
                  rows={2}
                  placeholder="Leave empty or click 'Auto-build AI Prompt' to generate automatically"
                  value={newChar.systemPrompt}
                  onChange={(e) => setNewChar({ ...newChar, systemPrompt: e.target.value })}
                  className="w-full bg-[#120c12] border border-zinc-700 rounded-xl p-2 text-[11px] text-zinc-300 focus:outline-none focus:border-pink-500 font-mono"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 rounded-xl text-xs text-zinc-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-500 hover:to-rose-500 text-white font-semibold text-xs shadow-lg shadow-pink-600/30 transition"
                >
                  Save & Open Chat
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* SETTINGS MODAL */}
      {showSettings && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#181118] border border-zinc-800 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h3 className="font-semibold text-lg text-white flex items-center gap-2">
                <Settings className="w-5 h-5 text-pink-400" /> System Settings
              </h3>
              <button
                onClick={() => setShowSettings(false)}
                className="text-zinc-400 hover:text-white p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-medium text-zinc-300 flex items-center justify-between">
                <span>Free Cloud AI Key (Gemini or Groq)</span>
                {apiKey.startsWith('AIzaSy') ? (
                  <span className="text-[10px] text-emerald-400 font-semibold bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800">
                    ⚡ Google Gemini (Active)
                  </span>
                ) : apiKey.startsWith('gsk_') ? (
                  <span className="text-[10px] text-pink-400 font-semibold bg-pink-950/60 px-2 py-0.5 rounded border border-pink-800">
                    🚀 Groq Llama 3 (Active)
                  </span>
                ) : apiKey.startsWith('sk-or-') ? (
                  <span className="text-[10px] text-purple-400 font-semibold bg-purple-950/60 px-2 py-0.5 rounded border border-purple-800">
                    🌐 OpenRouter (Active)
                  </span>
                ) : (
                  <span className="text-[10px] text-amber-400 font-semibold">100% Free Forever</span>
                )}
              </label>

              <input
                type="password"
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  localStorage.setItem('chatos_api_key', e.target.value);
                }}
                placeholder="Paste Google Gemini (AIzaSy...) or Groq (gsk_...) key"
                className="w-full bg-[#120c12] border border-zinc-700 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-pink-500 font-mono"
              />

              <div className="p-2.5 bg-black/40 border border-zinc-800 rounded-xl text-[11px] space-y-1.5">
                <div className="flex items-start gap-1.5">
                  <span className="text-emerald-400 font-bold">1. Recommended:</span>
                  <div className="text-zinc-300">
                    <strong>Google Gemini (1-Click, No Card):</strong>
                    <br />
                    Go to{' '}
                    <a
                      href="https://aistudio.google.com/app/apikey"
                      target="_blank"
                      rel="noreferrer"
                      className="text-pink-400 underline font-medium"
                    >
                      aistudio.google.com/app/apikey
                    </a>
                    , click <em>Create API Key</em> with your Gmail. Generates fluent, emotional Hinglish!
                  </div>
                </div>

                <div className="flex items-start gap-1.5 pt-1 border-t border-zinc-800/80">
                  <span className="text-pink-400 font-bold">2. Alternative:</span>
                  <div className="text-zinc-300">
                    <strong>Groq Llama 3:</strong>
                    <br />
                    Go to{' '}
                    <a
                      href="https://console.groq.com/keys"
                      target="_blank"
                      rel="noreferrer"
                      className="text-pink-400 underline font-medium"
                    >
                      console.groq.com/keys
                    </a>
                    . <em>(Note: Log in with Google; disposable temp-mail accounts get model blocked by Groq)</em>.
                  </div>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">
                Local Ollama Model (for offline laptop mode only)
              </label>
              <input
                type="text"
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                placeholder="dolphin-llama3"
                className="w-full bg-[#120c12] border border-zinc-700 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-pink-500"
              />
              <p className="text-[11px] text-zinc-500 mt-1">
                Used only when running locally on your laptop with Ollama.
              </p>
            </div>

            <div className="pt-2 border-t border-zinc-800 flex justify-between items-center">
              <button
                onClick={() => {
                  if (confirm('Clear all chat histories for all characters?')) {
                    characters.forEach((c) => {
                      localStorage.removeItem(`chat_history_${c.id}_main`);
                      c.situations?.forEach((s) => localStorage.removeItem(`chat_history_${c.id}_${s.id}`));
                    });
                    alert('All chat histories cleared.');
                    window.location.reload();
                  }
                }}
                className="text-xs text-rose-400 hover:text-rose-300 transition"
              >
                Clear All Saved Chats
              </button>

              <button
                onClick={() => setShowSettings(false)}
                className="px-4 py-2 bg-pink-600 hover:bg-pink-500 text-white rounded-xl text-xs font-medium transition"
              >
                Save & Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
