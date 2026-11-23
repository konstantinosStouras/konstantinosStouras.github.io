const choices = {
  openai: [['gpt-6-luna','cheap'],['gpt-6.2-sol','medium'],['gpt-6.2-astra','more expensive']],
  anthropic: [['claude-haiku-4-5-20251001','cheap'],['claude-sonnet-5-5','medium'],['claude-opus-5-5','more expensive']],
  google: [['gemini-3.1-flash-lite','cheap'],['gemini-4-hydrogen','medium'],['gemini-4-neon','more expensive']],
  mistral: [['mistral-small-latest','cheap'],['mistral-medium-latest','medium'],['mistral-large-latest','more expensive']],
  deepseek: [['deepseek-flash','cheap'],['deepseek-v4-pro','more expensive']],
  xai: [['grok-4.7','medium']],
  cohere: [['command-a-03-2025','more expensive']],
  moonshot: [['kimi-k2.7-code','medium'],['kimi-k3','more expensive']],
  alibaba: [['qwen3.6-flash-us','cheap'],['qwen4-max','more expensive']],
  openrouter: [['openai/gpt-6-luna','cheap'],['anthropic/claude-sonnet-5.5','medium'],['openai/gpt-6.2-astra','more expensive']]
};
export function modelLabel(provider,id) {
  const choice = choices[provider]?.find(([model]) => model === id);
  return choice ? id + ' (' + choice[1] + ')' : '';
}
export function availableChoices(provider,ids) {
  return (choices[provider] || []).filter(([id]) => ids.includes(id)).map(([id]) => id);
}
