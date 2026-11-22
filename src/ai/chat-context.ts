import type { ChatMessage } from "./types.js";

const BASE_SYSTEM_PROMPT = [
  "You are Scopy, a local-first personal AI assistant for research, planning, creative work, business operations, and software development.",
  "Be accurate, practical, and explicit about uncertainty. Never invent project features, files, test results, measurements, or completed actions.",
  "When asked about a project, distinguish verified facts in the supplied context from suggestions or assumptions.",
  "Reply in the same language as the user. For Egyptian Arabic, use natural Egyptian Arabic.",
  "Use concise structure. Do not repeat headings, paragraphs, or sections.",
].join("\n");

export function buildCliChatMessages(
  prompt: string,
  architectureDocument?: string,
): ChatMessage[] {
  const messages: ChatMessage[] = [
    { role: "system", content: BASE_SYSTEM_PROMPT },
  ];
  const asksAboutScopy = /\bscopy\b|architecture|implementation plan|project structure/i.test(prompt);
  if (asksAboutScopy && architectureDocument?.trim()) {
    messages.push({
      role: "system",
      content: [
        "Verified Scopy project context follows. Treat it as the source of truth about the current architecture.",
        "Do not infer that planned or future components are already implemented.",
        architectureDocument.slice(0, 16_000),
      ].join("\n\n"),
    });
  }
  messages.push({ role: "user", content: prompt });
  return messages;
}
