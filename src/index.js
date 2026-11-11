import ui from "./ui.html";
import { runLoop, cleanSessionId, MAX_MESSAGE_CHARS } from "./loop.js";

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (request.method === "GET" && pathname === "/") {
      return new Response(ui, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    if (request.method === "POST" && pathname === "/chat") {
      return handleChat(request, env);
    }

    return new Response("Not found", { status: 404 });
  },
};

async function handleChat(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Body must be JSON" }, 400);
  }

  const { history = [], message, session_id } = body;
  if (typeof message !== "string" || message.trim() === "") {
    return json({ error: "message is required" }, 400);
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    return json({ error: "Message too long. Uncle got no time to read essay." }, 400);
  }

  // At most 10 chats a minute from one address, checked before any paid
  // call. Skipped when the limiter is not set up (e.g. in unit tests).
  if (env.CHAT_LIMITER) {
    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
    const { success } = await env.CHAT_LIMITER.limit({ key: ip });
    if (!success) {
      return json({ error: "Slow down lah. Wait a minute then ask again." }, 429);
    }
  }

  try {
    const reply = await runLoop(history, message, env, cleanSessionId(session_id));
    return json({ reply });
  } catch (err) {
    console.error("chat failed:", err);
    return json({ error: "Uncle cannot think right now, try again later." }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}
