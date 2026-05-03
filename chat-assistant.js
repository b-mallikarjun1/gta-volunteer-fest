/* ============================================================
   Volunteer Form Chat Assistant
   - Floating chat widget that helps students fill out the form
   - Powered by Groq's free LLM API (llama-3.1-8b-instant)
   - Falls back to a built-in FAQ if no API key is set or API fails
   ============================================================ */

const chatFab = document.getElementById('chatFab');
const chatPanel = document.getElementById('chatPanel');
const chatClose = document.getElementById('chatClose');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');
const chatMessages = document.getElementById('chatMessages');

const SYSTEM_PROMPT = `You are a friendly, warm assistant helping middle school and high school students sign up to volunteer at the GTA International Fest, organized by the Global Telangana Association (GTA).

Your job:
- Help students complete the volunteer registration form
- Answer questions about what each field means
- Explain what kinds of volunteer roles are available at the GTA International Fest (a cultural festival celebrating Telugu and Telangana heritage — students help with registration desks, ushering guests, food/refreshment service, kids' activity areas, cultural program backstage support, photo/video assistance, parking, cleanup, etc.)
- Be encouraging — many of these students may be volunteering for the first time
- Keep answers SHORT (1-3 sentences max), warm, and age-appropriate

Important context:
- This form is run by GTA, NOT by the student's school. The student's school is just being asked so GTA knows where their volunteers come from.
- Parent/guardian consent is REQUIRED for every student volunteer.
- The "hours" field is an estimate of how many hours the student is willing to volunteer (e.g., 4 hours for a half-day shift, 8 hours for full-day).
- The "supervisor" field can be left as the GTA volunteer coordinator name if the student doesn't know it yet.

If a student asks something off-topic (homework, personal advice, inappropriate content), kindly redirect them to the form or to their parent/teacher. Never collect personal info beyond what the form asks for. If a student asks something specific about the event you do not know (date, exact venue, schedule), tell them the GTA team will share full event details after they register.`;

// Conversation history (kept in memory only, never saved)
let conversation = [{ role: 'system', content: SYSTEM_PROMPT }];

// Built-in FAQ — used as fallback when no API key or when API is down
const BUILTIN_FAQ = [
  {
    triggers: ['gta', 'who is gta', 'what is gta', 'global telangana'],
    answer: "GTA is the Global Telangana Association — a community organization that hosts the GTA International Fest, a cultural festival celebrating Telugu and Telangana heritage with music, dance, food, and family activities."
  },
  {
    triggers: ['fest', 'festival', 'event', 'international fest', 'what is the event'],
    answer: "The GTA International Fest is a one-day cultural festival hosted by the Global Telangana Association. The GTA team will email you exact date, venue, and schedule once you register."
  },
  {
    triggers: ['parent', 'consent', 'guardian', 'permission'],
    answer: "Yes — parent or guardian consent is required for every student volunteer. Your parent needs to give their name, contact info, and check the consent box at the bottom of section 2."
  },
  {
    triggers: ['role', 'roles', 'what can i do', 'what will i do', 'job', 'task'],
    answer: "Volunteer roles include the registration desk, ushering guests, food/refreshment service, kids' activity area, stage and cultural program support, photo/video help, parking, and cleanup. Pick whatever interests you in the 'Volunteer Role' field."
  },
  {
    triggers: ['hours', 'how many hours', 'time', 'how long'],
    answer: "Enter how many hours you can volunteer (whole or half hours). Half-day shifts are usually 4 hours, full-day around 8. The GTA team will assign your exact shift later."
  },
  {
    triggers: ['supervisor', 'who is supervisor', 'supervisor contact'],
    answer: "If you don't know your supervisor yet, write 'GTA Volunteer Coordinator' and use the GTA team email. The GTA team will assign your real supervisor before the event."
  },
  {
    triggers: ['description', 'what to write', 'describe', 'what do i put'],
    answer: "Just write a sentence about what you'd like to help with and any relevant skills. Example: 'I'd like to help at the registration desk. I'm friendly with strangers and can speak Telugu and English.'"
  },
  {
    triggers: ['school', 'which school', 'my school'],
    answer: "Just write the name of the school you currently attend (e.g., 'Lincoln Middle School'). GTA asks so they know which schools their volunteers are coming from."
  },
  {
    triggers: ['medical', 'allergy', 'medication', 'optional', 'allergies'],
    answer: "Medical info is optional but really helpful — please mention any food allergies (especially since the event has Indian food) or medication you carry. It helps GTA keep you safe during the event."
  },
  {
    triggers: ['student id', 'id number'],
    answer: "Student ID is optional — leave it blank if you don't have it handy. GTA doesn't need it to register you as a volunteer."
  },
  {
    triggers: ['language', 'telugu', 'english', 'speak'],
    answer: "You don't need to speak Telugu to volunteer! Many roles (registration, food service, kids' activities, cleanup) work great in English. If you do speak Telugu or Hindi, mention it in the description — GTA loves bilingual volunteers."
  },
  {
    triggers: ['food', 'meal', 'eat', 'lunch'],
    answer: "Yes — student volunteers usually get a free meal during their shift. Mention any allergies in the medical section so GTA can plan for you."
  },
  {
    triggers: ['certificate', 'community service', 'hours certificate', 'proof', 'credit'],
    answer: "Yes — after the event, come back to this app, tap the 'Submit Hours' tab, and log how many hours you actually volunteered. You'll get a downloadable hours receipt PDF that you can show your school for community-service credit."
  },
  {
    triggers: ['submit hours', 'log hours', 'after event', 'after volunteering', 'how do i log', 'record my hours'],
    answer: "After you've volunteered, open the app again and tap the '⏱️ Submit Hours' tab at the top. Enter the email and last name you used to register, the hours you volunteered, and a quick note. We'll match you to your registration and update GTA's records automatically."
  },
  {
    triggers: ["can't find", "couldn't find", 'no registration', 'cannot find', 'not found', 'didn\'t find'],
    answer: "If the app says it can't find your registration, double-check that the email and last name match exactly what you used to sign up. If you forgot, ask your parent — they got the registration receipt PDF when you signed up."
  },
  {
    triggers: ['offline', 'no internet', 'wifi'],
    answer: "No problem! The form works offline. Your registration saves on your device and is sent to GTA automatically once you're back online."
  },
  {
    triggers: ['pdf', 'report', 'receipt', 'download', 'copy'],
    answer: "When you submit, a PDF copy of your registration downloads to your device — keep it as your receipt. GTA also gets a copy automatically."
  },
  {
    triggers: ['friend', 'with my friend', 'together'],
    answer: "Volunteering with friends is encouraged! Each person needs to fill out their own form (with their own parent consent), but you can ask GTA to assign you to the same role/shift in the description box."
  },
  {
    triggers: ['cancel', 'change my mind', 'cant come', "can't come"],
    answer: "If your plans change, just email the GTA team — your contact info goes to them when you submit. They'll understand. The earlier you let them know, the better."
  },
  {
    triggers: ['email', 'didnt get email', "didn't get email", 'no email', 'confirmation email', 'check email'],
    answer: "After you submit, GTA sends a confirmation email to the email you registered with (and CCs your parent). If you don't see it within a few minutes, check your spam/junk folder. If it's still missing, the email address might have a typo — re-register or contact GTA."
  }
];

