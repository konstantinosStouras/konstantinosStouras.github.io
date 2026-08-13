/* ==========================================================================
   Simulation Platform — the canonical answer sets, and repairing answers that
   were saved in the student's display language.

   WHY THIS EXISTS. The registration selects used to be written as
   <option>Undergraduate</option> — no value attribute — so an option's value IS
   its text. A student browsing with the browser's page translation on has that
   text rewritten in the DOM, so `select.value` returned "大学本科生" and that is
   what got saved. Worse, it did not need a fresh registration: merely opening
   "Edit your details" and pressing Save re-read every select, converting a
   perfectly good English profile into translated strings. That is exactly what
   happened here — the same students' details reached the Ideation Challenge in
   clean English at 05:34 on 2026-08-13 and turned into Chinese on the roster
   afterwards.

   Explicit value="…" attributes stop it happening again (see index.html). This
   file cleans up what was already written: `canon(field, value)` maps a stored
   answer back to the catalogue value it came from, so the roster, the CSV
   export and everything handed to a simulation read one canonical vocabulary.

   THE THREE STEPS of canon(), in order, each one only ever narrowing:
     1. the value already IS one of the options (the normal case), compared
        exactly, then case/whitespace-folded;
     2. decoration is stripped — a translator turns "18-24" into "18-24岁", so a
        value whose ASCII skeleton matches an option is that option;
     3. the alias table below, which is per-FIELD (so "其他" → Other resolves
        inside Gender and inside Industry without the two ever colliding).
   Anything else returns '' — UNKNOWN, never a guess. The caller then leaves the
   stored text alone and treats the field as unanswered, which is what puts it
   in front of the student again.

   The sets are also the single source of truth for the registration form's
   dropdowns (index.html builds every select from them) and must stay identical
   to the sims' own registration forms — simulation/tools/smoke.mjs fails the
   build if they drift from ideasearchlab / PortfolioFit / Answer Arena.
   ========================================================================== */
