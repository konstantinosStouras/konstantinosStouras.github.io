/**
 * surveyQuestions.js
 *
 * Post-survey questions shown to all participants at session end.
 * To add/remove questions: edit this file only.
 *
 * Question types:
 *   'likert5'       - 1-5 scale with custom anchor labels
 *   'rating_group'  - parent question with multiple sub-items, each rated 1-5
 *   'radio'         - radio button selection from defined options
 *   'freetext'      - open text area
 *
 * Properties:
 *   id          - unique identifier (used as key in surveyAnswers object)
 *   text        - question text displayed to the participant
 *   type        - one of the types above
 *   section     - (optional) section heading displayed above this question
 *   lowLabel    - (likert5) anchor text for value 1
 *   highLabel   - (likert5) anchor text for value 5
 *   items       - (rating_group) array of sub-items, each rated on its own 1-5
 *                 box scale: { id, label, description?, lowLabel?, highLabel? }
 *                 (description = optional italic subheading after the label;
 *                  lowLabel/highLabel = optional anchor text under the scale)
 *   options     - (radio) array of string options
 *   followUp    - (radio) optional { trigger, id, prompt } for conditional freetext
 *   showIf      - (optional) function(session) => bool, question only shows when true
 *   required    - (optional) defaults to true
 */

export const SURVEY_TITLE = 'Post-play Survey'
export const SURVEY_SUBTITLE = 'Please reflect on your experience during the ideation challenge.'

