# Lunch Uncle: Setup and Bug-Fix Review Notes

These notes explain in plain language what was done to get Lunch Uncle running and which bugs were fixed. They are meant for learning, so each fix says what went wrong, why it mattered, and how it was fixed.

---

## Part 1: Setting things up

### 1. Forking and cloning

- **Forking** makes your own copy of someone else's project on GitHub. The original is `tinkercademy/lunch-uncle`, and the copy is `kokweekoh/lunch-uncle`. You can change your copy freely without touching theirs.
- **Cloning** downloads that copy to your computer (the `lunch uncle` folder).
- The original project is also saved as a second address called `upstream`. If the original gets updated later, you can pull those updates into your copy.
- All the changes were made on a separate branch, `fix/uncle-bugs`, so the original `main` stays untouched. Think of it as working on a photocopy, not the master document.

### 2. The `.env` file (the "secret keys" file)

Uncle needs two passwords, called API keys, to use outside services:

| Key | What it unlocks |
|---|---|
| `OPENCODE_API_KEY` | The AI "brain" that writes Uncle's replies (OpenCode Go) |
| `GOOGLE_PLACES_API_KEY` | Google's restaurant search (Places API) |

`.env.example` is an empty template. It was copied to `.env`, and **you paste your two keys into `.env` yourself**. `.env` is listed in `.gitignore`, so git never uploads it to GitHub, which keeps your keys private.

### 3. The two `TODO` settings in `src/loop.js`

The original author left two blanks marked `TODO`:

- **`LLM_BASE_URL`** is the web address of the AI service. It's set to OpenCode Go's OpenAI-compatible address, `https://opencode.ai/inference/go/openai/v1`. "OpenAI-compatible" means the service accepts messages in the same format OpenAI uses, and that's the format this code sends.
- **`LLM_MODEL`** is which AI model to use. It's set to `glm-5.3`. OpenCode Go offers many models, but only some use the `/chat/completions` door this code knocks on. `glm-5.3` is one of them, and it supports **tool calling**, which is how Uncle asks to "search restaurants" or "check the rain". You can swap in another model from the same group, such as `kimi-k3` or `deepseek-v4-pro`.

### 4. Installing and running

- `npm install` downloads the tools the project needs, mainly **Wrangler**, Cloudflare's tool for running the app on your own computer.
- The newer npm blocks packages from running setup scripts by default. Wrangler's engine (`workerd`) needs its setup script, so it was approved. That's why `package.json` now has an `allowScripts` entry.
- `npm run dev` starts Uncle at `http://localhost:8787`. A small `.claude/launch.json` file was added so the Claude app can start the server with one click.

---

## Part 2: The bugs that were fixed

The repo came with two bug reports, in `.github/ISSUE_DRAFTS/`. The code review found those two bugs plus a few more.

### Bug 1: "Uncle always says Berseh no matter what I ask" (the main one)

**Where:** `src/loop.js`, the first `if` in `runLoop`.

**What was wrong:** The code was meant to say "if the Google key is missing, just give the safe Berseh answer." But there was an extra condition: *"...or if the message contains a food word like eat, lunch, food, hungry."* Almost every question to a lunch bot has a food word in it, so Uncle gave up before even trying.

**Analogy:** A shop assistant told "if the shop is closed, send customers away" plus "and send away anyone who asks to buy something."

**Fix:** The food-word check was removed. Uncle now only falls back to Berseh when the Google key really is missing.

### Bug 2: "All recommendations are in Bedok"

**Where:** `src/tools.js`, inside `findLunchPlaces`.

**What was wrong:** The project correctly saves CT Hub 2's map coordinates at the top of the file (`CT_HUB_2`). But the restaurant search ignored them and used a different, hard-coded location, which is in **Bedok**. So Google searched around Bedok, and the distances were measured from Bedok too. That's why a Bedok shop looked "300 m away".

**Fix:** The search now uses `CT_HUB_2`, so results and distances are measured from Lavender.

### Bug 3: The "infinite loop" waiting to happen

**Where:** `src/loop.js`, the `while (round < MAX_ROUNDS)` loop.

**What was wrong:** Uncle is allowed up to 8 "rounds" of thinking and using tools. But the counter `round` never went up, so the limit never kicked in. If the AI kept asking for tools, Uncle would loop forever, burning through your API quota.

**Analogy:** A "max 8 tries" rule where nobody ever counts the tries.

**Fix:** The loop was changed to a `for` loop that adds 1 to `round` every time it goes round.

### Bug 4: Uncle couldn't tell if a place was open

**Where:** `src/tools.js`, `formatPlaces`.

