/*
 * arena-data.js - Answer Arena built-in defaults (single source of truth).
 *
 * Exposed as window.ARENA_DEFAULTS and consumed by arena-app.js (participant
 * flow), arena-store.js (local fallback seed) and admin.js ("Restore built-in
 * default" buttons).
 *
 * PLACEHOLDERS: the 20 defaultTasks below are random, self-contained sample
 * tasks with two made-up answers each, only so the app has realistic content
 * to show. Replace them with the real tasks + two-model outputs (edit here, or
 * upload an Excel with columns task, outputA, outputB in the admin). Model
 * identities are intentionally omitted and must never be shown to participants.
 */
window.ARENA_DEFAULTS = {
  "app": {
    "name": "Answer Arena",
    "tagline": "Which answer do you prefer?",
    "version": "0.2.0"
  },
  "texts": {
    "welcomeTitle": "Welcome to Answer Arena",
    "welcomeIntro": "Help us learn what makes an answer <i>better</i>.",
    "welcomeBody": [
      "You will be shown a sequence of everyday work tasks. For each task you will see <b>two different answers</b>, side by side, written by two different systems.",
      "Your job is simple: tap the answer you <b>prefer</b> - or mark them <b>equally good</b> if you cannot separate them. There are no right or wrong choices; we just want your honest judgement.",
      "It takes about 5-10 minutes - please set aside enough time to finish it in one sitting."
    ],
    "welcomeButton": "Take a quick tour",
    "loginLink": "I already have an account",
    "tourTitle": "Quick tour",
    "trainingTitle": "Let's practice",
    "trainingBody": "Here is one practice comparison. Try tapping the answer you prefer, or mark them equal. <b>Nothing here is recorded</b> - it is just to get the feel of it. When you are ready, start the real comparisons.",
    "trainingButton": "I'm ready - start",
    "registerTitle": "Create your account",
    "registerIntro": "A few quick details before you begin. Your e-mail is used only to let you log back in.",
    "loginTitle": "Log in",
    "mainTitle": "Your comparisons",
    "mainIntro": "Read the task, then tap the answer you prefer - or mark them equally good - and press Next.",
    "surveyTitle": "One last thing",
    "surveyIntro": "A few short questions about your experience (all fields are required).",
    "thankyouTitle": "All done - thank you!",
    "thankyouBody": "You have completed every comparison and your preferences have been saved. We really appreciate your time and your honest judgement. You may now close this tab."
  },
  "tourSteps": [
    {
      "target": "task",
      "title": "The problem",
      "body": "Each round starts with a short problem - a real situation or need someone has. Read it here first."
    },
    {
      "target": "answerLeft",
      "title": "Answer A",
      "body": "This is one answer to the problem. Two different systems wrote the two answers - we never tell you which is which."
    },
    {
      "target": "answerRight",
      "title": "Answer B",
      "body": "This is the other answer to the same problem. Compare it with Answer A."
    },
    {
      "target": "answerLeft",
      "title": "Tap the better answer",
      "body": "Tap the answer card you prefer. It gets highlighted so you can see your pick, and you can change it before moving on."
    },
    {
      "target": "tie",
      "title": "Or call it a tie",
      "body": "If the two answers are equally good (or equally bad), tap “They're equally good”."
    },
    {
      "target": "follow",
      "title": "Rate each answer and say why",
      "body": "After you choose, rate how satisfied you are with <b>each</b> answer (1-5) and add a short reason. All three are required before you can continue."
    },
    {
      "target": "progress",
      "title": "Track your progress",
      "body": "This bar shows how far along you are through your set of comparisons."
    },
    {
      "target": "next",
      "title": "Move on",
      "body": "Once you have chosen, rated both answers and written a reason, tap Next to lock it in and see the next problem. That's it - you're ready!"
    }
  ],
  "settings": {
    "randomizeOrder": true,
    "comparisonsPerUser": 0,
    "longList": false,
    "requireSessionCode": true,
    "twoByTwo": {
      "factors": {
        "transparency": false,
        "incentive": false
      }
    }
  },
  "registrationQuestions": [
    {
      "id": "participantId",
      "label": "Participant ID",
      "type": "text",
      "required": false,
      "system": "participantId",
      "help": "If you were given an ID (e.g. a Prolific ID), enter it here. Otherwise leave blank."
    },
    {
      "id": "email",
      "label": "E-mail",
      "type": "email",
      "required": true,
      "system": "email",
      "help": "Used only so you can log back in."
    },
    {
      "id": "password",
      "label": "Password",
      "type": "password",
      "required": true,
      "system": "password",
      "help": "At least 6 characters."
    },
    {
      "id": "consent",
      "label": "I agree to take part in this short study and to have my anonymous responses recorded.",
      "type": "radio",
      "required": true,
      "options": [
        "Yes"
      ]
    },
    {
      "id": "age",
      "label": "Age",
      "type": "number",
      "required": true
    },
    {
      "id": "gender",
      "label": "Gender",
      "type": "select",
      "required": true,
      "options": [
        "Female",
        "Male",
        "Non-binary",
        "Prefer not to say"
      ]
    },
    {
      "id": "education",
      "label": "Highest level of education",
      "type": "select",
      "required": true,
      "options": [
        "High school",
        "Bachelor",
        "Master",
        "PhD",
        "Other"
      ]
    },
    {
      "id": "occupation",
      "label": "Which best describes your role?",
      "type": "select",
      "required": true,
      "options": [
        "Student",
        "Operations / supply chain",
        "Finance / accounting",
        "HR / people",
        "Sales / marketing",
        "Engineering / IT",
        "Management",
        "Other"
      ]
    },
    {
      "id": "aiUse",
      "label": "How often do you use generative AI tools (e.g. chatbots)?",
      "type": "select",
      "required": true,
      "options": [
        "Never",
        "A few times a year",
        "Monthly",
        "Weekly",
        "Daily"
      ]
    },
    {
      "id": "aiFamiliarity",
      "label": "How familiar are you with the differences between AI models (e.g. small vs large models)?",
      "type": "select",
      "required": true,
      "options": [
        "Not at all",
        "Slightly",
        "Moderately",
        "Very",
        "Expert"
      ]
    },
    {
      "id": "englishFluency",
      "label": "English fluency",
      "type": "select",
      "required": true,
      "options": [
        "Basic",
        "Intermediate",
        "Fluent",
        "Native"
      ]
    }
  ],
  "surveyQuestions": [
    {
      "id": "s_clarity",
      "label": "How clear were the tasks and instructions?",
      "type": "select",
      "required": true,
      "options": [
        "Very unclear",
        "Unclear",
        "Neutral",
        "Clear",
        "Very clear"
      ]
    },
    {
      "id": "s_confidence",
      "label": "How confident were you in your preferences?",
      "type": "select",
      "required": true,
      "options": [
        "Not at all",
        "Slightly",
        "Moderately",
        "Very",
        "Completely"
      ]
    },
    {
      "id": "s_difficulty",
      "label": "How hard was it to tell the two answers apart?",
      "type": "select",
      "required": true,
      "options": [
        "Very easy",
        "Easy",
        "Moderate",
        "Hard",
        "Very hard"
      ]
    },
    {
      "id": "s_basis",
      "label": "When the answers differed, what mattered most to your choice?",
      "type": "select",
      "required": true,
      "options": [
        "Accuracy / correctness",
        "Completeness / detail",
        "Clarity / readability",
        "Tone / style",
        "Length (shorter)",
        "Length (longer)",
        "Other"
      ]
    },
    {
      "id": "s_basis_other",
      "label": "If “other”, what was it? (optional)",
      "type": "text",
      "required": false
    },
    {
      "id": "s_ai_guess",
      "label": "Did you assume the answers were written by AI?",
      "type": "radio",
      "required": true,
      "options": [
        "Yes",
        "No",
        "Unsure"
      ]
    },
    {
      "id": "s_comments",
      "label": "Any comments or feedback for us?",
      "type": "textarea",
      "required": false
    }
  ],
  "practiceTask": {
    "id": "PRACTICE",
    "domain": "Practice",
    "complexity": "Simple",
    "title": "Name a small office plant",
    "task": "Our team adopted a little potted plant for the office. Suggest a friendly name for it and one short sentence on why it fits.",
    "outputA": "Name: “Sprout.”\n\nIt is short, cheerful, and captures the idea of something small that is just starting to grow - easy for everyone to remember.\n\n(Practice answer - not recorded.)",
    "outputB": "How about “Leafy McGreenface”?\n\nIt is a playful nod to internet naming polls, it always gets a smile in meetings, and it gives the plant some personality the whole team can rally around.\n\n(Practice answer - not recorded.)"
  },
  "defaultTasks": [
    {
      "id": "T01",
      "domain": "Writing",
      "complexity": "Simple",
      "title": "Decline a meeting politely",
      "task": "Reply to this meeting invite, declining because of a scheduling conflict but keeping the door open. Invite: “Can you join the planning sync Thursday at 3pm?”",
      "outputA": "Thanks for the invite! I have a conflict at 3pm Thursday, so I won’t be able to join. Could you share the notes afterward, or would another time this week work? Happy to contribute async in the meantime.",
      "outputB": "No, I can’t make Thursday at 3."
    },
    {
      "id": "T02",
      "domain": "Summarization",
      "complexity": "Simple",
      "title": "Summarize in one sentence",
      "task": "Summarize this in one sentence: “The committee reviewed three proposals, rejected the first for budget reasons, tabled the second pending legal review, and approved the third with minor timeline changes.”",
      "outputA": "The committee approved the third proposal with small timeline changes, tabled the second for legal review, and rejected the first over budget.",
      "outputB": "They looked at some proposals and made decisions about them."
    },
    {
      "id": "T03",
      "domain": "Coding",
      "complexity": "Simple",
      "title": "Reverse a string",
      "task": "Write a Python function that returns a string reversed.",
      "outputA": "def reverse(s):\n    return s[::-1]",
      "outputB": "def reverse(s):\n    result = ''\n    for ch in s:\n        result = ch + result\n    return result"
    },
    {
      "id": "T04",
      "domain": "Math & Reasoning",
      "complexity": "Simple",
      "title": "Split a bill with tip",
      "task": "A dinner bill is $87.50. Split it evenly among 5 people and add an 18% tip. How much does each person pay?",
      "outputA": "Bill with 18% tip: 87.50 × 1.18 = $103.25. Divided by 5 = $20.65 each.",
      "outputB": "Each person pays about $17.50 plus tip, so roughly $20."
    },
    {
      "id": "T05",
      "domain": "Translation",
      "complexity": "Simple",
      "title": "Translate a request to French",
      "task": "Translate to French: “Could you send me the report by Friday, please?”",
      "outputA": "Pourriez-vous m’envoyer le rapport d’ici vendredi, s’il vous plaît ?",
      "outputB": "Peux-tu m’envoyer le rapport avant vendredi ?"
    },
    {
      "id": "T06",
      "domain": "Creative & Marketing",
      "complexity": "Simple",
      "title": "Coffee-shop tagline",
      "task": "Write a short tagline for a neighbourhood coffee shop called “Morning Loop”.",
      "outputA": "Morning Loop — your daily orbit starts here.",
      "outputB": "Good coffee, every morning."
    },
    {
      "id": "T07",
      "domain": "Writing",
      "complexity": "Simple",
      "title": "Newsletter subject line",
      "task": "Write an email subject line for a newsletter announcing a 20% summer sale that ends Sunday.",
      "outputA": "20% off ends Sunday — grab your summer pick",
      "outputB": "Newsletter: Summer Sale Information Inside"
    },
    {
      "id": "T08",
      "domain": "Knowledge Q&A",
      "complexity": "Simple",
      "title": "Explain an API simply",
      "task": "Explain what an API is to someone non-technical, in two sentences.",
      "outputA": "An API is like a waiter at a restaurant: you ask for what you want, the kitchen (another program) prepares it, and the waiter brings it back. It lets two pieces of software talk to each other without either needing to know how the other works inside.",
      "outputB": "An API is an Application Programming Interface that exposes endpoints over HTTP using methods like GET and POST to transfer JSON payloads between systems."
    },
    {
      "id": "T09",
      "domain": "Review & QA",
      "complexity": "Simple",
      "title": "Fix the grammar",
      "task": "Fix the grammar: “Me and him was going to the store but we forgot it’s address.”",
      "outputA": "He and I were going to the store, but we forgot its address.",
      "outputB": "Me and him were going to the store, but we forgot it’s address."
    },
    {
      "id": "T10",
      "domain": "Planning & Strategy",
      "complexity": "Simple",
      "title": "Dinner from ingredients",
      "task": "Suggest a simple dinner using eggs, spinach, onion, and bread.",
      "outputA": "Make a spinach and onion frittata: sauté a diced onion and a handful of spinach, pour over 4 beaten eggs, cook until set, and serve with toasted bread. About 15 minutes.",
      "outputB": "You could cook the eggs and eat them with the bread and vegetables."
    },
    {
      "id": "T11",
      "domain": "Creative & Marketing",
      "complexity": "Simple",
      "title": "Product description",
      "task": "Write a one-line product description for a stainless steel water bottle that keeps drinks cold for 24 hours.",
      "outputA": "Ice-cold for 24 hours — a durable stainless steel bottle that keeps every sip refreshing, from morning runs to all-day desk life.",
      "outputB": "A water bottle made of stainless steel that holds liquid."
    },
    {
      "id": "T12",
      "domain": "Math & Reasoning",
      "complexity": "Simple",
      "title": "Convert ml to ounces",
      "task": "A recipe needs 250 ml of milk but your measuring cup is in fluid ounces. About how many fluid ounces is that?",
      "outputA": "250 ml is about 8.5 US fluid ounces (1 fl oz ≈ 29.6 ml).",
      "outputB": "250 ml is roughly 12 fluid ounces."
    },
    {
      "id": "T13",
      "domain": "Customer Support",
      "complexity": "Simple",
      "title": "Ask for a deadline extension",
      "task": "Write a short Slack message to your manager asking for a two-day extension on a report because a data source was delayed.",
      "outputA": "Hi [name] — quick heads-up: the vendor data I need came in late, so I’d like to move the report deadline from Wednesday to Friday to keep the quality up. Does that work? Happy to share a draft of what’s done so far.",
      "outputB": "I need more time on the report. Can I have two more days?"
    },
    {
      "id": "T14",
      "domain": "Creative & Marketing",
      "complexity": "Simple",
      "title": "Name a subscription box",
      "task": "Brainstorm three name ideas for a houseplant subscription box.",
      "outputA": "1) Leaf It To Us\n2) The Monthly Sprout\n3) Potted & Posted",
      "outputB": "Plant Box, Green Box, Plant Subscription"
    },
    {
      "id": "T15",
      "domain": "Summarization",
      "complexity": "Simple",
      "title": "Pros and cons of remote work",
      "task": "List two pros and two cons of remote work, briefly.",
      "outputA": "Pros: no commute (saves time and money) and flexible scheduling. Cons: harder to separate work from home, and fewer spontaneous team interactions.",
      "outputB": "Remote work has good things and bad things depending on the person."
    },
    {
      "id": "T16",
      "domain": "Coding",
      "complexity": "Simple",
      "title": "Basic email regex",
      "task": "Write a simple regex that matches a basic email address like name@example.com.",
      "outputA": "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$",
      "outputB": "Just check that the text contains an @ symbol: /@/"
    },
    {
      "id": "T17",
      "domain": "Writing",
      "complexity": "Simple",
      "title": "Invoice payment reminder",
      "task": "Write a polite reminder that invoice #1043 for $1,200 was due last week.",
      "outputA": "Hi [name], a friendly reminder that invoice #1043 for $1,200 was due on [date] and is now a little overdue. Could you let me know when we can expect payment? Happy to resend the invoice if that helps — thank you!",
      "outputB": "Your invoice #1043 is late. Please pay $1,200 immediately."
    },
    {
      "id": "T18",
      "domain": "Creative & Marketing",
      "complexity": "Simple",
      "title": "Haiku about autumn",
      "task": "Write a haiku about autumn (5-7-5 syllables).",
      "outputA": "Crisp leaves let go now —\nthe maple counts its red coins\ninto quiet wind.",
      "outputB": "Autumn is here now\nThe leaves are falling from trees\nIt is getting cold"
    },
    {
      "id": "T19",
      "domain": "Knowledge Q&A",
      "complexity": "Simple",
      "title": "HTTP vs HTTPS",
      "task": "In one or two sentences, what is the difference between HTTP and HTTPS?",
      "outputA": "HTTPS is HTTP with encryption (TLS): the data sent between your browser and the website is scrambled so others can’t read or tamper with it. Plain HTTP sends everything in the clear.",
      "outputB": "HTTPS has an S at the end and HTTP does not. They are both used for websites."
    },
    {
      "id": "T20",
      "domain": "Planning & Strategy",
      "complexity": "Simple",
      "title": "Make a 3-item to-do",
      "task": "Turn this into a clear 3-item to-do list: “I need to reply to the client, prep slides for the 11am, and book a dentist appointment.”",
      "outputA": "1) Reply to the client (first — time-sensitive)\n2) Prep slides for the 11am meeting\n3) Book a dentist appointment (when free)",
      "outputB": "- reply client\n- slides\n- dentist"
    }
  ]
};
