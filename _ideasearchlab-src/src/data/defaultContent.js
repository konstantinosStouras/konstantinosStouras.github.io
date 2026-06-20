/**
 * defaultContent.js
 *
 * Central source of all instructor-editable participant-facing copy.
 *
 * Each page is edited as a SINGLE rich-text document (HTML) — bold, italic,
 * underline, strikethrough, lists, colour, highlight, links and line breaks —
 * so the admin edits the whole page at once instead of field by field.
 * Interactive widgets (form inputs, timers, idea/vote controls, survey scales,
 * buttons) keep fixed default labels in the page components; the editor governs
 * the surrounding text. HTML is rendered safely (sanitised) by <RichText />.
 *
 * {placeholders} are filled in by the pages, e.g. {minutes}, {maxIdeas},
 * {ideasCarried}, {needed}, {neededPlural}.
 */

import { isHtmlEmpty } from '../components/RichText'

export const DEFAULT_CONTENT = {
  welcome: {
    body:
      '<h1>Welcome to the Ideation Challenge</h1>' +
      '<p>Generate, evaluate, and select promising health &amp; wellness product concepts.</p>' +
      '<h2>Welcome</h2>' +
      '<p>You are about to take part in an ideation challenge focused on generating and evaluating new product concepts in the <strong>health and wellness market</strong>.</p>' +
      '<p>The goal of this study is to understand how people generate best ideas when developing new products for an existing or an emerging market.</p>' +
      '<p>The study will involve the following phases:</p>' +
      '<ul>' +
      '<li><strong>Individual Ideation Phase:</strong> Work independently to come up with potential product ideas.</li>' +
      '<li><strong>Group Ideation Phase:</strong> Join a group to share, discuss, and refine ideas together.</li>' +
      '<li><strong>Final Selection:</strong> As a group, review all ideas and agree on the top ideas.</li>' +
      '</ul>' +
      '<p>We will evaluate the quality of your ideas independently through external reviewers. If an idea selected by your group is among the top 5 ideas among all groups, then you will receive an award in the form of an Amazon Voucher worth 50 euros.</p>' +
      '<p>Please follow the instructions carefully and complete each phase within the specific time.</p>' +
      '<p>Thank you for taking part in the study.</p>',
  },

  registration: {
    body:
      '<h1>Registration</h1>' +
      '<p>Please complete the information below to join the Ideation Challenge.</p>',
  },

  lobby: {
    body:
      "<h1>You're in.</h1>" +
      '<p>Hang tight — your session will begin shortly.</p>',
  },

  individual: {
    instructions:
      '<h1>Individual Ideation Phase</h1>' +
      '<p>Work on your own to come up with as many strong product ideas as you can.</p>' +
      '<h2>Instructions</h2>' +
      "<p>In this phase you work <strong>completely on your own</strong> — please do not communicate or collaborate with others.</p>" +
      '<p>Your goal: generate ideas for the <strong>smart materials and wearable technology</strong> market. You will design a <strong>completely new product using a fabric that changes color when it reaches 37°C (body temperature)</strong>. Consider what users currently have and what unmet needs remain.</p>' +
      "<p>You have <strong>{minutes} minutes</strong> — a timer is shown at the top, and you'll move on automatically when it ends. Work efficiently: the ideas you create here are the ones you'll bring into the group phase.</p>" +
      '<h3>Your task</h3>' +
      '<ul>' +
      '<li>Generate original product ideas, big or small</li>' +
      '<li>Give each one a clear <strong>title</strong> and a short <strong>description</strong></li>' +
      '<li>Double-click your best <strong>{ideasCarried} ideas</strong> to carry them into the group phase</li>' +
      '</ul>',
    brief:
      '<p>Design a <strong>completely new product using a fabric that changes color when it reaches 37°C (body temperature)</strong>, for the <strong>smart materials and wearable technology</strong> market. Consider what users currently have and what unmet needs remain.</p>' +
      '<p><strong>Example:</strong> A wristband made with thermochromic fabric that changes color at body temperature, giving caregivers a passive visual signal of skin contact or warmth — without any electronics.</p>' +
      "<p>You can generate up to <strong>{maxIdeas} original product ideas</strong>. Each idea should include an <strong>idea title</strong> and a <strong>description</strong> explaining what it does, how it works, and why it's unique.</p>" +
      '<p>Use the following <strong>evaluation criteria</strong> to guide your thinking:</p>' +
      '<ul>' +
      '<li><strong>Novelty:</strong> Is the idea new, surprising, and original?</li>' +
      '<li><strong>Feasibility:</strong> Can it be developed with today\'s technology?</li>' +
      '<li><strong>Financial Value:</strong> Does it have market potential?</li>' +
      '<li><strong>Overall Quality:</strong> Is it well-structured and relevant?</li>' +
      '</ul>' +
      '<p>[AI] AI is available on the right panel to help you brainstorm, develop, evaluate and select your ideas.</p>' +
      "<p>When you're done, <strong>double-click</strong> your best <strong>{ideasCarried} ideas</strong> to select them. These will be carried forward to the group phase.</p>",
  },

  group: {
    instructions:
      '<h1>Group Ideation Phase</h1>' +
      "<p>Welcome to the Group Phase. You'll now team up with your group to combine and improve the ideas you each created — and choose your group's best ones.</p>" +
      '<h2>Instructions</h2>' +
      '<p>The brief is the same as before: design a <strong>completely new product using a fabric that changes color when it reaches 37°C (body temperature)</strong>, in the <strong>smart materials and wearable technology</strong> market.</p>' +
      '<p>Together, you will:</p>' +
      '<ul>' +
      '<li>Share and discuss the ideas each member carried in from the individual phase</li>' +
      "<li>Build on each other's ideas, and generate brand-new ideas together as a team</li>" +
      '<li>Agree on your group&rsquo;s <strong>{votes} best ideas</strong> and vote for them</li>' +
      '</ul>' +
      "<p>You have <strong>{minutes} minutes</strong> for this phase. A timer is shown at the top, and you'll move on automatically when it ends — so collaborate efficiently.</p>" +
      "<p>If your group's selected idea ranks among the <strong>top five across all groups</strong>, every member wins a <strong>€50 Amazon voucher</strong>.</p>" +
      '<p>Work as one team — great ideas grow through collaboration! 🌿</p>',
    brief:
      '<h3>Your task</h3>' +
      '<p>As a group, generate ideas for the <strong>smart materials and wearable technology</strong> market. You will design a <strong>completely new product using a fabric that changes color when it reaches 37°C (body temperature)</strong>. Consider what users currently have and what unmet needs remain.</p>' +
      "<p>You're in a team of three. Your screen shows up to <strong>nine ideas</strong> to start (three from each member).</p>" +
      '<ol>' +
      "<li><strong>Generate new group ideas together</strong> — don't just work with the ideas you each brought in; create brand-new ideas as a team in the <strong>Group Ideas</strong> panel (each member may add up to <strong>two</strong>).</li>" +
      '<li><strong>Review all ideas together</strong> — both the individual ideas and your new group ideas — before deciding.</li>' +
      '<li>Use the <strong>group chat</strong> to share feedback, opinions, and possible combinations.</li>' +
      '<li>Evaluate every idea on:' +
        '<ul>' +
        '<li><strong>Novelty:</strong> Is the idea new, surprising, and original?</li>' +
        "<li><strong>Feasibility:</strong> Can it be developed with today's technology?</li>" +
        '<li><strong>Financial Value:</strong> Does it have market potential?</li>' +
        '<li><strong>Overall Quality:</strong> Is it well-structured and relevant?</li>' +
        '</ul>' +
      '</li>' +
      '<li>Discuss how each idea measures up and decide which ones stand out.</li>' +
      '<li>When your group is ready, click <strong>Proceed to Voting</strong>, double-click the <strong>{votes} ideas</strong> that should represent your group, then press <strong>Submit Votes</strong>.</li>' +
      '</ol>' +
      "<p>Remember: if your group's chosen idea ranks among the <strong>top five across all groups</strong>, every member wins a <strong>€50 Amazon voucher</strong>.</p>" +
      '<p>[AI] A <strong>group-shared</strong> AI assistant is available on the right to help your group discuss, refine, and select ideas. Everyone sees the same conversation — all messages and replies are shared across the group.</p>',
  },

  survey: {
    body:
      '<h1>Post-Survey: Creativity and Decision-Making</h1>' +
      '<p>Please reflect on your experience during the ideation challenge.</p>',
  },

  done: {
    body:
      '<h1>All done.</h1>' +
      '<p>Thank you for participating. Your responses have been recorded. You may close this window.</p>',
  },
}

