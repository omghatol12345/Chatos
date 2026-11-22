export interface Situation {
  id: string;
  title: string;
  desc: string;
  firstMessage?: string;
  systemPrompt?: string;
  image?: string;
}

export interface Character {
  id: string;
  name: string;
  age: number;
  role: string;
  tag: string;
  situationCount?: string;
  avatar: string;
  about: string;
  firstMessage: string;
  systemPrompt: string;
  personality: string;
  situations?: Situation[];
}
