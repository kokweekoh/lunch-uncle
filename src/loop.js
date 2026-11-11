import { buildSystemPrompt, buildTimeNote } from "./prompt.js";
import { toolDefinitions, executeTool } from "./tools.js";

// OpenCode Go's OpenAI-compatible endpoint (see https://opencode.ai/docs/go).
const LLM_BASE_URL = "https://opencode.ai/inference/go/openai/v1";
// A Go model served on /chat/completions, so it understands OpenAI-style tool calls.
const LLM_MODEL = "glm-5.3";

const LLM_TIMEOUT_MS = 20_000;
const MAX_ROUNDS = 8;
// Total tool calls allowed for one user question, across all rounds.
// Each Places search is billed, so this caps what one question can cost.
export const MAX_TOOL_CALLS_PER_TURN = 5;
const TOOL_LIMIT_RESULT = JSON.stringify({
  error: "tool limit reached, answer with what you have",
});

const FALLBACK_REPLY = "Just go Berseh Food Centre lah.";

// Limits on what the browser can send, so nobody can rewrite Uncle's rules
// or run up the AI bill with a giant conversation.
export const MAX_HISTORY_MESSAGES = 20;
export const MAX_MESSAGE_CHARS = 2000;

/**
 * Run the agentic loop for one user turn and return Uncle's reply.
 *
 * history is the prior conversation as OpenAI-style {role, content} messages.
 * sessionId identifies the whole conversation (one per chat page load).
 */
export async function runLoop(history, message, env, sessionId = crypto.randomUUID()) {
  // If the Places key is missing, Uncle cannot search, so give a safe answer.
  if (!env.GOOGLE_PLACES_API_KEY) {
    return FALLBACK_REPLY;
  }

  const messages = [
    { role: "system", content: buildSystemPrompt() },
    ...cleanHistory(history),
    // The time goes on the newest message only. The system prompt and the
    // earlier history then stay word-for-word the same across turns, so the
    // provider can reuse its cache for them.
    { role: "user", content: `${buildTimeNote(new Date())}\n${message}` },
  ];

  // The session id is the same for every turn of one conversation (the chat
  // page sends it), so OpenCode Go can route and cache consistently.
  let toolCallsLeft = MAX_TOOL_CALLS_PER_TURN;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    // Once the tool budget is spent, tell the model it must answer now.
    const assistant = await callModel(messages, env, sessionId, toolCallsLeft > 0);
    messages.push(assistant);

    const toolCalls = assistant.tool_calls ?? [];
    if (toolCalls.length === 0) {
      return assistant.content ?? "";
    }

    // Run the calls we can afford at the same time. Every call still gets a
    // reply message, because the API rejects a tool call left unanswered.
    const allowed = toolCalls.slice(0, Math.max(0, toolCallsLeft));
    toolCallsLeft -= allowed.length;
    const results = await Promise.all(
      toolCalls.map((call, i) => {
        if (i >= allowed.length) {
          console.log(`round ${round}: ${call.function.name} skipped (tool limit)`);
          return TOOL_LIMIT_RESULT;
        }
        const args = parseArgs(call.function.arguments);
        console.log(`round ${round}: ${call.function.name}`, args);
        return executeTool(call.function.name, args, env);
      }),
    );
    toolCalls.forEach((call, i) => {
      messages.push({ role: "tool", tool_call_id: call.id, content: results[i] });
    });
  }

  return "Uncle tried too many times already. Ask something simpler.";
}

/**
 * Keep only plain user/assistant text messages from the browser's history,
 * trimmed to the most recent few and capped in length. Anything else, such
 * as a fake "system" message or a forged tool call, is dropped.
 */
export function cleanHistory(history) {
  if (!Array.isArray(history)) {
    return [];
  }
  return history
    .filter(
      (m) =>
        m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string",
    )
    .slice(-MAX_HISTORY_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_CHARS) }));
}

/**
 * Use the conversation id the chat page sent if it looks sane, otherwise
 * make a fresh one, so nobody can stuff odd text into the header.
 */
export function cleanSessionId(raw) {
  if (typeof raw === "string" && /^[A-Za-z0-9-]{8,64}$/.test(raw)) {
    return raw;
  }
  return crypto.randomUUID();
}

async function callModel(messages, env, sessionId, toolsAllowed = true) {
  const res = await fetch(`${LLM_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.OPENCODE_API_KEY}`,
      "x-opencode-session": sessionId,
      "user-agent": "lunch-uncle/1.0",
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages,
      tools: toolDefinitions,
      tool_choice: toolsAllowed ? "auto" : "none",
    }),
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`LLM returned ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  return data.choices[0].message;
}

function parseArgs(raw) {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}
