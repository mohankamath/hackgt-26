## Inspiration

Kids are joining Discord and Instagram DMs younger every year. Most parental controls give families two bad options: block everything or read everything. If you block everything, kids lose real friendships. If you read everything, they stop trusting you. Grooming makes this harder, because it rarely looks dangerous one message at a time. "You're so mature for your age," "what school do you go to?" and "don't tell your mom we talk" all get past a keyword filter. We wanted a tool that catches those patterns and still lets kids make friends, and that gets parents and kids talking more, not less.

## What it does

**Screened** puts a kid's Discord and Instagram DMs into one safe inbox, with a separate dashboard for parents.

- **Message and image moderation:** Every message, attachment and profile picture is checked for threats, harassment, hate, sexual content, self-harm and illicit content. Swear words are masked as `•••` and the rest of the message still shows. Explicit images are blurred for the child, and the parent can review them.
- **Grooming detection across whole conversations:** A thread analyzer reads the full conversation and names the pattern as it builds (flattery, then personal questions, then secrecy, gifts, meetups, or moving to another app). It cites the exact messages as evidence. The risk meter goes up and the parent gets a live alert.
- **Contact vetting:** When someone new messages the child, their messages stay hidden until a parent decides. AI reads the first messages and the profile, then recommends **approve**, **watch** or **block**. It also suggests a question to ask the child, like *"How do you know Sam?"* A classmate gets approved in seconds. A stranger asking for secrets doesn't.
- **Coaching instead of silent censorship:** When a message is hidden, the child sees a short, kind tip instead. If they start to send their address or phone number, they get a gentle warning before it goes out.
- **Weekly parent digest:** A summary that celebrates healthy friendships along with any concerns, and ends with conversation starters. It's built only from aggregate stats. Message text is never sent.
- **Fails closed:** If the AI can't be reached, content is marked `needs_review` and stays hidden until a parent checks it. It never passes as safe by default.

## How we built it

- **Backend:** FastAPI (Python). The Discord listener (`discord.py-self`) and the Instagram poller (`instagrapi`) only put messages on an asyncio queue. Async workers run the moderation pipeline, so slow AI calls never stall the platform connections.
- **AI:**
  - OpenAI `omni-moderation-latest` handles text and image moderation. We added a local profanity, slur, keyword and PII layer on top.
  - `gpt-4o-mini` with structured outputs runs the thread analyzer, contact vetting, coaching and the digest.
  - Thread analysis is debounced so it doesn't re-run on every message. Coaching tips are cached per situation, with hand-written fallbacks.
- **Data:** Firestore for messages, contacts, threads, alerts and digests. Firebase Storage for media. Only safe media is public. Flagged media stays private, and parents view it through short-lived signed URLs.
- **Frontend:** React 19, TypeScript, Vite, Tailwind and Recharts. It reads Firestore in real time for the child chat and parent dashboard, and calls the API for actions like approve, block, re-analyze and send.
- **Testing:** pytest for the moderation, pipeline, queue, AI parsing and ingest flow. Vitest and Testing Library for the frontend.

## Challenges we ran into

- **Grooming is contextual.** Any single message looks harmless, so per-message moderation wasn't enough. We had to design a thread-level analyzer that returns structured, evidence-backed verdicts instead of vague scores.
- **Keeping the AI from blocking real-time chat.** Model calls are slow and sometimes fail. We separated ingest from moderation with a worker queue and made every failure path fail closed.
- **Unofficial platform APIs.** Neither Discord nor Instagram offers a supported way to read DMs. Getting Instagram sessions to stay alive, including 2FA/TOTP login, took real effort.
- **Balancing safety with a normal chat experience.** Hiding entire messages made the app feel broken. Masking just the bad words and adding coaching tips kept conversations flowing.
- **Privacy.** Deciding what parents see (only what matters) and what goes to the AI (only aggregate stats for the digest) took a lot of design discussion.

## Accomplishments that we're proud of

- The thread analyzer catches multi-step grooming patterns that keyword filters miss, and it explains its reasoning with cited messages.
- Vetting helps kids add friends instead of just blocking strangers.
- The system fails closed end to end.
- Discord and Instagram in one inbox, with moderation and alerts in real time.
- We replaced the original homemade RandomForest/DistilBERT/Ollama stack with something far more accurate and multimodal.

## What we learned

- The value of LLMs here is reasoning over context, not classifying single messages. Structured outputs made those judgments dependable enough to build product logic on.
- Safety tools work better when they teach and explain. Kids respond better to a kind tip than to a blank space, and parents trust a recommendation more when they can see its evidence.
- Asynchronous, fail-closed architecture matters a lot when an AI service is in the path of a real-time system.

## What's next for Screened

- **Real authentication and access control:** Parent and child accounts, API auth and locked-down Firestore rules.
- **Official platform integrations:** Move off the self-bot and session clients to supported APIs or partnerships.
- **More coverage:** Video scanning, more platforms (Snapchat, iMessage, Roblox) and a dedicated CSAM detection partner.
- **Age-aware tuning:** Different sensitivity and coaching tone for an 8-year-old than for a 13-year-old.
- **A mobile app** for parent alerts, and running models on the device for more privacy.
