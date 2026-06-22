import { create } from 'zustand';

export type LogEntryType = 'stdout' | 'stderr' | 'error' | 'info' | 'progress';

export interface LogEntry {
  type: LogEntryType;
  text: string;
  timestamp: number;
}

export interface PendingInput {
  requestId: string;
  prompt: string;
  inputType: 'text' | 'number' | 'select';
  options?: string[];
  defaultValue?: string;
}

export interface WorkflowExecutionState {
  isOpen: boolean;
  isExecuting: boolean;
  activityIri: string | null;
  activityLabel: string | null;
  progress: number;
  progressStage: string | null;
  log: LogEntry[];
  pendingInput: PendingInput | null;
  error: string | null;
  executionTime: number | null;

  open: (activityIri: string, label: string) => void;
  close: () => void;
  setExecuting: (executing: boolean) => void;
  setProgress: (percent: number, stage: string) => void;
  appendLog: (entry: LogEntry) => void;
  setPendingInput: (input: PendingInput | null) => void;
  setError: (error: string | null) => void;
  setExecutionTime: (ms: number | null) => void;
  reset: () => void;
}

const INITIAL_STATE = {
  isOpen: false,
  isExecuting: false,
  activityIri: null as string | null,
  activityLabel: null as string | null,
  progress: 0,
  progressStage: null as string | null,
  log: [] as LogEntry[],
  pendingInput: null as PendingInput | null,
  error: null as string | null,
  executionTime: null as number | null,
};

let logBuffer: LogEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

export const useWorkflowExecutionStore = create<WorkflowExecutionState>((set, get) => ({
  ...INITIAL_STATE,

  open: (activityIri, label) => {
    if (get().isExecuting) {
      set({ isOpen: true });
    } else {
      logBuffer = [];
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      set({
        ...INITIAL_STATE,
        isOpen: true,
        activityIri,
        activityLabel: label,
      });
    }
  },

  close: () => set({ isOpen: false }),

  setExecuting: (executing) => set({ isExecuting: executing }),

  setProgress: (percent, stage) => set({ progress: percent, progressStage: stage }),

  appendLog: (entry) => {
    logBuffer.push(entry);
    if (!flushTimer) {
      flushTimer = setTimeout(() => {
        flushTimer = null;
        const batch = logBuffer;
        logBuffer = [];
        set((s) => ({ log: [...s.log, ...batch] }));
      }, 100);
    }
  },

  setPendingInput: (input) => set({ pendingInput: input }),

  setError: (error) => set({ error }),

  setExecutionTime: (ms) => set({ executionTime: ms }),

  reset: () => {
    logBuffer = [];
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    set(INITIAL_STATE);
  },
}));
