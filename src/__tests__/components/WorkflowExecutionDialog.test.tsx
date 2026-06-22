import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { WorkflowExecutionDialog } from '../../components/Canvas/WorkflowExecutionDialog';
import { useWorkflowExecutionStore } from '../../stores/workflowExecutionStore';

vi.mock('../../utils/pyodideManager.workerClient', () => ({
  getPyodideClient: () => ({
    respondToInput: vi.fn(),
  }),
}));

describe('WorkflowExecutionDialog', () => {
  beforeEach(() => {
    useWorkflowExecutionStore.getState().reset();
  });

  it('renders nothing when isOpen=false', () => {
    const { container } = render(<WorkflowExecutionDialog />);
    expect(container.innerHTML).toBe('');
  });

  it('renders overlay when isOpen=true', () => {
    useWorkflowExecutionStore.setState({ isOpen: true, activityLabel: 'Load Data' });
    const { container } = render(<WorkflowExecutionDialog />);
    expect(container.querySelector('h2')?.textContent).toContain('Load Data');
  });

  it('renders log entries with correct styling per type', () => {
    useWorkflowExecutionStore.setState({
      isOpen: true,
      log: [
        { type: 'stdout', text: 'hello world', timestamp: 1 },
        { type: 'stderr', text: 'warning msg', timestamp: 2 },
        { type: 'info', text: 'Step: Load', timestamp: 3 },
      ],
    });
    const { container } = render(<WorkflowExecutionDialog />);
    const logEntries = container.querySelectorAll('.font-mono');
    expect(logEntries.length).toBeGreaterThanOrEqual(3);
    expect(logEntries[0].textContent).toBe('hello world');
    expect(logEntries[1].textContent).toBe('warning msg');
    expect(logEntries[1].className).toContain('orange');
    expect(logEntries[2].textContent).toBe('Step: Load');
  });

  it('shows progress bar when executing with progress > 0', () => {
    useWorkflowExecutionStore.setState({
      isOpen: true,
      isExecuting: true,
      progress: 42,
      progressStage: 'Installing packages',
    });
    const { container } = render(<WorkflowExecutionDialog />);
    expect(container.querySelector('[role="progressbar"]')).toBeTruthy();
    expect(container.textContent).toContain('Installing packages');
  });

  it('renders pending input field with prompt text', () => {
    useWorkflowExecutionStore.setState({
      isOpen: true,
      pendingInput: { requestId: 'r1', prompt: 'Enter your name:', inputType: 'text' },
    });
    const { container } = render(<WorkflowExecutionDialog />);
    expect(container.textContent).toContain('Enter your name:');
    expect(container.querySelector('input[placeholder="Type your response…"]')).toBeTruthy();
  });

  it('renders select input when inputType=select', () => {
    useWorkflowExecutionStore.setState({
      isOpen: true,
      pendingInput: {
        requestId: 'r1',
        prompt: 'Choose:',
        inputType: 'select',
        options: ['Option A', 'Option B'],
      },
    });
    const { container } = render(<WorkflowExecutionDialog />);
    const select = container.querySelector('select');
    expect(select).toBeTruthy();
    const options = select!.querySelectorAll('option');
    expect(options.length).toBe(2);
    expect(options[0].textContent).toBe('Option A');
  });

  it('close button calls store.close()', () => {
    useWorkflowExecutionStore.setState({ isOpen: true, activityLabel: 'Test' });
    const { container } = render(<WorkflowExecutionDialog />);
    const closeBtn = container.querySelector('button[aria-label="Close"]') as HTMLElement;
    expect(closeBtn).toBeTruthy();
    fireEvent.click(closeBtn);
    expect(useWorkflowExecutionStore.getState().isOpen).toBe(false);
  });

  it('shows error state', () => {
    useWorkflowExecutionStore.setState({
      isOpen: true,
      error: 'Something went wrong',
    });
    const { container } = render(<WorkflowExecutionDialog />);
    expect(container.textContent).toContain('Something went wrong');
    expect(container.textContent).toContain('Error');
  });

  it('shows execution time when not executing', () => {
    useWorkflowExecutionStore.setState({
      isOpen: true,
      isExecuting: false,
      executionTime: 2500,
    });
    const { container } = render(<WorkflowExecutionDialog />);
    expect(container.textContent).toContain('2.5s');
  });
});
