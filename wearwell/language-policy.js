// Deterministic defaults, not an inference about a person's identity or mother tongue.
export const languages={
 de:{label:'Deutsch',locale:'de-DE',service:'de'},ru:{label:'Русский',locale:'ru-RU',service:'ru'},
 en:{label:'English',locale:'en-GB',service:'en'},el:{label:'Ελληνικά',locale:'el-GR',service:'el'},
 es:{label:'Español',locale:'es-ES',service:'es'},fr:{label:'Français',locale:'fr-FR',service:'fr'},
 pt:{label:'Português',locale:'pt-PT',service:'pt'},ar:{label:'العربية',locale:'ar',service:'ar',dir:'rtl'},
 'zh-Hans':{label:'普通话',locale:'zh-CN',service:'zh-CN'},yue:{label:'廣東話',locale:'zh-HK',service:'zh-TW'}
};
const countryLanguages={};
for(const [language,countries] of Object.entries({
 de:'DE AT LI',ru:'RU',el:'GR CY',es:'ES MX AR BO CL CO CR CU DO EC SV GT HN NI PA PY PE PR UY VE GQ',
 fr:'FR MC BJ BF BI CD CF CG CI CM DJ GA GN HT ML NE SN TD TG KM MG GF GP MQ RE YT PF NC PM WF BL MF',
 pt:'PT BR AO CV GW MZ ST TL',ar:'AE BH DZ EG IQ JO KW LB LY MA MR OM PS QA SA SD SY TN YE',
 'zh-Hans':'CN TW',yue:'HK MO'
}))for(const country of countries.split(' '))countryLanguages[country]=language;
export function browserLanguage(value=''){
 const code=String(value).toLowerCase();
 if(code.startsWith('yue')||code==='zh-hk'||code==='zh-mo')return 'yue';
 if(code.startsWith('zh')||code.startsWith('cmn'))return 'zh-Hans';
 return Object.keys(languages).find(k=>code===k||code.startsWith(k+'-'))||'en';
}
export function languageForLocation(place={},preferences=[]){
 const country=String(place?.countryCode||'').toUpperCase(),region=String(place?.principalSubdivisionCode||'').toUpperCase();
 let options;
 if(country==='CA'&&region==='CA-QC')return 'fr';
 if(country==='CA')options=['en','fr'];
 if(country==='BE')options=['BE-WAL','BE-BRU'].includes(region)?['fr']:['en'];
 if(country==='CH')options=['CH-GE','CH-VD','CH-NE','CH-JU'].includes(region)?['fr']:['CH-FR','CH-VS','CH-BE'].includes(region)?['de','fr']:region==='CH-TI'?['en']:['de','fr','en'];
 if(country==='SG')options=['en','zh-Hans'];
 if(country==='HK'||country==='MO')return 'yue';
 if(country==='CN'&&region==='CN-GD')return 'yue';
 if(options)return preferences.map(browserLanguage).find(code=>options.includes(code))||options[0];
 return countryLanguages[country]||'en';
}
export function readLanguagePreference(storage){
 try{const saved=storage?.getItem('daywear.language');return saved==='auto'||Object.hasOwn(languages,saved)?saved:'auto';}catch{return 'auto';}
}