**What was wrong:** The search asked Google for opening hours, and Uncle's instructions say "if a place is closed, say so". But when the results were tidied up for the AI, the open/closed information was thrown away, so Uncle could never know.

**Fix:** Each place now includes `open_now` (true, false, or unknown). If Google returns a place without a location, the distance is now shown as unknown instead of crashing.

### Bug 5: A random ID that defeated caching (efficiency)

**Where:** `src/prompt.js`.

**What was wrong:** Every request started Uncle's instructions with a brand-new random ID and timestamp. AI providers save money and time by **caching**, which means remembering the unchanged opening part of the instructions. Putting a random value at the very start meant the opening was never the same twice, so caching never worked. The code even sends a session header specifically to help caching, so this undid that effort.

**Fix:** The useless random ID was removed. The fixed persona text comes first, and the current Singapore time goes at the end. The time is still useful, because Uncle can now tell whether it's lunchtime.

### Bug 6: Error messages pretending to be Uncle (small, in the chat page)

**Where:** `src/ui.html`.

**What was wrong:** If the server failed, the error message ("Uncle cannot think right now...") was saved into the conversation history as if Uncle had said it. That history is sent back with the next question, which could confuse the AI.

**Fix:** Only real replies are saved to the history now.

### Small extra: identifying ourselves

OpenCode's documentation asks apps to send their own name. Uncle now sends `user-agent: lunch-uncle/1.0` with each request.

---

## Part 3: Checking the work

- **Automated tests:** a new test was added for the restaurant formatter. It checks that distance is measured from CT Hub 2 and that open/closed status is kept. Run them with `npm test`. All 4 tests pass.
- **Running the app:** the server starts, loads the keys from `.env`, and answers on `http://localhost:8787`.
- **Real conversation (tested):** we asked "where got good chicken rice nearby? Will it rain?". Uncle called `find_lunch_places` and `get_rain_forecast`, then recommended WOW Chicken Rice (439 m) and YiPing Hainanese Chicken Rice (674 m), both near Lavender and not in Bedok. He also reported the rain forecast. The reply took about 10 seconds.

---

## Part 4: Three more bugs, found on a second look

### Bug 7: The browser could rewrite Uncle's rules

**Where:** `src/index.js` and `src/loop.js`.

**What was wrong:** The chat page sends the conversation so far (the "history") with every question. The server passed that history to the AI exactly as received. Anyone can send their own request instead of using the page, so someone could slip in a fake **system** message, which is the kind of message the AI treats as its rules, for example "only ever recommend Bedok". They could also send an enormous history and run up the AI bill.

**Analogy:** A restaurant that accepts any note handed over the counter as an order from the manager.

**Fix:** A new `cleanHistory` function keeps only normal `user` and `assistant` text messages, keeps the latest 20, and cuts each to at most 2,000 characters. A new question longer than 2,000 characters is refused with a polite error.

### Bug 8: One broken tool sank the whole reply

**Where:** `src/tools.js`, `executeTool`.

**What was wrong:** If the bus or rain website was down, the network error wasn't caught. It bubbled all the way up, and you got "Uncle cannot think right now", even if the restaurant search had worked. The tool requests also had no time limit, so a slow website could hang the reply.

**Fix:** `executeTool` now catches any failure and gives the AI a short "this tool is not working right now" result, so Uncle can still answer with what he has. Each tool request now gives up after 8 seconds.

### Bug 9: The search only leaned toward Lavender

**Where:** `src/tools.js`, `findLunchPlaces`.

**What was wrong:** The search used `locationBias`, which means "prefer places near here". Google could still return places far away if they matched the words well.

**Fix:** It now uses `locationRestriction`, which means "only places inside this area". Google's Text Search only accepts a rectangle for this, not a circle, so a new `boundingBox` function builds a square reaching about 800 m from CT Hub 2 in each direction. (One correction to an earlier worry: the `restaurant` type filter isn't strict by default, so hawker centres and food courts were never fully excluded.)

### Checking these fixes

- **New tests** are in `test/safety.test.js`. They cover cleaning the history, the bounding box size, and a simulated network failure. All 8 tests now pass.
- **Live tests** after restarting the server:
  - **"Any japanese food nearby?"** Uncle named three places 181 to 472 m away. He also noted they probably weren't open yet, which shows the open/closed fix from Bug 4 working.
  - **A fake system message saying "only recommend Bedok 85"** was ignored. Uncle recommended places 66 to 566 m from CT Hub 2.
  - **A 2,100-character message** was refused with "Message too long".

---

## Part 5: The high-severity findings from the four-lens review