(function () {
  'use strict';

  /* The sims' SHARED country list — byte-identical to ideasearchlab's
     formDefaults.js COUNTRIES / answerarena's ARENA_COUNTRIES. */
  var COUNTRIES = [
    'Afghanistan', 'Albania', 'Algeria', 'Andorra', 'Angola', 'Antigua and Barbuda',
    'Argentina', 'Armenia', 'Australia', 'Austria', 'Azerbaijan', 'Bahamas', 'Bahrain',
    'Bangladesh', 'Barbados', 'Belarus', 'Belgium', 'Belize', 'Benin', 'Bhutan', 'Bolivia',
    'Bosnia and Herzegovina', 'Botswana', 'Brazil', 'Brunei', 'Bulgaria', 'Burkina Faso',
    'Burundi', 'Cabo Verde', 'Cambodia', 'Cameroon', 'Canada', 'Central African Republic',
    'Chad', 'Chile', 'China', 'Colombia', 'Comoros', 'Congo (DRC)', 'Congo (Republic)',
    'Costa Rica', 'Croatia', 'Cuba', 'Cyprus', 'Czech Republic', 'Denmark', 'Djibouti',
    'Dominica', 'Dominican Republic', 'Ecuador', 'Egypt', 'El Salvador', 'Equatorial Guinea',
    'Eritrea', 'Estonia', 'Eswatini', 'Ethiopia', 'Fiji', 'Finland', 'France', 'Gabon',
    'Gambia', 'Georgia', 'Germany', 'Ghana', 'Greece', 'Grenada', 'Guatemala', 'Guinea',
    'Guinea-Bissau', 'Guyana', 'Haiti', 'Honduras', 'Hungary', 'Iceland', 'India', 'Indonesia',
    'Iran', 'Iraq', 'Ireland', 'Israel', 'Italy', 'Ivory Coast', 'Jamaica', 'Japan', 'Jordan',
    'Kazakhstan', 'Kenya', 'Kiribati', 'Kosovo', 'Kuwait', 'Kyrgyzstan', 'Laos', 'Latvia',
    'Lebanon', 'Lesotho', 'Liberia', 'Libya', 'Liechtenstein', 'Lithuania', 'Luxembourg',
    'Madagascar', 'Malawi', 'Malaysia', 'Maldives', 'Mali', 'Malta', 'Marshall Islands',
    'Mauritania', 'Mauritius', 'Mexico', 'Micronesia', 'Moldova', 'Monaco', 'Mongolia',
    'Montenegro', 'Morocco', 'Mozambique', 'Myanmar', 'Namibia', 'Nauru', 'Nepal',
    'Netherlands', 'New Zealand', 'Nicaragua', 'Niger', 'Nigeria', 'North Korea',
    'North Macedonia', 'Norway', 'Oman', 'Pakistan', 'Palau', 'Palestine', 'Panama',
    'Papua New Guinea', 'Paraguay', 'Peru', 'Philippines', 'Poland', 'Portugal', 'Qatar',
    'Romania', 'Russia', 'Rwanda', 'Saint Kitts and Nevis', 'Saint Lucia',
    'Saint Vincent and the Grenadines', 'Samoa', 'San Marino', 'Sao Tome and Principe',
    'Saudi Arabia', 'Senegal', 'Serbia', 'Seychelles', 'Sierra Leone', 'Singapore', 'Slovakia',
    'Slovenia', 'Solomon Islands', 'Somalia', 'South Africa', 'South Korea', 'South Sudan',
    'Spain', 'Sri Lanka', 'Sudan', 'Suriname', 'Sweden', 'Switzerland', 'Syria', 'Taiwan',
    'Tajikistan', 'Tanzania', 'Thailand', 'Timor-Leste', 'Togo', 'Tonga',
    'Trinidad and Tobago', 'Tunisia', 'Turkey', 'Turkmenistan', 'Tuvalu', 'Uganda', 'Ukraine',
    'United Arab Emirates', 'United Kingdom', 'United States', 'Uruguay', 'Uzbekistan',
    'Vanuatu', 'Vatican City', 'Venezuela', 'Vietnam', 'Yemen', 'Zambia', 'Zimbabwe'];

  /* One entry per select on the registration form, keyed by its PROFILE field
     (so a caller can walk a stored profile without a lookup table). */
  var SETS = {
    age: ['18-24', '25-34', '35-44', '45-54', '55-64', '65+'],
    gender: ['Male', 'Female', 'Non-binary', 'Prefer not to say', 'Other'],
    nationality: COUNTRIES,
    country: COUNTRIES,
    levelOfStudy: ['Undergraduate', 'Postgraduate (Masters)', 'Postgraduate (PhD)', 'MBA', 'Other'],
    occupation: ['Student', 'Employed full-time', 'Employed part-time',
      'Self-employed', 'Unemployed', 'Retired', 'Other'],
    industry: ['Agriculture & Food', 'Banking & Financial Services',
      'Construction & Real Estate', 'Consulting', 'Consumer Goods & Retail',
      'Education & Research', 'Energy & Utilities', 'Engineering & Manufacturing',
      'Entertainment & Media', 'Government & Public Sector', 'Healthcare & Pharmaceuticals',
      'Hospitality & Tourism', 'Insurance', 'Legal Services', 'Logistics & Transportation',
      'Marketing & Advertising', 'Non-profit & NGO', 'Technology & Software',
      'Telecommunications', 'Other'],
    englishFluency: ['Native speaker', 'Fluent', 'Advanced', 'Intermediate', 'Basic']
  };

  /* Translated answers seen in the wild, per field. Chinese (Simplified and
     Traditional) is what this cohort's browsers produced — 大学本科生 / 本科阶段 /
     本科生 all came back for the SAME option, because different browsers and
     translation revisions word it differently. Several spellings per option is
     therefore normal; add more as they turn up, and only ones you are certain
     of — an unmapped answer is asked again, which is safe, while a wrong
     mapping silently records something the student never chose. */
  var ALIASES = {
    levelOfStudy: {
      '大学本科生': 'Undergraduate', '本科生': 'Undergraduate', '本科阶段': 'Undergraduate',
      '本科': 'Undergraduate', '大学生': 'Undergraduate', '学士': 'Undergraduate',
      '大學本科生': 'Undergraduate', '本科學生': 'Undergraduate', '學士': 'Undergraduate',
      '研究生（硕士）': 'Postgraduate (Masters)', '研究生(硕士)': 'Postgraduate (Masters)',
      '硕士研究生': 'Postgraduate (Masters)', '硕士': 'Postgraduate (Masters)',
      '研究生': 'Postgraduate (Masters)', '碩士': 'Postgraduate (Masters)',
      '碩士研究生': 'Postgraduate (Masters)',
      '研究生（博士）': 'Postgraduate (PhD)', '研究生(博士)': 'Postgraduate (PhD)',
      '博士研究生': 'Postgraduate (PhD)', '博士': 'Postgraduate (PhD)',
      '工商管理硕士': 'MBA', '工商管理碩士': 'MBA',
      '其他': 'Other', '其它': 'Other'
    },
    gender: {
      '男': 'Male', '男性': 'Male', '男生': 'Male',
      '女': 'Female', '女性': 'Female', '女生': 'Female',
      '非二元': 'Non-binary', '非二元性别': 'Non-binary', '非二元性別': 'Non-binary',
      '不愿透露': 'Prefer not to say', '不願透露': 'Prefer not to say',
      '不愿意说': 'Prefer not to say', '宁愿不说': 'Prefer not to say',
      '不想说': 'Prefer not to say', '保密': 'Prefer not to say',
      '其他': 'Other', '其它': 'Other'
    },
    englishFluency: {
      '母语': 'Native speaker', '母語': 'Native speaker', '母语者': 'Native speaker',
      '母语人士': 'Native speaker', '以英语为母语': 'Native speaker',
      '流利': 'Fluent', '熟练': 'Fluent', '熟練': 'Fluent',
      '高级': 'Advanced', '高級': 'Advanced',
      '中级': 'Intermediate', '中級': 'Intermediate',
      '基础': 'Basic', '基礎': 'Basic', '初级': 'Basic', '初級': 'Basic'
    },
    occupation: {
      '学生': 'Student', '學生': 'Student',
      '全职': 'Employed full-time', '全职工作': 'Employed full-time',
      '全职就业': 'Employed full-time', '全职员工': 'Employed full-time',
      '全職': 'Employed full-time',
      '兼职': 'Employed part-time', '兼职工作': 'Employed part-time',
      '兼职就业': 'Employed part-time', '兼職': 'Employed part-time',
      '自雇': 'Self-employed', '自雇人士': 'Self-employed', '个体经营': 'Self-employed',
      '自主创业': 'Self-employed', '自僱': 'Self-employed',
      '失业': 'Unemployed', '失業': 'Unemployed', '待业': 'Unemployed',
      '退休': 'Retired', '已退休': 'Retired',
      '其他': 'Other', '其它': 'Other'
    },
    industry: {
      '农业与食品': 'Agriculture & Food', '农业和食品': 'Agriculture & Food',
      '银行与金融服务': 'Banking & Financial Services',
      '银行和金融服务': 'Banking & Financial Services',
      '建筑与房地产': 'Construction & Real Estate',
      '建筑和房地产': 'Construction & Real Estate',
      '咨询': 'Consulting', '咨询业': 'Consulting', '諮詢': 'Consulting',
      '消费品与零售': 'Consumer Goods & Retail', '消费品和零售': 'Consumer Goods & Retail',
      '教育与研究': 'Education & Research', '教育和研究': 'Education & Research',
      '教育与科研': 'Education & Research',
      '能源与公用事业': 'Energy & Utilities', '能源和公用事业': 'Energy & Utilities',
      '工程与制造': 'Engineering & Manufacturing', '工程和制造': 'Engineering & Manufacturing',
      '娱乐与媒体': 'Entertainment & Media', '娱乐和媒体': 'Entertainment & Media',
      '政府与公共部门': 'Government & Public Sector',
      '政府和公共部门': 'Government & Public Sector',
      '医疗与制药': 'Healthcare & Pharmaceuticals', '医疗保健与制药': 'Healthcare & Pharmaceuticals',
      '医疗和制药': 'Healthcare & Pharmaceuticals',
      '酒店与旅游': 'Hospitality & Tourism', '酒店和旅游': 'Hospitality & Tourism',
      '款待与旅游': 'Hospitality & Tourism',
      '保险': 'Insurance', '保險': 'Insurance',
      '法律服务': 'Legal Services', '法律服務': 'Legal Services',
      '物流与运输': 'Logistics & Transportation', '物流和运输': 'Logistics & Transportation',
      '物流运输': 'Logistics & Transportation', '物流與運輸': 'Logistics & Transportation',
      '营销与广告': 'Marketing & Advertising', '营销和广告': 'Marketing & Advertising',
      '市场营销与广告': 'Marketing & Advertising',
      '非营利组织与非政府组织': 'Non-profit & NGO', '非营利与非政府组织': 'Non-profit & NGO',
      '非营利组织': 'Non-profit & NGO',
      '技术与软件': 'Technology & Software', '技术和软件': 'Technology & Software',
      '科技与软件': 'Technology & Software', '技術與軟體': 'Technology & Software',
      '电信': 'Telecommunications', '电信业': 'Telecommunications', '電信': 'Telecommunications',
      '其他': 'Other', '其它': 'Other'
    },
    /* Countries: only the ones this class actually comes from, plus the obvious
       neighbours. An unlisted country is asked again rather than guessed. */
    country: {
      '中国': 'China', '中國': 'China', '中华人民共和国': 'China',
      '新加坡': 'Singapore', '越南': 'Vietnam', '泰国': 'Thailand', '泰國': 'Thailand',
      '老挝': 'Laos', '寮國': 'Laos', '马来西亚': 'Malaysia', '馬來西亞': 'Malaysia',
      '印度尼西亚': 'Indonesia', '印尼': 'Indonesia', '菲律宾': 'Philippines',
      '柬埔寨': 'Cambodia', '缅甸': 'Myanmar', '文莱': 'Brunei',
      '日本': 'Japan', '韩国': 'South Korea', '韓國': 'South Korea', '南韩': 'South Korea',
      '印度': 'India', '巴基斯坦': 'Pakistan', '孟加拉国': 'Bangladesh',
      '爱尔兰': 'Ireland', '愛爾蘭': 'Ireland',
      '英国': 'United Kingdom', '英國': 'United Kingdom',
      '美国': 'United States', '美國': 'United States',
      '澳大利亚': 'Australia', '澳洲': 'Australia', '新西兰': 'New Zealand',
      '加拿大': 'Canada', '法国': 'France', '德国': 'Germany', '意大利': 'Italy',
      '西班牙': 'Spain', '荷兰': 'Netherlands', '俄罗斯': 'Russia',
      '台湾': 'Taiwan', '臺灣': 'Taiwan', '尼泊尔': 'Nepal', '斯里兰卡': 'Sri Lanka',
      '土耳其': 'Turkey', '巴西': 'Brazil', '墨西哥': 'Mexico', '南非': 'South Africa',
      '尼日利亚': 'Nigeria', '埃及': 'Egypt', '肯尼亚': 'Kenya'
    }
  };
  ALIASES.nationality = ALIASES.country;      // same catalogue, same wording

  function fold(s) {
    return String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
  }
  /* The ASCII skeleton of a value: what survives when a translator decorates an
     otherwise-untranslatable answer ("18-24岁" → "18-24"). Empty for a fully
     translated string, which is why this can never match by accident. */
  function skeleton(s) {
    return String(s == null ? '' : s).replace(/[^\x20-\x7E]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  /* The catalogue value this answer came from, or '' when it cannot be told. */
  function canon(field, value) {
    var set = SETS[field];
    var v = String(value == null ? '' : value).trim();
    if (!set || !v) return '';
    var i;
    for (i = 0; i < set.length; i++) if (set[i] === v) return set[i];
    var f = fold(v);
    for (i = 0; i < set.length; i++) if (fold(set[i]) === f) return set[i];
    var sk = skeleton(v);
    if (sk) for (i = 0; i < set.length; i++) if (fold(set[i]) === sk) return set[i];
    var table = ALIASES[field];
    if (table) {
      if (table[v]) return table[v];
      for (var k in table) if (Object.prototype.hasOwnProperty.call(table, k) && fold(k) === f) return table[k];
    }
    return '';
  }

  /* Is this stored answer already one of the options? */
  function isCanonical(field, value) {
    var v = String(value == null ? '' : value).trim();
    return !!v && canon(field, v) === v;
  }

  /* Repair a whole profile. Returns { profile, fixed: ['levelOfStudy', …] } —
     a NEW object, only touched where an answer was confidently recognised.
     A value that cannot be mapped is left exactly as it was: the caller shows
     the field as unanswered so the student picks it again, and nothing the
     student typed is ever destroyed by a guess. */
  function healProfile(p) {
    var out = {}, fixed = [], k;
    for (k in p) if (Object.prototype.hasOwnProperty.call(p, k)) out[k] = p[k];
    for (k in SETS) {
      if (!Object.prototype.hasOwnProperty.call(SETS, k)) continue;
      var v = out[k];
      if (v == null || v === '' || isCanonical(k, v)) continue;
      var c = canon(k, v);
      if (c) { out[k] = c; fixed.push(k); }
    }
    return { profile: out, fixed: fixed };
  }

  var API = {
    sets: SETS, aliases: ALIASES, fields: Object.keys(SETS),
    canon: canon, isCanonical: isCanonical, healProfile: healProfile
  };
  if (typeof window !== 'undefined') window.SIMP_ANSWERS = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})();