/**
 * CONTENT_SCHEMA drives the admin Content editor UI: one collapsible block per
 * page, each with a single full-page editor (Individual and Group phases have
 * two screens: the instructions page and the workspace task brief).
 */
export const CONTENT_SCHEMA = [
  { key: 'welcome', label: 'Welcome page', fields: [
    { key: 'body', label: 'Welcome page', type: 'area' },
  ] },
  { key: 'registration', label: 'Registration page', fields: [
    { key: 'body', label: 'Intro text (shown above the form)', type: 'area' },
  ] },
  { key: 'lobby', label: 'Lobby / waiting room', fields: [
    { key: 'body', label: 'Lobby text (the live join counter stays automatic)', type: 'area' },
  ] },
  { key: 'individual', label: 'Individual phase', fields: [
    { key: 'instructions', label: 'Instructions screen (before Start)', type: 'area', hint: 'Keep {minutes} where you want the duration.' },
    { key: 'brief', label: 'Task brief (inside the workspace)', type: 'area', hint: 'Keep {maxIdeas} and {ideasCarried}. Lines starting with [AI] only show when AI is on.' },
  ] },
  { key: 'group', label: 'Group phase', fields: [
    { key: 'instructions', label: 'Instructions screen (before Start)', type: 'area', hint: 'Keep {minutes} where you want the duration.' },
    { key: 'brief', label: 'Task brief (inside the workspace)', type: 'area', hint: 'Keep {votes} for the number of votes. Lines starting with [AI] only show when AI is on.' },
  ] },
  { key: 'survey', label: 'Survey', fields: [
    { key: 'body', label: 'Survey intro (shown above the questions)', type: 'area' },
  ] },
  { key: 'done', label: 'Completion page', fields: [
    { key: 'body', label: 'Completion page', type: 'area' },
  ] },
]

