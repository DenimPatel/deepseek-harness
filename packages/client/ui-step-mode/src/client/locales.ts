/** `stepMode` namespace dictionaries. */

/** Simplified Chinese dictionary and key-set source of truth. */
export const zh = {
  paused: '已暂停，等待单步',
  'breakpoint.context': '上下文已组装，尚未发起模型请求',
  'breakpoint.tool': '工具 {toolName} 尚未执行',
  position: '第 {turn} 轮 · 第 {step} 步',
  step: '单步',
  'step.hint': 'Shift+Enter',
  resume: '继续运行',
  stop: '停止运行',
  arm: '单步运行',
  'arm.aria': '发送消息，并在每个暂停点停下',
  'arm.failed': '此部署未启用单步模式',
  'controls.aria': '单步控制',
} satisfies Record<string, string>

/** Step-mode dictionary key union. */
export type StepModeKey = keyof typeof zh

/** English dictionary, checked against the Chinese key set. */
export const en = {
  paused: 'Paused for step mode',
  'breakpoint.context': 'Context assembled — the model request has not been sent',
  'breakpoint.tool': 'Tool {toolName} has not been dispatched',
  position: 'Turn {turn} · Step {step}',
  step: 'Step',
  'step.hint': 'Shift+Enter',
  resume: 'Resume',
  stop: 'Stop',
  arm: 'Step run',
  'arm.aria': 'Send the prompt and pause at each step',
  'arm.failed': 'Step mode is unavailable in this deployment',
  'controls.aria': 'Step controls',
} satisfies Record<StepModeKey, string>
