import { Page, Frame, FrameLocator } from '@playwright/test';
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

/** MCP tool call parsed from a seed. */
export interface ToolCall {
  kind: 'tool';
  name: string;
  arguments: Record<string, unknown>;
}

/** UI action parsed from an ```action block. */
export interface SeedAction {
  kind: 'action';
  type: 'click' | 'fill' | 'scroll' | 'drag' | 'hover' | 'key' | 'wait' | 'waitFor';
  selector?: string;
  value?: string;
  dx?: number;
  dy?: number;
  ms?: number;
}

/** One step in a seed — either a tool call or a UI action. */
export type SeedStep = ToolCall | SeedAction;

/** Parsed turn from a seed markdown file. */
export interface SeedTurn {
  caption: string;
  toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>;
  steps: SeedStep[];
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class DemoRunner {
  private chatFrame!: FrameLocator;
  private appFrame!: FrameLocator;
  private chatFrameHandle!: Frame;
  private appFrameHandle!: Frame;

  constructor(private page: Page, private baseURL: string) {}

  private async waitForFrame(predicate: (f: Frame) => boolean, timeout = 15_000): Promise<Frame> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const found = this.page.frames().find(predicate);
      if (found) return found;
      await this.page.waitForTimeout(200);
    }
    throw new Error('waitForFrame: timed out');
  }

  /** Open demo-stage.html and wait for both iframes to be ready. */
  async openStage(): Promise<void> {
    await this.page.goto(`${this.baseURL}/demo-stage.html`);

    this.chatFrame = this.page.frameLocator('iframe >> nth=0');
    this.appFrame  = this.page.frameLocator('iframe >> nth=1');

    this.chatFrameHandle = await this.waitForFrame(
      f => f.url().includes('relay-mock-chat'),
    );
    this.appFrameHandle = await this.waitForFrame(
      f => f.url().startsWith(this.baseURL)
        && !f.url().includes('relay-mock-chat')
        && !f.url().includes('demo-stage'),
    );

    await this.appFrameHandle.waitForFunction(
      () => !!(window as any).__mcpTools && typeof (window as any).__mcpTools['addNode'] === 'function',
      { timeout: 20_000 },
    );
  }

  /** Inject bookmarklet into the chat iframe; waits for relay popup. */
  async injectBookmarklet(): Promise<void> {
    const bookmarkletSrc = fs.readFileSync(
      path.resolve(__dirname, '../public/relay-bookmarklet.js'), 'utf8',
    )
      .replace(/__RELAY_ORIGIN__/g, this.baseURL)
      .replace(/__RELAY_URL__/g, `${this.baseURL}/relay.html`);

    const popupPromise = this.page.waitForEvent('popup', { timeout: 10_000 });
    await this.chatFrameHandle.evaluate((src) => {
      (window as any).__vgRelayActive = false;
      new Function(src)();
    }, bookmarkletSrc);
    const relayPopup = await popupPromise;
    await relayPopup.waitForLoadState('domcontentloaded');
  }

  /** Click a scenario button in the mock chat. */
  async clickScenario(name: 'single' | 'batch' | 'full' | 'prefixed' | 'unknown-tool'): Promise<void> {
    await this.chatFrame.locator(`[data-scenario="${name}"]`).click();
  }

  /** Switch UI mode in the mock chat. */
  async switchMode(mode: 'fhgenie' | 'openwebui' | 'chatgpt'): Promise<void> {
    await this.chatFrame.locator(`#mode-${mode}`).click();
  }

  /** Wait for a Ontosphere result to appear in the chat stream. */
  async waitForResult(timeout = 15_000): Promise<string> {
    const locator = this.chatFrame.locator('#chat-stream .msg-user', { hasText: '[Ontosphere' }).last();
    await locator.waitFor({ state: 'visible', timeout });
    return locator.innerText();
  }

  /** Clear the chat. */
  async clearChat(): Promise<void> {
    await this.chatFrame.locator('[data-scenario="clear"]').click();
  }

  /** Open the app alone (full viewport) and wait for MCP tools to be ready. */
  async openApp(): Promise<void> {
    await this.page.goto(this.baseURL);
    await this.page.waitForFunction(
      () => !!(window as any).__mcpTools && typeof (window as any).__mcpTools['addNode'] === 'function',
      { timeout: 20_000 },
    );
  }

  // ── Seed parsing ─────────────────────────────────────────────────────────

  /** Parse an ```action block line into a SeedAction. Returns null for unknown types. */
  private static parseActionLine(line: string): SeedAction | null {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return null;

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) return null;

    const type = trimmed.slice(0, colonIdx).trim().toLowerCase();
    const rest = trimmed.slice(colonIdx + 1).trim();

    switch (type) {
      case 'click':
        return { kind: 'action', type: 'click', selector: rest };
      case 'hover':
        return { kind: 'action', type: 'hover', selector: rest };
      case 'waitfor':
        return { kind: 'action', type: 'waitFor', selector: rest };
      case 'key':
        return { kind: 'action', type: 'key', value: rest };
      case 'wait': {
        const ms = parseInt(rest, 10);
        return isNaN(ms) ? null : { kind: 'action', type: 'wait', ms };
      }
      case 'fill': {
        const pipeIdx = rest.indexOf('|');
        if (pipeIdx === -1) return null;
        return { kind: 'action', type: 'fill', selector: rest.slice(0, pipeIdx).trim(), value: rest.slice(pipeIdx + 1).trim() };
      }
      case 'scroll': {
        const parts = rest.split(/\s+/).map(Number);
        if (parts.length < 2 || parts.some(isNaN)) return null;
        return { kind: 'action', type: 'scroll', dx: parts[0], dy: parts[1] };
      }
      case 'drag': {
        const pipeIdx = rest.indexOf('|');
        if (pipeIdx === -1) return null;
        const sel = rest.slice(0, pipeIdx).trim();
        const nums = rest.slice(pipeIdx + 1).trim().split(/\s+/).map(Number);
        if (nums.length < 2 || nums.some(isNaN)) return null;
        return { kind: 'action', type: 'drag', selector: sel, dx: nums[0], dy: nums[1] };
      }
      default:
        return null;
    }
  }

  /**
   * Parse a seed markdown file into turns.
   * Each turn groups JSON-RPC tool calls and UI action blocks under the nearest
   * preceding snapshot caption (or the assistant turn prose if no snapshot follows).
   */
  static parseSeed(seedPath: string): SeedTurn[] {
    const content = fs.readFileSync(seedPath, 'utf8');
    const lines = content.split('\n');
    const turns: SeedTurn[] = [];
    let current: SeedTurn | null = null;

    const TOOL_RE = /^`(\{"jsonrpc":"2\.0",.+\})`\s*$/;
    let inSnapshot = false;
    let snapshotCaption = '';
    let inAction = false;

    const flush = () => {
      if (current && current.steps.length > 0) {
        turns.push(current);
        current = null;
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Snapshot blocks
      if (line.startsWith('```snapshot')) {
        inSnapshot = true;
        snapshotCaption = '';
        continue;
      }
      if (inSnapshot) {
        if (line.startsWith('```')) {
          inSnapshot = false;
          if (current) current.caption = snapshotCaption || current.caption;
          continue;
        }
        const m = line.match(/^caption:\s*(.+)/);
        if (m) snapshotCaption = m[1].trim();
        continue;
      }

      // Action blocks
      if (line.startsWith('```action')) {
        inAction = true;
        if (!current) current = { caption: '', toolCalls: [], steps: [] };
        continue;
      }
      if (inAction) {
        if (line.startsWith('```')) {
          inAction = false;
          continue;
        }
        const action = DemoRunner.parseActionLine(line);
        if (action && current) {
          current.steps.push(action);
        }
        continue;
      }

      // New assistant or user turn marker
      if (line.startsWith('**Assistant:**') || line.startsWith('**You:**')) {
        flush();
        const prose = line.replace(/\*\*(?:Assistant|You):\*\*\s*/, '').trim();
        current = { caption: prose.substring(0, 120), toolCalls: [], steps: [] };
        continue;
      }

      const toolMatch = line.match(TOOL_RE);
      if (toolMatch) {
        try {
          const rpc = JSON.parse(toolMatch[1]);
          if (rpc.params?.name && current) {
            const tc: ToolCall = { kind: 'tool', name: rpc.params.name, arguments: rpc.params.arguments ?? {} };
            current.toolCalls.push({ name: tc.name, arguments: tc.arguments });
            current.steps.push(tc);
          }
        } catch { /* skip malformed */ }
      }
    }
    flush();
    return turns;
  }

  // ── Step execution ───────────────────────────────────────────────────────

  /** Execute a single UI action on the page. */
  private async executeAction(action: SeedAction): Promise<void> {
    switch (action.type) {
      case 'click':
        await this.page.locator(action.selector!).click();
        break;
      case 'hover':
        await this.page.locator(action.selector!).hover();
        break;
      case 'waitFor':
        await this.page.locator(action.selector!).waitFor({ state: 'visible', timeout: 10_000 });
        break;
      case 'key':
        await this.page.keyboard.press(action.value!);
        break;
      case 'wait':
        await this.page.waitForTimeout(action.ms!);
        break;
      case 'fill':
        await this.page.locator(action.selector!).fill(action.value!);
        break;
      case 'scroll': {
        const vp = this.page.viewportSize() ?? { width: 1920, height: 1080 };
        await this.page.mouse.move(vp.width / 2, vp.height / 2);
        await this.page.mouse.wheel(action.dx!, action.dy!);
        break;
      }
      case 'drag': {
        const box = await this.page.locator(action.selector!).boundingBox();
        if (box) {
          const cx = box.x + box.width / 2;
          const cy = box.y + box.height / 2;
          await this.page.mouse.move(cx, cy);
          await this.page.mouse.down();
          await this.page.mouse.move(cx + action.dx!, cy + action.dy!, { steps: 10 });
          await this.page.mouse.up();
        }
        break;
      }
    }
  }

  /**
   * Execute a parsed seed turn: run each step (tool call or UI action) in order,
   * pausing between steps for visibility.
   */
  async runSeedTurn(
    turn: SeedTurn,
    delayMs = 300,
    opts: { captionAfter?: boolean } = {},
  ): Promise<void> {
    if (turn.caption && !opts.captionAfter) await this.caption(turn.caption);

    for (const step of turn.steps) {
      if (step.kind === 'tool') {
        await this.page.evaluate(
          async ([name, args]: [string, Record<string, unknown>]) => {
            const tool = (window as any).__mcpTools?.[name];
            if (tool) await tool(args);
          },
          [step.name, step.arguments] as [string, Record<string, unknown>],
        );
      } else {
        await this.executeAction(step);
      }
      await this.page.waitForTimeout(delayMs);
    }

    if (turn.caption && opts.captionAfter) await this.caption(turn.caption);
  }

  /** Pause recording for a given number of milliseconds. */
  async pauseMs(ms: number): Promise<void> {
    await this.page.waitForTimeout(ms);
  }

  // ── Stage-mode (side-by-side) helpers ────────────────────────────────────

  /**
   * Add a message to the mock chat frame.
   * role 'user' appears instantly; role 'ai' streams word-by-word.
   */
  async addChatMessage(role: 'user' | 'ai', text: string): Promise<void> {
    await this.chatFrameHandle.evaluate(
      ([r, t]) => { (window as any).addMessage(r, t); },
      [role, text] as [string, string],
    );
  }

  /**
   * Wait for the current AI message to finish streaming.
   * The mock chat sets status-bar text to 'AI done' when stream completes.
   */
  async waitForChatStream(timeout = 60_000): Promise<void> {
    await this.chatFrame
      .locator('#status-bar')
      .filter({ hasText: /AI done/ })
      .waitFor({ state: 'visible', timeout });
  }

  /** Set the mock chat word-streaming speed (ms per word). Default is 18. */
  async setStreamSpeed(msPerWord: number): Promise<void> {
    await this.chatFrameHandle.evaluate(
      (ms) => { (window as any).STREAM_DELAY_MS = ms; },
      msPerWord,
    );
  }

  /**
   * Call an MCP tool on the app iframe (stage mode).
   * Use this instead of runSeedTurn when the app is loaded inside demo-stage.html.
   */
  async callToolOnStage(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<void> {
    await this.appFrameHandle.evaluate(
      async ([n, a]: [string, Record<string, unknown>]) => {
        const tool = (window as any).__mcpTools?.[n];
        if (tool) await tool(a);
      },
      [name, args] as [string, Record<string, unknown>],
    );
  }

  /**
   * Show a caption overlay at the bottom of the viewport.
   * Stays visible until clearCaption() or the next caption() call.
   */
  async caption(text: string): Promise<void> {
    await this.page.evaluate((t) => {
      let el = document.getElementById('__demo_caption__');
      if (!el) {
        el = document.createElement('div');
        el.id = '__demo_caption__';
        Object.assign(el.style, {
          position:        'fixed',
          bottom:          '160px',
          left:            '50%',
          transform:       'translateX(-50%)',
          maxWidth:        '80%',
          padding:         '14px 32px',
          background:      'rgba(0,0,0,0.72)',
          color:           '#fff',
          fontSize:        '28px',
          fontFamily:      'system-ui, sans-serif',
          fontWeight:      '500',
          lineHeight:      '1.4',
          borderRadius:    '8px',
          textAlign:       'center',
          zIndex:          '999999',
          pointerEvents:   'none',
          backdropFilter:  'blur(4px)',
          boxShadow:       '0 4px 24px rgba(0,0,0,0.4)',
          transition:      'opacity 0.25s',
        });
        document.body.appendChild(el);
      }
      el.textContent = t;
      el.style.opacity = '1';
    }, text);
  }

  /** Remove the caption overlay. */
  async clearCaption(): Promise<void> {
    await this.page.evaluate(() => {
      const el = document.getElementById('__demo_caption__');
      if (el) el.remove();
    });
  }

  /**
   * Show caption, pause for ms, then clear it.
   * Convenience wrapper for show-read-hide pattern.
   */
  async captionPause(text: string, ms = 3_000): Promise<void> {
    await this.caption(text);
    await this.pauseMs(ms);
    await this.clearCaption();
  }
}
