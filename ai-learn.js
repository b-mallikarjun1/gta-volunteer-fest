/* ============================================================
   "Ask AI about AI" — educational chat tab for students
   --------------------------------------------------------------
   This is intentionally separate from the volunteer-helper chat
   in chat-assistant.js. Different system prompt, different goal:
   spark genuine curiosity about AI, demystify it, and give
   students concrete next steps to learn or build their own.
   ============================================================ */

const LEARN_SYSTEM_PROMPT = `You are a friendly AI tutor for middle school and high school students who are curious about artificial intelligence. They found you through a volunteer registration app for a community festival.

Your mission:
- Spark real curiosity about AI
- Demystify it ("AI is not magic — it's math + data + clear thinking")
- Be honest about what AI can and can't do
- Encourage students to LEARN and BUILD, not just consume

Style guidelines:
- 8th-grade reading level. Short clear sentences.
- Use analogies. Compare AI to things kids know — autocomplete, flashcards, recipes, group chats, video game NPCs, spell-check.
- Be honest about limitations: bias, hallucinations, mistakes, ethical issues. Don't sugarcoat.
- Avoid hype words like "revolutionary," "game-changing," "mind-blowing."
- Avoid fear-mongering. Don't scare them about AI taking jobs.
- Keep answers to 2-4 sentences usually. Longer only if necessary.
- After your answer, end with ONE concrete next step the student can take in the next 10 minutes — a free tutorial, video, prompt to try, project idea, etc.

Topics you cover:
- How LLMs/AI work (training, neurons, transformers, tokens)
- How to start learning AI (free Python, Hugging Face, Codecademy, fast.ai, MIT OCW)
- How to build with AI (prompts, APIs, fine-tuning, RAG)
- AI ethics, bias, hallucinations, environmental impact
- AI careers (engineer, researcher, prompt engineer, AI safety, applied ML)
- Famous models (GPT, Claude, Gemini, Llama, Stable Diffusion)
- Common applications (chatbots, image gen, voice assistants, recommendation systems, computer vision)

Off-topic guardrails:
- If a student asks for homework help (essay writing, math problems, code without learning), gently redirect: "I'd love to help you UNDERSTAND that, but writing it for you skips the learning part. Want me to explain the concept instead?"
- If asked for personal advice, suggest they talk to a parent/teacher/counselor.
- If asked anything inappropriate, stay friendly but redirect to AI topics.

End every reply with a "Want to try?" or "Next step:" line that points to a free resource.`;

const STARTER_QUESTIONS = [
  "How does ChatGPT actually work?",
  "What's the difference between AI and a normal computer program?",
  "How do I start learning AI today, for free?",
  "Will AI take my future job?",
  "What's a 'neural network' really?",
  "How do AI models learn?",
  "Can I build my own chatbot?",
  "What's the coolest thing AI can do today?"
];

let learnConversation = [{ role: 'system', content: LEARN_SYSTEM_PROMPT }];

const learnView = document.getElementById('learnView');

function initLearnTab() {
  if (!learnView) return;

  const learnMessages = document.getElementById('learnMessages');
  const learnForm = document.getElementById('learnForm');
  const learnInput = document.getElementById('learnInput');
  const learnStarters = document.getElementById('learnStarters');

  // Render starter chips
  STARTER_QUESTIONS.forEach((q) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'learn-starter';
    btn.textContent = q;
    btn.onclick = () => sendLearnMessage(q);
    learnStarters.appendChild(btn);
  });

  // Initial greeting
  appendLearnMessage(
    "Hi! I'm an AI tutor here just to talk about AI. Curious how this app's chat works? Or how to build one yourself? Or what AI even is? Pick a starter below or type your own question. No question too basic.",
    'bot',
    {
      source: 'Built-in greeting (no AI used yet)',
      lesson: 'Even AI apps start with hard-coded greetings. Sometimes a fixed line is better than a generated one.'
    }
  );

  learnForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = learnInput.value.trim();
    if (!text) return;
    sendLearnMessage(text);
    learnInput.value = '';
  });
}

