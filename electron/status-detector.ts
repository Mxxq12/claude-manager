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
  private recentOutput: string = '';
  private currentStatus: 'busy' | 'idle' = 'idle';
  private onStatusChange: (status: 'busy' | 'idle', subStatus?: 'input' | 'approval') => void;
  private significantDataReceived: boolean = false;

  constructor(onStatusChange: (status: 'busy' | 'idle', subStatus?: 'input' | 'approval') => void) {
    this.onStatusChange = onStatusChange;
  }

  onData(rawData: string): void {
    // Ignore tiny outputs (cursor blinks, status line updates, etc.)
    const stripped = stripAnsi(rawData);
    if (stripped.length <= 2 && !stripped.includes('\n')) {
      // Still reset idle timer for tiny outputs, but don't flip to busy
      this.resetIdleTimer();
      return;
    }

    this.recentOutput += rawData;
    if (this.recentOutput.length > 2000) {
      this.recentOutput = this.recentOutput.slice(-2000);
    }

    this.significantDataReceived = true;

    if (this.currentStatus !== 'busy') {
      this.currentStatus = 'busy';
      this.onStatusChange('busy');
    }

    this.resetIdleTimer();
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);

    this.idleTimer = setTimeout(() => {
      if (this.currentStatus === 'busy') {
        // Check what kind of idle state
        const stripped = stripAnsi(this.recentOutput);
        const lastLines = stripped.split('\n').slice(-5).join('\n');
        const type = detectPromptType(lastLines);

        this.currentStatus = 'idle';
        this.onStatusChange('idle', type ?? 'input');
      }
    }, 3000); // 3 seconds of no significant output = idle
  }

  dispose(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
  }
}