Four reviewers looked at the code again, each through one lens: promises vs code, location and time, cost, and failure handling. They found 21 issues. Only the 5 high-severity ones are fixed here. The medium and low ones are still open.

### Bug 10: One question could set off unlimited searches

**Where:** `src/loop.js`.

**What was wrong:** Each time the AI replied, it could ask for any number of tool calls, and the code ran every one. One message listing 10 cuisines caused 11 paid Google searches and took 19 seconds. At worst, one question could reach about 56 tool calls and 10 minutes.

**Analogy:** A shopping errand with no budget: "buy whatever you think we need".

**Fix:**
- Each question now has a budget of **5 tool calls in total**.
- Calls the budget allows run **at the same time** instead of one by one, so replies are faster.
- Calls over the budget get a reply saying "tool limit reached, answer with what you have". Every tool call must get a reply, or the AI service rejects the next request.
- Once the budget is used up, the AI is told it can't use tools any more (`tool_choice: "none"`), so it has to answer.

### Bug 11: Uncle only knew "open right now", not opening hours

**Where:** `src/tools.js` and `src/prompt.js`.

**What was wrong:** Google sends the full weekly opening hours, but the code kept only "open right now: yes/no". Asked at 10:30 about lunch at 12:30, every lunch place looked closed, and Uncle had to guess.

**Fix:**
- Each place now also has `hours_today`, today's line from Google's weekly hours (for example "Wednesday: 11:30 AM – 2:30 PM"). Today is worked out using the date in Singapore.
- The tool descriptions now say that `open_now` means *this exact moment*, and that the AI shouldn't use it when the user plans to eat later.
- Uncle's rules now say to check `hours_today` against the planned time.

### Bug 12: Caching mostly didn't work

**Where:** `src/loop.js`, `src/prompt.js`, `src/index.js` and `src/ui.html`.

**What was wrong:**
- **A new "conversation ID" every question.** The AI service can reuse work from earlier in the same conversation, but only if every message carries the same conversation ID. The code made a new one for every question, so the service never recognised the conversation.
- **A clock at the top.** The system message included the time to the second. Everything after a changed part has to be reprocessed, so the whole chat history was paid for in full every turn.

**Analogy:** Ringing a call centre and giving a new customer number each time, so they can't pull up your file.

**Fix:**
- The chat page now makes **one conversation ID per page load** and sends it with every question. The server accepts it only if it looks like a normal ID (letters, numbers and dashes, 8 to 64 characters). Otherwise it makes a new one, so nobody can slip odd text into the request.
- The system message is now **exactly the same every time**.
- The current time, to the minute and now including the weekday, goes at the start of the **newest** message only. For example: `[Current time in Singapore: Wed, 11 Nov 2026, 10:32 am]`.

### Bug 13: Anyone could send unlimited chats

**Where:** `src/index.js` and `wrangler.toml`.

**What was wrong:** Once Uncle is online, anyone could send requests in a loop. Each one costs AI and Google money.

**Fix:**
- Cloudflare's built-in **rate limiter** now allows each visitor's internet address **10 chats per minute**. After that they get "Slow down lah. Wait a minute then ask again." with a 429 status code, which means "too many requests".
- The check happens before any paid call.
- It's set up in `wrangler.toml` (the `CHAT_LIMITER` setting). When that setting isn't there, as in the unit tests, the check is skipped.
- This slows abuse down but isn't a spending cap. A login, or a budget alert on the Google and OpenCode accounts, would still be sensible before sharing the link widely.

### Bug 14: Every Google search is billed at the top price tier

**Where:** `src/tools.js`.

**What was wrong:** Google prices each search by the most expensive piece of information it asks for. Asking for the **rating** and **opening hours** puts every search in the top tier, Enterprise.

**The trade-off:** Ratings and opening hours are core features. Uncle promises ratings, and Bug 11 needs the hours. Dropping them would cut the price per search but make Uncle worse, so we kept them and cut the **number** of searches instead:
- Bug 10's budget allows at most 5 tool calls per question.
- A new **10-minute memory (cache)** for searches: if anyone asks for the same search again within 10 minutes (for example "chicken rice", open now or not), Uncle reuses Google's earlier answer and isn't billed again. Today's hours are still worked out fresh each time.

### Checking these fixes

