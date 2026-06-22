/**
 * formDefaults.js
 *
 * Defaults and helpers for the instructor-editable Registration form and Survey
 * questions (the structured parts that can't live in a rich-text box).
 *
 * Stored per session as:
 *   session.registrationConfig = { fields: [...], consents: [...] }
 *   session.surveyConfig       = { questions: [...] }
 *
 * Page intros (titles/instructions) remain in contentConfig (rich text).
 *
 * Registration field: { id, label, type, options?, required, min?, max? }
 *   type: 'select' (custom options) | 'country' (built-in list) | 'number' | 'text'
 * Survey question: { id, section, sectionSubheading, text, type, lowLabel?,
 *                    highLabel?, items?, options?, followUp?, required, showIfGroup }
 *   type: 'likert5' | 'rating_group' | 'radio' | 'freetext'
 */

import { SURVEY_QUESTIONS } from './surveyQuestions'

export const COUNTRIES = [
  'Afghanistan', 'Albania', 'Algeria', 'Andorra', 'Angola',
  'Antigua and Barbuda', 'Argentina', 'Armenia', 'Australia', 'Austria',
  'Azerbaijan', 'Bahamas', 'Bahrain', 'Bangladesh', 'Barbados',
  'Belarus', 'Belgium', 'Belize', 'Benin', 'Bhutan',
  'Bolivia', 'Bosnia and Herzegovina', 'Botswana', 'Brazil', 'Brunei',
  'Bulgaria', 'Burkina Faso', 'Burundi', 'Cabo Verde', 'Cambodia',
  'Cameroon', 'Canada', 'Central African Republic', 'Chad', 'Chile',
  'China', 'Colombia', 'Comoros', 'Congo (DRC)', 'Congo (Republic)',
  'Costa Rica', 'Croatia', 'Cuba', 'Cyprus', 'Czech Republic',
  'Denmark', 'Djibouti', 'Dominica', 'Dominican Republic', 'Ecuador',
  'Egypt', 'El Salvador', 'Equatorial Guinea', 'Eritrea', 'Estonia',
  'Eswatini', 'Ethiopia', 'Fiji', 'Finland', 'France',
  'Gabon', 'Gambia', 'Georgia', 'Germany', 'Ghana',
  'Greece', 'Grenada', 'Guatemala', 'Guinea', 'Guinea-Bissau',
  'Guyana', 'Haiti', 'Honduras', 'Hungary', 'Iceland',
  'India', 'Indonesia', 'Iran', 'Iraq', 'Ireland',
  'Israel', 'Italy', 'Ivory Coast', 'Jamaica', 'Japan',
  'Jordan', 'Kazakhstan', 'Kenya', 'Kiribati', 'Kosovo',
  'Kuwait', 'Kyrgyzstan', 'Laos', 'Latvia', 'Lebanon',
  'Lesotho', 'Liberia', 'Libya', 'Liechtenstein', 'Lithuania',
  'Luxembourg', 'Madagascar', 'Malawi', 'Malaysia', 'Maldives',
  'Mali', 'Malta', 'Marshall Islands', 'Mauritania', 'Mauritius',
  'Mexico', 'Micronesia', 'Moldova', 'Monaco', 'Mongolia',
  'Montenegro', 'Morocco', 'Mozambique', 'Myanmar', 'Namibia',
  'Nauru', 'Nepal', 'Netherlands', 'New Zealand', 'Nicaragua',
  'Niger', 'Nigeria', 'North Korea', 'North Macedonia', 'Norway',
  'Oman', 'Pakistan', 'Palau', 'Palestine', 'Panama',
  'Papua New Guinea', 'Paraguay', 'Peru', 'Philippines', 'Poland',
  'Portugal', 'Qatar', 'Romania', 'Russia', 'Rwanda',
  'Saint Kitts and Nevis', 'Saint Lucia', 'Saint Vincent and the Grenadines',
  'Samoa', 'San Marino', 'Sao Tome and Principe', 'Saudi Arabia', 'Senegal',
  'Serbia', 'Seychelles', 'Sierra Leone', 'Singapore', 'Slovakia',
  'Slovenia', 'Solomon Islands', 'Somalia', 'South Africa', 'South Korea',
  'South Sudan', 'Spain', 'Sri Lanka', 'Sudan', 'Suriname',
  'Sweden', 'Switzerland', 'Syria', 'Taiwan', 'Tajikistan',
  'Tanzania', 'Thailand', 'Timor-Leste', 'Togo', 'Tonga',
  'Trinidad and Tobago', 'Tunisia', 'Turkey', 'Turkmenistan', 'Tuvalu',
  'Uganda', 'Ukraine', 'United Arab Emirates', 'United Kingdom', 'United States',
  'Uruguay', 'Uzbekistan', 'Vanuatu', 'Vatican City', 'Venezuela',
  'Vietnam', 'Yemen', 'Zambia', 'Zimbabwe',
]