// Pick override if it has visible content, otherwise fall back to default.
function pick(override, fallback) {
  if (typeof override === 'string') {
    return isHtmlEmpty(override) ? fallback : override
  }
  return override == null ? fallback : override
}

/**
 * Merge admin-saved custom defaults (Firestore doc settings/contentDefaults)
 * over the built-in DEFAULT_CONTENT, field by field. Any missing or empty
 * custom field falls back to the built-in text. Pass null/undefined to get a
 * fresh copy of the built-in defaults. Used to seed the create-session form
 * and the per-page "Reset this page to defaults" action in the admin panel.
 */
export function getEffectiveDefaults(custom) {
  const out = {}
  for (const groupKey of Object.keys(DEFAULT_CONTENT)) {
    const def = DEFAULT_CONTENT[groupKey]
    const ov = custom?.[groupKey] || {}
    out[groupKey] = {}
    for (const fieldKey of Object.keys(def)) {
      out[groupKey][fieldKey] = pick(ov[fieldKey], def[fieldKey])
    }
  }
  return out
}

/**
 * Merge a session's saved contentConfig over DEFAULT_CONTENT. Any missing or
 * empty field falls back to the default, so partial configs (and sessions
 * created before this feature existed) render exactly like the defaults.
 * (Intentionally merges over the built-in defaults, not the admin-saved ones:
 * sessions snapshot their full content at creation, so changing the saved
 * defaults later must not alter already-created sessions.)
 */
export function getContent(session) {
  const cc = session?.contentConfig || {}
  const out = {}
  for (const groupKey of Object.keys(DEFAULT_CONTENT)) {
    const def = DEFAULT_CONTENT[groupKey]
    const ov = cc[groupKey] || {}
    out[groupKey] = {}
    for (const fieldKey of Object.keys(def)) {
      out[groupKey][fieldKey] = pick(ov[fieldKey], def[fieldKey])
    }
  }
  // Legacy: sessions saved before the group phase had two screens stored a
  // single intro banner as group.body — surface it as the workspace task brief.
  const legacyGroupBody = cc.group?.body
  if (!isHtmlEmpty(legacyGroupBody) && isHtmlEmpty(cc.group?.brief)) {
    out.group.brief = legacyGroupBody
  }
  return out
}