export const SURVEY_QUESTIONS = [
  // ── Section 1: Your Experience ──────────────────────────────
  {
    id: 'q1_difficulty',
    section: 'Your Experience',
    text: 'How easy or difficult was it for you to come up with new product ideas during this task?',
    type: 'likert5',
    lowLabel: 'Very easy',
    highLabel: 'Very difficult',
  },
  {
    id: 'q2_satisfaction',
    text: 'How satisfied are you with the ideas you or your group developed?',
    type: 'likert5',
    lowLabel: 'Not satisfied',
    highLabel: 'Very satisfied',
  },
  {
    id: 'q3_rate_ideas',
    text: 'Rate your group\'s ideas based on the following criteria:',
    type: 'rating_group',
    items: [
      { id: 'novelty', label: 'Novelty', description: 'is the idea original, innovative, and rare?', lowLabel: 'Not novel at all', highLabel: 'Extremely novel' },
      { id: 'usefulness', label: 'Usefulness', description: 'is the idea practical, effective, and useful?', lowLabel: 'Not useful at all', highLabel: 'Extremely useful' },
      { id: 'overall_quality', label: 'Overall quality', description: 'does the idea balance both novelty and usefulness?', lowLabel: 'Very low quality', highLabel: 'Very high quality' },
    ],
    showIf: (session) => session?.phaseConfig?.groupPhaseActive,
  },
  {
    id: 'q4_comfort_collab',
    text: 'How comfortable were you in collaborating with other group members?',
    type: 'likert5',
    lowLabel: 'Not comfortable at all',
    highLabel: 'Very comfortable',
    showIf: (session) => session?.phaseConfig?.groupPhaseActive,
  },

  // ── Section 2: Creativity and Idea Generation ───────────────
  {
    id: 'q5_support_others',
    section: 'Creativity and Idea Generation',
    text: 'How often did you support others\' ideas during the group phase?',
    type: 'likert5',
    lowLabel: 'Never',
    highLabel: 'Always',
    showIf: (session) => session?.phaseConfig?.groupPhaseActive,
  },

  // ── Section 3: Reflection ──────────────────────────────────
  {
    id: 'q6_do_differently',
    section: 'Reflection',
    text: 'If you were to repeat this task, what would you do differently?',
    type: 'freetext',
  },
  {
    id: 'q7_additional_comments',
    text: 'Please share any additional comments about your experience with the idea generation process in each phase.',
    type: 'freetext',
  },

  // ── Section 4: Questions about smart materials and wearable technology ──────────────
  {
    id: 'q8_smartmaterials_importance',
    section: 'Questions about smart materials and wearable technology',
    text: 'How important is it for you to engage with or use smart materials and wearable technology in your daily life?',
    type: 'likert5',
    lowLabel: 'Not important at all',
    highLabel: 'Extremely important',
  },
  {
    id: 'q9_innovation_engagement',
    text: 'How often do you engage with technology-driven or material-innovation products (e.g., wearables, smart textiles, sensors)?',
    type: 'likert5',
    lowLabel: 'Never',
    highLabel: 'Daily',
  },
  {
    id: 'q10_purchased_products',
    text: 'Have you purchased or used any products related to smart materials or wearable technology in the past six months?',
    type: 'radio',
    options: ['Yes', 'No'],
    followUp: {
      trigger: 'Yes',
      id: 'q10_product_detail',
      prompt: 'If yes, what is the product?',
    },
  },
  {
    id: 'q11_interest_new_products',
    text: 'Would you consider yourself interested in trying new products or technologies that use innovative materials?',
    type: 'likert5',
    lowLabel: 'Not interested',
    highLabel: 'Very interested',
  },
  {
    id: 'q12_prior_experience',
    text: 'Do you have any prior experience with innovation, marketing, or product development activities?',
    type: 'radio',
    options: ['Yes', 'No', 'Unsure'],
  },

  // ── Section 5: About you (Big Five personality, short form) ──
  // A 2-item-per-trait short form (Openness, Conscientiousness, Extraversion,
  // Agreeableness, Neuroticism). A pre-registered moderator (AsPredicted
  // #298152). 1–5 agreement scale.
  {
    id: 'bf_openness_1',
    section: 'About you',
    sectionSubheading: 'There are no right or wrong answers — rate how much you agree with each statement.',
    text: 'I am curious about new ideas and different ways of thinking.',
    type: 'likert5',
    lowLabel: 'Strongly disagree',
    highLabel: 'Strongly agree',
  },
  {
    id: 'bf_openness_2',
    text: 'I enjoy thinking about abstract or unconventional ideas.',
    type: 'likert5',
    lowLabel: 'Strongly disagree',
    highLabel: 'Strongly agree',
  },
  {
    id: 'bf_conscientiousness_1',
    text: 'I like to work in an organized and structured way.',
    type: 'likert5',
    lowLabel: 'Strongly disagree',
    highLabel: 'Strongly agree',
  },
  {
    id: 'bf_conscientiousness_2',
    text: 'I pay attention to details when working on tasks.',
    type: 'likert5',
    lowLabel: 'Strongly disagree',
    highLabel: 'Strongly agree',
  },
  {
    id: 'bf_extraversion_1',
    text: 'I feel comfortable speaking up in group discussions.',
    type: 'likert5',
    lowLabel: 'Strongly disagree',
    highLabel: 'Strongly agree',
  },
  {
    id: 'bf_extraversion_2',
    text: 'I enjoy interacting and exchanging ideas with others.',
    type: 'likert5',
    lowLabel: 'Strongly disagree',
    highLabel: 'Strongly agree',
  },
  {
    id: 'bf_agreeableness_1',
    text: 'I try to cooperate and get along with others.',
    type: 'likert5',
    lowLabel: 'Strongly disagree',
    highLabel: 'Strongly agree',
  },
  {
    id: 'bf_agreeableness_2',
    text: 'I respect opinions that differ from my own.',
    type: 'likert5',
    lowLabel: 'Strongly disagree',
    highLabel: 'Strongly agree',
  },
  {
    id: 'bf_neuroticism_1',
    text: 'I feel stressed easily when working under pressure.',
    type: 'likert5',
    lowLabel: 'Strongly disagree',
    highLabel: 'Strongly agree',
  },
  {
    id: 'bf_neuroticism_2',
    text: 'I worry about making mistakes in challenging tasks.',
    type: 'likert5',
    lowLabel: 'Strongly disagree',
    highLabel: 'Strongly agree',
  },

  // ── Section 6: Your group (cognitive diversity) ──
  // Group-level moderator; only shown when a group phase was played.
  {
    id: 'cogdiv_thinking',
    section: 'Your group',
    sectionSubheading: 'Thinking about the people you worked with in the group phase.',
    text: 'Members of my group differ in their way of thinking about problems.',
    type: 'likert5',
    lowLabel: 'Strongly disagree',
    highLabel: 'Strongly agree',
    showIf: (session) => session?.phaseConfig?.groupPhaseActive,
  },
  {
    id: 'cogdiv_knowledge',
    text: 'Members of my group differ in their knowledge and skills.',
    type: 'likert5',
    lowLabel: 'Strongly disagree',
    highLabel: 'Strongly agree',
    showIf: (session) => session?.phaseConfig?.groupPhaseActive,
  },
  {
    id: 'cogdiv_beliefs',
    text: 'Members of my group differ in their beliefs about what is right and wrong.',
    type: 'likert5',
    lowLabel: 'Strongly disagree',
    highLabel: 'Strongly agree',
    showIf: (session) => session?.phaseConfig?.groupPhaseActive,
  },
  {
    id: 'cogdiv_worldview',
    text: 'Members of my group differ in how they view the world and society.',
    type: 'likert5',
    lowLabel: 'Strongly disagree',
    highLabel: 'Strongly agree',
    showIf: (session) => session?.phaseConfig?.groupPhaseActive,
  },

  // ── Section 7: Creative thinking (divergent-thinking task) ──
  // An alternative-uses task — a pre-registered measure of creative ability.
  {
    id: 'dt_brick_uses',
    section: 'Creative thinking',
    sectionSubheading: 'One last quick task.',
    text: 'List as many unusual and creative uses for a brick as you can (up to 10).',
    type: 'freetext',
  },
]