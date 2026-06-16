/*
 * arena-data.js - Answer Arena built-in defaults (single source of truth).
 *
 * Exposed as window.ARENA_DEFAULTS and consumed by arena-app.js (participant
 * flow), arena-store.js (local fallback seed) and admin.js ("Restore built-in
 * default" buttons). Editing a value here changes the built-in default that
 * the admin panel can always revert to.
 *
 * PLACEHOLDERS: defaultTasks below are 20 real everyday task PROMPTS, but each
 * task's outputA/outputB are PLACEHOLDER answers, written only to exercise the
 * UI. Replace them with the real two-model outputs (here, or by uploading an
 * Excel with columns: task, outputA, outputB in the admin Tasks tab). Model
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
      "It takes about 5-10 minutes. Your place is saved as you go, so you can pause and come back."
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
      "title": "The task",
      "body": "Each round starts with a single task, shown here as a card. Read what is being asked."
    },
    {
      "target": "answerLeft",
      "title": "Answer A",
      "body": "This is one answer to the task. Two different systems wrote the two answers - we do not tell you which is which."
    },
    {
      "target": "answerRight",
      "title": "Answer B",
      "body": "This is the other answer to the same task. Compare it with Answer A."
    },
    {
      "target": "answerLeft",
      "title": "Tap to choose",
      "body": "Tap the answer card you prefer. It gets highlighted so you can see your pick. You can change it before moving on."
    },
    {
      "target": "tie",
      "title": "Or call it a tie",
      "body": "If the two answers are equally good (or equally bad), tap “They're equally good”."
    },
    {
      "target": "progress",
      "title": "Track your progress",
      "body": "This bar shows how far along you are. You can leave and come back - your place is saved."
    },
    {
      "target": "next",
      "title": "Move on",
      "body": "Once you have made a choice, tap Next to lock it in and see the following task. That's it - you're ready!"
    }
  ],
  "settings": {
    "randomizeOrder": true,
    "comparisonsPerUser": 0,
    "requireSessionCode": false,
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
      "help": "Used only so you can log back in and resume."
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
      "id": "T001",
      "domain": "Writing",
      "complexity": "Simple",
      "title": "Polish a blunt internal message for tone",
      "task": "Rewrite this message so it declines the suggestion clearly but stays respectful and keeps the supervisor motivated to raise ideas again. Add a brief reason and a constructive next step, and keep it to a few sentences. Message: 'No, we can't move the cycle counts to mornings, that won't work, we already tried it.'",
      "outputA": "Here is a direct, no-frills attempt to polish a blunt internal message for tone.\n\nI kept it short: the core ask is handled in a few clear lines, with plain language and no padding. It is easy to scan and ready to use as-is for a writing task of this kind.\n\n(Placeholder output - style: concise & direct. Replace with a real model output.)",
      "outputB": "Let me work through how to polish a blunt internal message for tone more thoroughly.\n\n- First, I restate the goal and the key constraints so nothing is missed.\n- Then I lay out the response step by step, with a little reasoning for each choice.\n- Finally, I add a short note on edge cases and what I would double-check.\n\nThis version trades brevity for completeness and structure, which can help on a more involved writing task.\n\n(Placeholder output - style: detailed & structured. Replace with a real model output.)"
    },
    {
      "id": "T013",
      "domain": "Summarization",
      "complexity": "Simple",
      "title": "Summarize a meeting transcript into decisions and actions",
      "task": "Read this transcript and produce two sections, Decisions and Action items (owner and due date where stated), keeping only what was decided or assigned and dropping small talk. Transcript: 'Maria: Did everyone see the demand forecast? Tom: Up 9 percent but the supplier in Vietnam is behind. Maria: Are we agreed we shift 20 percent of the order to the backup supplier? Tom: Yes if quality passes. Priya: QC can clear the backup samples by the 10th. Maria: Then we shift today. Priya, own the QC sign-off? Priya: Yes, by the 10th. Tom: We still have not set the safety-stock level for the new SKU.…",
      "outputA": "Here is a direct, no-frills attempt to summarize a meeting transcript into decisions and actions.\n\nI kept it short: the core ask is handled in a few clear lines, with plain language and no padding. It is easy to scan and ready to use as-is for a summarization task of this kind.\n\n(Placeholder output - style: concise & direct. Replace with a real model output.)",
      "outputB": "Let me work through how to summarize a meeting transcript into decisions and actions more thoroughly.\n\n- First, I restate the goal and the key constraints so nothing is missed.\n- Then I lay out the response step by step, with a little reasoning for each choice.\n- Finally, I add a short note on edge cases and what I would double-check.\n\nThis version trades brevity for completeness and structure, which can help on a more involved summarization task.\n\n(Placeholder output - style: detailed & structured. Replace with a real model output.)"
    },
    {
      "id": "T022",
      "domain": "Knowledge Q&A",
      "complexity": "Simple",
      "title": "Answer a question from a long internal document",
      "task": "Using only this policy, answer the question. Policy: 'Goods may be returned within 30 days of receipt for full credit if unused and in original packaging. Custom or made-to-order items are non-returnable. Damaged or defective goods must be reported within 5 business days of receipt with photos of the damage and the packing slip; the supplier covers return freight and either replaces the goods or issues full credit, buyer's choice. For standard returns, the buyer pays return freight unless the error was the supplier's. Credits are issued 7 to 10 business days after returned goods are received…",
      "outputA": "Here is a direct, no-frills attempt to answer a question from a long internal document.\n\nI kept it short: the core ask is handled in a few clear lines, with plain language and no padding. It is easy to scan and ready to use as-is for a knowledge q&a task of this kind.\n\n(Placeholder output - style: concise & direct. Replace with a real model output.)",
      "outputB": "Let me work through how to answer a question from a long internal document more thoroughly.\n\n- First, I restate the goal and the key constraints so nothing is missed.\n- Then I lay out the response step by step, with a little reasoning for each choice.\n- Finally, I add a short note on edge cases and what I would double-check.\n\nThis version trades brevity for completeness and structure, which can help on a more involved knowledge q&a task.\n\n(Placeholder output - style: detailed & structured. Replace with a real model output.)"
    },
    {
      "id": "T042",
      "domain": "Math & Reasoning",
      "complexity": "Simple",
      "title": "Solve everyday business arithmetic",
      "task": "Solve and show the arithmetic: a buyer orders 7 pallets of stock at 320 dollars each against a budget line of 2,500 dollars. Give the total cost, how much of the budget is left, and the cost per pallet. State each number clearly.",
      "outputA": "Here is a direct, no-frills attempt to solve everyday business arithmetic.\n\nI kept it short: the core ask is handled in a few clear lines, with plain language and no padding. It is easy to scan and ready to use as-is for a math & reasoning task of this kind.\n\n(Placeholder output - style: concise & direct. Replace with a real model output.)",
      "outputB": "Let me work through how to solve everyday business arithmetic more thoroughly.\n\n- First, I restate the goal and the key constraints so nothing is missed.\n- Then I lay out the response step by step, with a little reasoning for each choice.\n- Finally, I add a short note on edge cases and what I would double-check.\n\nThis version trades brevity for completeness and structure, which can help on a more involved math & reasoning task.\n\n(Placeholder output - style: detailed & structured. Replace with a real model output.)"
    },
    {
      "id": "T031",
      "domain": "Coding",
      "complexity": "Simple",
      "title": "Write a simple, self-contained function",
      "task": "Write a Python function is_valid_sku(s) that returns True if s is a valid SKU in the format two uppercase letters, a hyphen, then six digits (for example 'AB-123456') and False otherwise. Include a docstring and three example calls. Standard library only.",
      "outputA": "Here is a direct, no-frills attempt to write a simple, self-contained function.\n\nI kept it short: the core ask is handled in a few clear lines, with plain language and no padding. It is easy to scan and ready to use as-is for a coding task of this kind.\n\n(Placeholder output - style: concise & direct. Replace with a real model output.)",
      "outputB": "Let me work through how to write a simple, self-contained function more thoroughly.\n\n- First, I restate the goal and the key constraints so nothing is missed.\n- Then I lay out the response step by step, with a little reasoning for each choice.\n- Finally, I add a short note on edge cases and what I would double-check.\n\nThis version trades brevity for completeness and structure, which can help on a more involved coding task.\n\n(Placeholder output - style: detailed & structured. Replace with a real model output.)"
    },
    {
      "id": "T050",
      "domain": "Data Analysis",
      "complexity": "Simple",
      "title": "Compute a basic statistic from numbers",
      "task": "From these daily units shipped for a week, 1200, 1350, 1000, 1450, 1300, 1500, 1100, calculate the average daily units shipped and name the highest day's figure. Show the sum and division. Keep it short for a non-technical reader.",
      "outputA": "Here is a direct, no-frills attempt to compute a basic statistic from numbers.\n\nI kept it short: the core ask is handled in a few clear lines, with plain language and no padding. It is easy to scan and ready to use as-is for a data analysis task of this kind.\n\n(Placeholder output - style: concise & direct. Replace with a real model output.)",
      "outputB": "Let me work through how to compute a basic statistic from numbers more thoroughly.\n\n- First, I restate the goal and the key constraints so nothing is missed.\n- Then I lay out the response step by step, with a little reasoning for each choice.\n- Finally, I add a short note on edge cases and what I would double-check.\n\nThis version trades brevity for completeness and structure, which can help on a more involved data analysis task.\n\n(Placeholder output - style: detailed & structured. Replace with a real model output.)"
    },
    {
      "id": "T058",
      "domain": "Extraction & Classification",
      "complexity": "Simple",
      "title": "Extract structured fields from messy text",
      "task": "From these notes, pull out each shipment's carrier, tracking number, origin, and promised delivery date, as a clean table with one shipment per row, only those four fields. Notes: 'Spoke to FastFreight, tracking FF889201, leaving Chicago, promised the 14th. Then RoadRunner, RR-55120, out of Dallas, says the 16th. Last was BlueLine, BL7741, from Atlanta, committed to the 13th.'",
      "outputA": "Here is a direct, no-frills attempt to extract structured fields from messy text.\n\nI kept it short: the core ask is handled in a few clear lines, with plain language and no padding. It is easy to scan and ready to use as-is for a extraction & classification task of this kind.\n\n(Placeholder output - style: concise & direct. Replace with a real model output.)",
      "outputB": "Let me work through how to extract structured fields from messy text more thoroughly.\n\n- First, I restate the goal and the key constraints so nothing is missed.\n- Then I lay out the response step by step, with a little reasoning for each choice.\n- Finally, I add a short note on edge cases and what I would double-check.\n\nThis version trades brevity for completeness and structure, which can help on a more involved extraction & classification task.\n\n(Placeholder output - style: detailed & structured. Replace with a real model output.)"
    },
    {
      "id": "T089",
      "domain": "Translation",
      "complexity": "Simple",
      "title": "Translate short everyday phrases",
      "task": "Translate these into natural, friendly Spanish for a customer-support chat, each on its own line in order: 'Hello, how can I help you today? I am sorry for the trouble. Let me check your order. Your refund has been processed. Thank you for your patience.'",
      "outputA": "Here is a direct, no-frills attempt to translate short everyday phrases.\n\nI kept it short: the core ask is handled in a few clear lines, with plain language and no padding. It is easy to scan and ready to use as-is for a translation task of this kind.\n\n(Placeholder output - style: concise & direct. Replace with a real model output.)",
      "outputB": "Let me work through how to translate short everyday phrases more thoroughly.\n\n- First, I restate the goal and the key constraints so nothing is missed.\n- Then I lay out the response step by step, with a little reasoning for each choice.\n- Finally, I add a short note on edge cases and what I would double-check.\n\nThis version trades brevity for completeness and structure, which can help on a more involved translation task.\n\n(Placeholder output - style: detailed & structured. Replace with a real model output.)"
    },
    {
      "id": "T075",
      "domain": "Creative & Marketing",
      "complexity": "Simple",
      "title": "Generate slogans or taglines",
      "task": "Write three short, catchy taglines for a reusable stainless-steel water-bottle brand aimed at active, eco-conscious people. Each under ten words, upbeat, easy to remember, suitable for packaging and social. Number them.",
      "outputA": "Here is a direct, no-frills attempt to generate slogans or taglines.\n\nI kept it short: the core ask is handled in a few clear lines, with plain language and no padding. It is easy to scan and ready to use as-is for a creative & marketing task of this kind.\n\n(Placeholder output - style: concise & direct. Replace with a real model output.)",
      "outputB": "Let me work through how to generate slogans or taglines more thoroughly.\n\n- First, I restate the goal and the key constraints so nothing is missed.\n- Then I lay out the response step by step, with a little reasoning for each choice.\n- Finally, I add a short note on edge cases and what I would double-check.\n\nThis version trades brevity for completeness and structure, which can help on a more involved creative & marketing task.\n\n(Placeholder output - style: detailed & structured. Replace with a real model output.)"
    },
    {
      "id": "T083",
      "domain": "Customer Support",
      "complexity": "Simple",
      "title": "Draft a routine support reply",
      "task": "Write a clear, friendly support reply answering how to reset a password: from the login page, click Forgot Password, enter the account email, follow the link sent, and set a new one. Add what to do if the email does not arrive. Keep it short and numbered.",
      "outputA": "Here is a direct, no-frills attempt to draft a routine support reply.\n\nI kept it short: the core ask is handled in a few clear lines, with plain language and no padding. It is easy to scan and ready to use as-is for a customer support task of this kind.\n\n(Placeholder output - style: concise & direct. Replace with a real model output.)",
      "outputB": "Let me work through how to draft a routine support reply more thoroughly.\n\n- First, I restate the goal and the key constraints so nothing is missed.\n- Then I lay out the response step by step, with a little reasoning for each choice.\n- Finally, I add a short note on edge cases and what I would double-check.\n\nThis version trades brevity for completeness and structure, which can help on a more involved customer support task.\n\n(Placeholder output - style: detailed & structured. Replace with a real model output.)"
    },
    {
      "id": "T067",
      "domain": "Planning & Strategy",
      "complexity": "Simple",
      "title": "Create a simple ordered checklist",
      "task": "Create a simple ordered checklist for running a weekly cycle count in a warehouse. Cover selecting which SKUs to count, freezing movement in the count zone, counting and recording, reconciling any differences against the system, and reporting the results. Keep each step short and practical, as a numbered list.",
      "outputA": "Here is a direct, no-frills attempt to create a simple ordered checklist.\n\nI kept it short: the core ask is handled in a few clear lines, with plain language and no padding. It is easy to scan and ready to use as-is for a planning & strategy task of this kind.\n\n(Placeholder output - style: concise & direct. Replace with a real model output.)",
      "outputB": "Let me work through how to create a simple ordered checklist more thoroughly.\n\n- First, I restate the goal and the key constraints so nothing is missed.\n- Then I lay out the response step by step, with a little reasoning for each choice.\n- Finally, I add a short note on edge cases and what I would double-check.\n\nThis version trades brevity for completeness and structure, which can help on a more involved planning & strategy task.\n\n(Placeholder output - style: detailed & structured. Replace with a real model output.)"
    },
    {
      "id": "T099",
      "domain": "Review & QA",
      "complexity": "Simple",
      "title": "Review for consistency with a style guide",
      "task": "Check this label text against these format rules and list every violation with a fix. Rules: dates in YYYY-MM-DD, weights in kg with one decimal, no exclamation marks, use 'Ship to' not 'Sending to'. Label: 'Sending to: Acme Warehouse. Ship date 3/7/25. Weight: 12 kg. Handle with care!'",
      "outputA": "Here is a direct, no-frills attempt to review for consistency with a style guide.\n\nI kept it short: the core ask is handled in a few clear lines, with plain language and no padding. It is easy to scan and ready to use as-is for a review & qa task of this kind.\n\n(Placeholder output - style: concise & direct. Replace with a real model output.)",
      "outputB": "Let me work through how to review for consistency with a style guide more thoroughly.\n\n- First, I restate the goal and the key constraints so nothing is missed.\n- Then I lay out the response step by step, with a little reasoning for each choice.\n- Finally, I add a short note on edge cases and what I would double-check.\n\nThis version trades brevity for completeness and structure, which can help on a more involved review & qa task.\n\n(Placeholder output - style: detailed & structured. Replace with a real model output.)"
    },
    {
      "id": "T002",
      "domain": "Writing",
      "complexity": "Complex",
      "title": "Draft a high-stakes external message",
      "task": "Write an email telling a freight carrier we have used for four years that we will not renew our transportation contract when it ends next quarter. Be clear and final, thank them sincerely for the service and reliability, avoid blame, and leave the door open to work together again during peak season. Keep a calm, professional tone.",
      "outputA": "Here is a direct, no-frills attempt to draft a high-stakes external message.\n\nI kept it short: the core ask is handled in a few clear lines, with plain language and no padding. It is easy to scan and ready to use as-is for a writing task of this kind.\n\n(Placeholder output - style: concise & direct. Replace with a real model output.)",
      "outputB": "Let me work through how to draft a high-stakes external message more thoroughly.\n\n- First, I restate the goal and the key constraints so nothing is missed.\n- Then I lay out the response step by step, with a little reasoning for each choice.\n- Finally, I add a short note on edge cases and what I would double-check.\n\nThis version trades brevity for completeness and structure, which can help on a more involved writing task.\n\n(Placeholder output - style: detailed & structured. Replace with a real model output.)"
    },
    {
      "id": "T018",
      "domain": "Summarization",
      "complexity": "Complex",
      "title": "Synthesize conflicting sources into a view",
      "task": "Three reports disagree on a supplier. Report A: on-time delivery improved to 95 percent last quarter. Report B: on-time was flat, but defect rates fell. Report C: the on-time figure is inflated because late shipments were re-dated on receipt. Write a one-paragraph executive summary that reconciles these, explicitly flags the contradiction and its likely cause, and states what a decision-maker should reasonably conclude and verify next.",
      "outputA": "Here is a direct, no-frills attempt to synthesize conflicting sources into a view.\n\nI kept it short: the core ask is handled in a few clear lines, with plain language and no padding. It is easy to scan and ready to use as-is for a summarization task of this kind.\n\n(Placeholder output - style: concise & direct. Replace with a real model output.)",
      "outputB": "Let me work through how to synthesize conflicting sources into a view more thoroughly.\n\n- First, I restate the goal and the key constraints so nothing is missed.\n- Then I lay out the response step by step, with a little reasoning for each choice.\n- Finally, I add a short note on edge cases and what I would double-check.\n\nThis version trades brevity for completeness and structure, which can help on a more involved summarization task.\n\n(Placeholder output - style: detailed & structured. Replace with a real model output.)"
    },
    {
      "id": "T026",
      "domain": "Knowledge Q&A",
      "complexity": "Complex",
      "title": "Correct a common misconception with evidence",
      "task": "Many managers assume that if two metrics move together, one causes the other. Explain why that is wrong using a concrete business example, name the most likely alternative explanation, and address two reasonable follow-up objections a skeptical manager would raise.",
      "outputA": "Here is a direct, no-frills attempt to correct a common misconception with evidence.\n\nI kept it short: the core ask is handled in a few clear lines, with plain language and no padding. It is easy to scan and ready to use as-is for a knowledge q&a task of this kind.\n\n(Placeholder output - style: concise & direct. Replace with a real model output.)",
      "outputB": "Let me work through how to correct a common misconception with evidence more thoroughly.\n\n- First, I restate the goal and the key constraints so nothing is missed.\n- Then I lay out the response step by step, with a little reasoning for each choice.\n- Finally, I add a short note on edge cases and what I would double-check.\n\nThis version trades brevity for completeness and structure, which can help on a more involved knowledge q&a task.\n\n(Placeholder output - style: detailed & structured. Replace with a real model output.)"
    },
    {
      "id": "T044",
      "domain": "Math & Reasoning",
      "complexity": "Complex",
      "title": "Solve a unit-economics problem with a twist",
      "task": "A subscription charges 40 dollars per customer per month, costs 120 dollars to acquire each customer and 8 dollars per month to serve, average stay 14 months. Find lifetime profit per customer after both costs, and the payback period in months. Then, if raising price to 45 also raises serving cost to 9 and shortens average stay to 12 months, decide whether lifetime profit per customer goes up or down versus the original. Show each step.",
      "outputA": "Here is a direct, no-frills attempt to solve a unit-economics problem with a twist.\n\nI kept it short: the core ask is handled in a few clear lines, with plain language and no padding. It is easy to scan and ready to use as-is for a math & reasoning task of this kind.\n\n(Placeholder output - style: concise & direct. Replace with a real model output.)",
      "outputB": "Let me work through how to solve a unit-economics problem with a twist more thoroughly.\n\n- First, I restate the goal and the key constraints so nothing is missed.\n- Then I lay out the response step by step, with a little reasoning for each choice.\n- Finally, I add a short note on edge cases and what I would double-check.\n\nThis version trades brevity for completeness and structure, which can help on a more involved math & reasoning task.\n\n(Placeholder output - style: detailed & structured. Replace with a real model output.)"
    },
    {
      "id": "T033",
      "domain": "Coding",
      "complexity": "Complex",
      "title": "Write a query needing a window function",
      "task": "Write a SQL query for stock_counts(count_id, sku, count_date, quantity) that returns, for each SKU, the row for its single most recent count. Use a window function and break ties on date by keeping the highest count_id. Keep it standard SQL.",
      "outputA": "Here is a direct, no-frills attempt to write a query needing a window function.\n\nI kept it short: the core ask is handled in a few clear lines, with plain language and no padding. It is easy to scan and ready to use as-is for a coding task of this kind.\n\n(Placeholder output - style: concise & direct. Replace with a real model output.)",
      "outputB": "Let me work through how to write a query needing a window function more thoroughly.\n\n- First, I restate the goal and the key constraints so nothing is missed.\n- Then I lay out the response step by step, with a little reasoning for each choice.\n- Finally, I add a short note on edge cases and what I would double-check.\n\nThis version trades brevity for completeness and structure, which can help on a more involved coding task.\n\n(Placeholder output - style: detailed & structured. Replace with a real model output.)"
    },
    {
      "id": "T053",
      "domain": "Data Analysis",
      "complexity": "Complex",
      "title": "Spot a confound or causation pitfall",
      "task": "A manager notices that months with higher shipping volume also have more damaged-goods claims and concludes the carrier is getting careless. Explain why this reasoning is flawed, identify the most likely confounding variable, describe what additional data and analysis would test a real relationship, and outline how to present the corrected interpretation to the manager convincingly.",
      "outputA": "Here is a direct, no-frills attempt to spot a confound or causation pitfall.\n\nI kept it short: the core ask is handled in a few clear lines, with plain language and no padding. It is easy to scan and ready to use as-is for a data analysis task of this kind.\n\n(Placeholder output - style: concise & direct. Replace with a real model output.)",
      "outputB": "Let me work through how to spot a confound or causation pitfall more thoroughly.\n\n- First, I restate the goal and the key constraints so nothing is missed.\n- Then I lay out the response step by step, with a little reasoning for each choice.\n- Finally, I add a short note on edge cases and what I would double-check.\n\nThis version trades brevity for completeness and structure, which can help on a more involved data analysis task.\n\n(Placeholder output - style: detailed & structured. Replace with a real model output.)"
    },
    {
      "id": "T065",
      "domain": "Extraction & Classification",
      "complexity": "Complex",
      "title": "Deduplicate records despite variation",
      "task": "Identify which of these supplier entries likely refer to the same vendor despite differences, group them, and explain each match. Entries: (1) Apex Components, ap@apex.com, 555-0101. (2) Apex Components Inc, ap@apex.com. (3) APEX Comp., orders@apexparts.com, 555-0101. (4) Apollo Components, info@apollo.com.",
      "outputA": "Here is a direct, no-frills attempt to deduplicate records despite variation.\n\nI kept it short: the core ask is handled in a few clear lines, with plain language and no padding. It is easy to scan and ready to use as-is for a extraction & classification task of this kind.\n\n(Placeholder output - style: concise & direct. Replace with a real model output.)",
      "outputB": "Let me work through how to deduplicate records despite variation more thoroughly.\n\n- First, I restate the goal and the key constraints so nothing is missed.\n- Then I lay out the response step by step, with a little reasoning for each choice.\n- Finally, I add a short note on edge cases and what I would double-check.\n\nThis version trades brevity for completeness and structure, which can help on a more involved extraction & classification task.\n\n(Placeholder output - style: detailed & structured. Replace with a real model output.)"
    },
    {
      "id": "T090",
      "domain": "Translation",
      "complexity": "Complex",
      "title": "Translate a workplace message with tone",
      "task": "Translate this workplace message into French, keeping the warm, slightly informal tone and making the idioms sound native rather than literal. Message: 'Thanks so much for stepping in at the last minute. You really saved the day, and the whole team noticed. Let me know if I can ever return the favor, drinks are on me next time.'",
      "outputA": "Here is a direct, no-frills attempt to translate a workplace message with tone.\n\nI kept it short: the core ask is handled in a few clear lines, with plain language and no padding. It is easy to scan and ready to use as-is for a translation task of this kind.\n\n(Placeholder output - style: concise & direct. Replace with a real model output.)",
      "outputB": "Let me work through how to translate a workplace message with tone more thoroughly.\n\n- First, I restate the goal and the key constraints so nothing is missed.\n- Then I lay out the response step by step, with a little reasoning for each choice.\n- Finally, I add a short note on edge cases and what I would double-check.\n\nThis version trades brevity for completeness and structure, which can help on a more involved translation task.\n\n(Placeholder output - style: detailed & structured. Replace with a real model output.)"
    }
  ]
};