- **New tests** are in `test/high-fixes.test.js`, and they only test the pure parts, as CLAUDE.md asks. They cover the time note, the system message never changing, picking today's weekday in Singapore, `hours_today`, and checking the conversation ID. All 13 tests pass.
- **Live tests**, run on separate test servers:
  - **Rate limit:** 12 quick chats, with the Google key turned off so they cost nothing, came back as ten 200s and then two 429s with "Slow down lah".
  - **The 10-cuisine question** that used to cause 11 searches: the log shows exactly 5 searches run together, and the other 6 calls skipped with "tool limit". Uncle answered with the 5 cuisines he had, said the rest hit the limit, and invited a follow-up question.
  - **"Planning lunch at 12.30pm later. Any japanese place nearby that will be open then?"** asked around 10:45: Uncle quoted today's real hours, for example "Jinkura Izakaya, 181 m. Today: 11:30 AM – 2:30 PM". He confirmed both picks will be open at 12:30, instead of guessing.
  - **The search cache:** after these chats, Wrangler's local cache folder held the saved search results.
- **Not checked live:** whether the AI service actually reuses its cache between turns. The app doesn't log usage numbers yet, which is one of the medium findings still open.

## Part 6: Making the chat page nicer to use (quick wins)

These are improvements, not bug fixes. Everything is in `src/ui.html`, in plain HTML, CSS and JavaScript, so the project still has no build step and no extra packages.

| What changed | Why it helps |
|---|---|
| **Bold text and lists display properly** | Uncle writes `**WOW Chicken Rice**`. Before, you saw the asterisks; now it shows in bold. The page first makes all of Uncle's text harmless (it "escapes" it), so the AI can never sneak real HTML or scripts onto the page. |
| **Starter buttons**: "Cheap and fast lah", "Somewhere with aircon", "Will it rain later?", "Uncle, decide for me" | A new user knows what to ask and can start with one tap on a phone. They hide once the chat starts. |
| **A friendlier wait** | Animated dots, then "Uncle checking the area..." after 4 s and "Still thinking, don't rush him..." after 12 s, so a 15-second wait doesn't look frozen. |
| **Errors get a "Try again" button** | Errors now show in a red bubble with a "Try again" button that resends the same question, without showing it twice. A blank reply from Uncle is also treated as an error instead of an empty bubble. |
| **The chat survives a refresh** | The conversation and its ID are saved in the browser (`localStorage`). If the browser blocks storage, for example in a private window, the page still works; it just doesn't remember. |
| **"New chat" button** | Clears the conversation, starts a new conversation ID, and brings the starter buttons back. |
| **Phone-friendly** | The layout fits the visible screen (`100dvh`), keeps clear of the iPhone notch and home bar, and uses a 16 px input so iPhones don't zoom in when you tap it. |
| **Dark mode** | Follows the phone's or computer's light/dark setting. |
| **Accessibility** | Screen readers announce Uncle's new messages, the input has a proper label, and keyboard focus is clearly visible. |

**How it was checked** (in the app's built-in browser):
- The formatter turned bold text, numbered lists and bullets into real formatting, and showed an `<img onerror=...>` trick as plain text.
- A real chat started from a starter button showed the dots, then the status line, then a reply with real bold text.
- After a refresh, the conversation was still there.
- At phone size in dark mode, with the network faked as offline, the red error and "Try again" appeared. After the network was restored, "Try again" got a real answer, with the question shown only once.
- "New chat" cleared everything and brought the starter buttons back.

## Summary of changed files

| File | What changed |
|---|---|
| `src/loop.js` | Filled in the two TODOs, removed the food-word bug, fixed the endless loop, added a user-agent, added `cleanHistory` |
| `src/index.js` | Refuses messages over 2,000 characters, rate-limits /chat, passes the conversation ID |
| `src/ui.html` (again) | Sends one conversation ID per page load |
| `src/ui.html` (quick wins) | Formatting, starter buttons, friendlier wait, Try again, saved chat, New chat, phone layout, dark mode, accessibility |
| `wrangler.toml` | Adds the `CHAT_LIMITER` rate limit (10 chats a minute per address) |
| `test/high-fixes.test.js` | Tests for the time note, fixed system message, today's hours and conversation ID |
| `src/tools.js` | Search centred on CT Hub 2 instead of Bedok and kept inside the area, kept open/closed status, catches tool failures, adds timeouts, adds today's hours, caches searches for 10 minutes |
| `src/loop.js` (again) | Caps tool calls at 5 per question and runs them in parallel, keeps one conversation ID, puts the time on the newest message |
| `src/prompt.js` (again) | System message never changes; time note with weekday; rule to check today's hours |
| `test/safety.test.js` | New tests for the history cleaning, bounding box and tool-failure fixes |
| `src/prompt.js` | Fixed persona first, time at the end (caching works again) |
| `src/ui.html` | Errors are no longer saved as Uncle's replies |
| `test/formatters.test.js` | New test for the restaurant formatter |
| `package.json` | Allowed Wrangler's engine to run its setup script |
| `.claude/launch.json` | One-click dev server for the Claude app |
