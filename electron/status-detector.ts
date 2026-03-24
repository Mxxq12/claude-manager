const ANSI_REGEX = /\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?(?:\x07|\x1b\\)/g;

export function stripAnsi(str: string): string {
  return str.replace(ANSI_REGEX, '');
}

const INPUT_PROMPT_REGEX = />\s*$/;
const APPROVAL_KEYWORDS = /\b(Allow|allow|Yes\s*\/\s*No|yes\s*\/\s*no|approve|permission|y\/n)\b/i;

export function detectPromptType(strippedOutput: string): 'input' | 'approval' | null {
  if (APPROVAL_KEYWORDS.test(strippedOutput)) {
    return 'approval';
  }
  if (INPUT_PROMPT_REGEX.test(strippedOutput)) {
    return 'input';
  }
  return null;
}

export class StatusDetector {
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private approvalTimer: ReturnType<typeof setTimeout> | null = null;
  private recentOutput: string = '';
  private onStatusChange: (status: 'busy' | 'idle', subStatus?: 'input' | 'approval') => void;

  constructor(onStatusChange: (status: 'busy' | 'idle', subStatus?: 'input' | 'approval') => void) {
    this.onStatusChange = onStatusChange;
  }

  onData(rawData: string): void {
    this.recentOutput += rawData;
    if (this.recentOutput.length > 2000) {
      this.recentOutput = this.recentOutput.slice(-2000);
    }

    this.onStatusChange('busy');
    this.resetTimers();

    this.approvalTimer = setTimeout(() => {
      const stripped = stripAnsi(this.recentOutput);
      const lastLines = stripped.split('\n').slice(-5).join('\n');
      const type = detectPromptType(lastLines);
      if (type === 'approval') {
        this.onStatusChange('idle', 'approval');
      }
    }, 1000);

    this.idleTimer = setTimeout(() => {
      const stripped = stripAnsi(this.recentOutput);
      const lastLines = stripped.split('\n').slice(-5).join('\n');
      const type = detectPromptType(lastLines);
      if (type === 'input') {
        this.onStatusChange('idle', 'input');
      }
    }, 2000);
  }

  private resetTimers(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.approvalTimer) clearTimeout(this.approvalTimer);
  }

  dispose(): void {
    this.resetTimers();
  }
}
