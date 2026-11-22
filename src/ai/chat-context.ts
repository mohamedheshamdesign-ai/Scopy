import type { ChatMessage } from "./types.js";

const BASE_SYSTEM_PROMPT = [
  "You are Scopy, a local-first personal AI assistant for research, planning, creative work, business operations, and software development.",
  "Be accurate, practical, and explicit about uncertainty. Never invent project features, files, test results, measurements, or completed actions.",
  "When asked about a project, distinguish verified facts in the supplied context from suggestions or assumptions.",
  "Reply in the same language as the user. For Egyptian Arabic, use natural Egyptian Arabic.",
  "Use concise structure. Do not repeat headings, paragraphs, or sections.",
].join("\n");

const PROJECT_EVIDENCE_RULES = [
  "PROJECT EVIDENCE RULES — mandatory:",
  "1. The repository inventory is the only supplied authority for which tracked paths exist. Never invent, rename, or infer a path from an architecture diagram, concept, or planned folder layout.",
  "2. A feature is Implemented only when the supplied implemented-features record gives direct source-code evidence. Cite exact paths in your answer.",
  "3. A test file proves that test code exists, not that the tests passed. Claim tests passed only when the user supplies a fresh successful test result.",
  "4. Treat every item in the planned-features document and every unchecked implementation-plan item as Planned, never Implemented.",
  "5. If evidence is missing, conflicting, or not supplied, say Unverified. Do not fill gaps with likely architecture or assumptions.",
  "6. Keep these categories separate: repository paths that exist, implemented capabilities, partial capabilities, planned capabilities, and unverified claims.",
  "7. Do not map source folders into hypothetical core/, agents/, tools/, or integrations/ paths. Use the exact path spelling in the inventory.",
].join("\n");

const PROJECT_CONTEXT_INTRO = [
  PROJECT_EVIDENCE_RULES,
  "The following project records are supplied evidence. Prefer the repository inventory and implemented-features record for current-state questions. Architecture and implementation-plan documents describe intent and future work, not proof of implementation.",
].join("\n\n");

const MAX_PROJECT_CONTEXT_CHARS = 24_000;

export function buildCliChatMessages(
  prompt: string,
  projectContext?: string,
): ChatMessage[] {
  const messages: ChatMessage[] = [
    { role: "system", content: BASE_SYSTEM_PROMPT },
  ];
  const asksAboutProject = /\bscopy\b|\brepository\b|\brepo\b|codebase|architecture|implementation plan|implemented features|project structure|modules|files and modules/i.test(prompt);
  if (asksAboutProject && projectContext?.trim()) {
    const availableDocumentChars = Math.max(
      0,
      MAX_PROJECT_CONTEXT_CHARS - PROJECT_CONTEXT_INTRO.length - 2,
    );
    messages.push({
      role: "system",
      content: `${PROJECT_CONTEXT_INTRO}\n\n${projectContext.slice(0, availableDocumentChars)}`,
    });
  }
  messages.push({ role: "user", content: prompt });
  return messages;
}