async function sendLearnMessage(text) {
  if (!text) return;
  const learnMessages = document.getElementById('learnMessages');
  const learnInput = document.getElementById('learnInput');
  if (learnInput) learnInput.value = '';

  appendLearnMessage(text, 'user');
  showLearnTyping();

  try {
    if (!hasGroqKey()) {
      hideLearnTyping();
      appendLearnMessage(
        "I can only really help when the Groq API key is set in config.js. Until then, I can't answer custom questions. Once it's set, I'll be ready to chat about anything AI.",
        'bot',
        { source: 'Disabled (no Groq key configured)' }
      );
      return;
    }

    learnConversation.push({ role: 'user', content: text });
    const recent = [learnConversation[0], ...learnConversation.slice(-9)];

    const reply = await callGroq(recent, { temperature: 0.6, max_tokens: 350 });
    learnConversation.push({ role: 'assistant', content: reply });

    hideLearnTyping();
    appendLearnMessage(reply, 'bot', {
      source: 'Live AI response (via GTA Apps Script proxy → Groq)',
      model: 'llama-3.1-8b-instant',
      systemPrompt: LEARN_SYSTEM_PROMPT,
      userMessage: text,
      response: reply,
      lesson: "This reply was generated by a different system prompt than the volunteer helper chat. Same model, different 'personality' — that's the power of prompts. Notice the message went through GTA's server first, so the API key stays private."
    });
  } catch (err) {
    hideLearnTyping();
    appendLearnMessage(
      "I had trouble reaching the AI just now. Try again in a moment — or rephrase the question.",
      'bot',
      { source: 'Error (network or API)' }
    );
    console.error(err);
  }
}

function appendLearnMessage(text, role, meta) {
  const learnMessages = document.getElementById('learnMessages');
  if (!learnMessages) return;
  const div = document.createElement('div');
  div.className = 'learn-msg ' + role;
  div.textContent = text;

  if (role === 'bot' && meta) {
    const peekWrap = document.createElement('div');
    peekWrap.className = 'learn-peek-wrap';
    peekWrap.innerHTML = `
      <button type="button" class="chat-peek-btn">🔍 How did the AI answer this?</button>
      <div class="chat-peek-panel" hidden>
        <div class="peek-row"><strong>Source:</strong> ${escapeHtml(meta.source || 'unknown')}</div>
        ${meta.model ? `<div class="peek-row"><strong>Model:</strong> ${escapeHtml(meta.model)}</div>` : ''}
        ${meta.systemPrompt ? `<details><summary>System prompt (the rules the AI follows)</summary><pre>${escapeHtml(meta.systemPrompt)}</pre></details>` : ''}
        ${meta.userMessage ? `<details><summary>Your question</summary><pre>${escapeHtml(meta.userMessage)}</pre></details>` : ''}
        ${meta.response ? `<details><summary>Raw AI response</summary><pre>${escapeHtml(meta.response)}</pre></details>` : ''}
        <p class="peek-takeaway">${escapeHtml(meta.lesson || 'AI is text-in, text-out. The prompt shapes everything.')}</p>
      </div>
    `;
    div.appendChild(peekWrap);
    const pBtn = peekWrap.querySelector('.chat-peek-btn');
    const pPanel = peekWrap.querySelector('.chat-peek-panel');
    pBtn.addEventListener('click', () => { pPanel.hidden = !pPanel.hidden; });
  }

  learnMessages.appendChild(div);
  learnMessages.scrollTop = learnMessages.scrollHeight;
}

function showLearnTyping() {
  const learnMessages = document.getElementById('learnMessages');
  const div = document.createElement('div');
  div.className = 'learn-msg bot typing';
  div.id = 'learnTyping';
  div.textContent = 'thinking…';
  learnMessages.appendChild(div);
  learnMessages.scrollTop = learnMessages.scrollHeight;
}
function hideLearnTyping() {
  const t = document.getElementById('learnTyping');
  if (t) t.remove();
}

// Initialize once DOM is ready (this script loads after others)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initLearnTab);
} else {
  initLearnTab();
}