/* ----------------------- UI helpers ----------------------- */
function openChat() {
  chatPanel.classList.add('open');
  chatFab.style.display = 'none';
  if (chatMessages.children.length === 0) {
    showBotMessage("Namaste! 🙏 I'm the GTA volunteer helper. Ask me anything about signing up to volunteer at the GTA International Fest — what roles are available, what to put in each field, or what to expect on the day.", true);
  }
  setTimeout(() => chatInput.focus(), 100);
}
function closeChat() {
  chatPanel.classList.remove('open');
  chatFab.style.display = 'flex';
}
function appendMessage(text, role) {
  const div = document.createElement('div');
  div.className = 'chat-msg ' + role;
  div.textContent = text;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return div;
}
function showBotMessage(text, withSuggestions = false) {
  appendMessage(text, 'bot');
  if (withSuggestions) {
    const suggestions = ['What volunteer roles are available?', 'Do I need parent consent?', 'Will I get a community-service certificate?'];
    const wrap = document.createElement('div');
    wrap.className = 'chat-suggestions';
    suggestions.forEach(s => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = s;
      b.onclick = () => sendUserMessage(s);
      wrap.appendChild(b);
    });
    chatMessages.appendChild(wrap);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
}
function showTyping() {
  const div = document.createElement('div');
  div.className = 'chat-msg typing';
  div.id = 'typingIndicator';
  div.textContent = 'thinking…';
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}
function hideTyping() {
  const t = document.getElementById('typingIndicator');
  if (t) t.remove();
}

/* ----------------------- Built-in FAQ matcher ----------------------- */
function findFaqAnswer(question) {
  const q = question.toLowerCase();
  // Score each FAQ by trigger matches
  let best = null;
  let bestScore = 0;
  for (const item of BUILTIN_FAQ) {
    const score = item.triggers.filter(t => q.includes(t)).length;
    if (score > bestScore) { bestScore = score; best = item; }
  }
  return bestScore > 0 ? best.answer : null;
}

/* ----------------------- Groq API call ----------------------- */
async function askGroq(userMessage) {
  conversation.push({ role: 'user', content: userMessage });
  // Cap history at last 10 turns to keep context small
  const recent = [conversation[0], ...conversation.slice(-9)];

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CONFIG.groqApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'llama-3.1-8b-instant',
      messages: recent,
      temperature: 0.5,
      max_tokens: 200
    })
  });
  if (!res.ok) throw new Error(`Groq API: ${res.status}`);
  const data = await res.json();
  const reply = data.choices?.[0]?.message?.content?.trim();
  if (!reply) throw new Error('No reply from API');
  conversation.push({ role: 'assistant', content: reply });
  return reply;
}

/* ----------------------- Main message handler ----------------------- */
async function sendUserMessage(text) {
  if (!text || !text.trim()) return;
  appendMessage(text, 'user');
  chatInput.value = '';
  showTyping();

  try {
    let reply;
    const hasGroqKey = CONFIG.groqApiKey
      && CONFIG.groqApiKey.length > 10
      && !CONFIG.groqApiKey.includes('YOUR_GROQ_KEY');

    if (hasGroqKey && navigator.onLine) {
      try {
        reply = await askGroq(text);
      } catch (apiErr) {
        // If Groq fails (rate limit, network, bad key), fall back to FAQ
        console.warn('Groq fallback:', apiErr);
        reply = findFaqAnswer(text)
          || "I'm having trouble reaching my AI brain right now. Try one of the suggested questions, or check the form's section labels — they explain each field.";
      }
    } else {
      // No API key configured — use FAQ
      reply = findFaqAnswer(text)
        || "I can answer common questions about the form — try asking about parent consent, what counts as volunteer hours, or what to write in the description.";
    }

    hideTyping();
    appendMessage(reply, 'bot');
  } catch (err) {
    hideTyping();
    appendMessage("Something went wrong. Please try again.", 'bot');
    console.error(err);
  }
}

/* ----------------------- Wire up events ----------------------- */
chatFab.addEventListener('click', openChat);
chatClose.addEventListener('click', closeChat);
chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  sendUserMessage(chatInput.value);
});
