const MODEL_EMAIL_MAP: Array<{ keywords: string[]; email: string }> = [
  { keywords: ['claude'], email: 'noreply@anthropic.com' },
  // 由于找不到他们的邮箱和头像, 所以改为了使用我们的邮箱先记录, 后续官方有 github 能用的邮箱可以替换
  // github 组织是不能用 co author 的
  {
    keywords: ['gpt', 'dall-e', 'o1-', 'o3-', 'o4-'],
    email: 'openai@claude-code.win',
  },
  { keywords: ['glm'], email: 'zai-org@claude-code.win' },
  { keywords: ['deepseek'], email: 'deepseek-ai@claude-code.win' },
  { keywords: ['qwen'], email: 'QwenLM@claude-code.win' },
  { keywords: ['minimax'], email: 'MiniMax-AI@claude-code.win' },
  { keywords: ['mimo'], email: 'XiaomiMiMo@claude-code.win' },
  { keywords: ['kimi'], email: 'MoonshotAI@claude-code.win' },
]

export function getAttributionEmail(modelName: string): string {
  const lower = modelName.toLowerCase()
  for (const { keywords, email } of MODEL_EMAIL_MAP) {
    if (keywords.some(kw => lower.includes(kw))) {
      return email
    }
  }
  return 'noreply@anthropic.com'
}
