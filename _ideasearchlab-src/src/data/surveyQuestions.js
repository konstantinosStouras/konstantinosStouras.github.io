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

export const SURVEY_TITLE = 'Post-Survey: Creativity and Decision-Making'
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

  // ── Section 4: Questions about sleep wellness ──────────────
  {
    id: 'q8_sleep_importance',
    section: 'Questions about sleep wellness',
    text: 'How important is it for you to sleep well in your daily life?',
    type: 'likert5',
    lowLabel: 'Not important at all',
    highLabel: 'Extremely important',
  },
  {
    id: 'q9_wellness_activities',
    text: 'How often do you engage in wellness-related activities (e.g., exercise, meditation, sleep tracking, healthy eating)?',
    type: 'likert5',
    lowLabel: 'Never',
    highLabel: 'Daily',
  },
  {
    id: 'q10_purchased_products',
    text: 'Have you purchased or used any products related to sleep or wellness in the past six months?',
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
    text: 'Would you consider yourself interested in trying new products or technologies that promote better sleep or wellness?',
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
]