export const FIELD_TYPES = [
  { value: 'select', label: 'Dropdown (custom options)' },
  { value: 'country', label: 'Country list (built-in)' },
  { value: 'number', label: 'Number' },
  { value: 'text', label: 'Short text' },
]

export const QUESTION_TYPES = [
  { value: 'likert5', label: '1–5 scale' },
  { value: 'radio', label: 'Multiple choice' },
  { value: 'rating_group', label: 'Rating set (1–5 scale per criterion)' },
  { value: 'freetext', label: 'Free text' },
]

export const DEFAULT_REGISTRATION = {
  fields: [
    { id: 'ucdStudentId', label: 'UCD Student ID', type: 'text', required: true },
    { id: 'age', label: 'Age', type: 'select', required: true, options: ['18-24', '25-34', '35-44', '45-54', '55-64', '65+'] },
    { id: 'gender', label: 'Gender', type: 'select', required: false, options: ['Prefer not to say', 'Male', 'Female', 'Non-binary', 'Other'] },
    { id: 'nationality', label: 'Nationality', type: 'country', required: true, options: [] },
    { id: 'country', label: 'Country of residence', type: 'country', required: true, options: [] },
    { id: 'levelOfStudy', label: 'Level of Study', type: 'select', required: true, options: ['Undergraduate', 'Postgraduate (Masters)', 'Postgraduate (PhD)', 'MBA', 'Other'] },
    { id: 'workExperience', label: 'Work Experience (in years)', type: 'number', required: true, min: 0, max: 50 },
    { id: 'occupation', label: 'Occupation', type: 'select', required: true, options: ['Student', 'Employed full-time', 'Employed part-time', 'Self-employed', 'Unemployed', 'Retired', 'Other'] },
    { id: 'englishFluency', label: 'English Fluency', type: 'select', required: true, options: ['Native speaker', 'Fluent', 'Advanced', 'Intermediate', 'Basic'] },
  ],
  consents: [
    'I confirm that I am 18 years or older and consent to participate in this research study.',
    'I understand that my responses will be used anonymously for research purposes only.',
  ],
}

export const DEFAULT_SURVEY_QUESTIONS = SURVEY_QUESTIONS.map(q => ({
  id: q.id,
  section: q.section || '',
  sectionSubheading: q.sectionSubheading || '',
  text: q.text,
  type: q.type,
  lowLabel: q.lowLabel || '',
  highLabel: q.highLabel || '',
  items: q.items ? q.items.map(it => ({
    id: it.id,
    label: it.label,
    description: it.description || '',
    lowLabel: it.lowLabel || '',
    highLabel: it.highLabel || '',
  })) : [],
  options: q.options ? [...q.options] : [],
  followUp: q.followUp ? { trigger: q.followUp.trigger, id: q.followUp.id, prompt: q.followUp.prompt } : null,
  required: q.required !== false,
  showIfGroup: !!q.showIf, // the original group-only questions used showIf
}))

const clone = x => JSON.parse(JSON.stringify(x))

export function getRegistration(session) {
  const rc = session?.registrationConfig
  if (rc && Array.isArray(rc.fields) && rc.fields.length) {
    return { fields: clone(rc.fields), consents: clone(rc.consents || []) }
  }
  return clone(DEFAULT_REGISTRATION)
}

export function getSurveyQuestions(session) {
  const sc = session?.surveyConfig
  if (sc && Array.isArray(sc.questions) && sc.questions.length) {
    return clone(sc.questions)
  }
  return clone(DEFAULT_SURVEY_QUESTIONS)
}

// Generate a stable-ish id for newly added fields/questions/options.
export function newId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`
}
