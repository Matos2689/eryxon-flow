import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useJobIssues } from './useJobIssues';

// Mock Supabase
const mockRpc = vi.fn();
const issueBindings: { filter?: string; callback: (payload: unknown) => void }[] = [];

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: (...args: any[]) => mockRpc(...args),
    channel: () => {
      const channel = {
        on: (_type: string, config: { filter?: string }, callback: (payload: unknown) => void) => {
          issueBindings.push({ filter: config.filter, callback });
          return channel;
        },
        subscribe: () => channel,
      };
      return channel;
    },
    removeChannel: vi.fn(),
  },
}));

describe('useJobIssues', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    issueBindings.length = 0;
    mockRpc.mockResolvedValue({
      data: [{ total_count: 0, pending_count: 0, highest_severity: null }],
      error: null,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns default state when no jobId', async () => {
    const { result } = renderHook(() => useJobIssues(undefined));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.totalCount).toBe(0);
    expect(result.current.pendingCount).toBe(0);
    expect(result.current.highestSeverity).toBeNull();
  });

  it('fetches issue summary for job', async () => {
    mockRpc.mockResolvedValue({
      data: [{ total_count: 10, pending_count: 6, highest_severity: 'critical' }],
      error: null,
    });

    const { result } = renderHook(() => useJobIssues('job-1'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.totalCount).toBe(10);
    expect(result.current.pendingCount).toBe(6);
    expect(result.current.highestSeverity).toBe('critical');
  });

  it('calls RPC with correct parameters', async () => {
    renderHook(() => useJobIssues('job-123'));

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalled();
    });

    expect(mockRpc).toHaveBeenCalledWith('get_job_issue_summary', {
      job_id_param: 'job-123',
    });
  });

  it('handles empty data response', async () => {
    mockRpc.mockResolvedValue({
      data: [],
      error: null,
    });

    const { result } = renderHook(() => useJobIssues('job-1'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.totalCount).toBe(0);
    expect(result.current.pendingCount).toBe(0);
    expect(result.current.highestSeverity).toBeNull();
  });

  it('handles error response', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockRpc.mockResolvedValue({
      data: null,
      error: new Error('RPC error'),
    });

    const { result } = renderHook(() => useJobIssues('job-1'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.totalCount).toBe(0);
    expect(result.current.pendingCount).toBe(0);
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('converts string counts to numbers', async () => {
    mockRpc.mockResolvedValue({
      data: [{ total_count: '15', pending_count: '8', highest_severity: 'high' }],
      error: null,
    });

    const { result } = renderHook(() => useJobIssues('job-1'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.totalCount).toBe(15);
    expect(result.current.pendingCount).toBe(8);
  });

  it('refetches when jobId changes', async () => {
    const { rerender } = renderHook(({ jobId }) => useJobIssues(jobId), {
      initialProps: { jobId: 'job-1' },
    });

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledTimes(1);
    });

    rerender({ jobId: 'job-2' });

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledTimes(2);
    });

    expect(mockRpc).toHaveBeenLastCalledWith('get_job_issue_summary', {
      job_id_param: 'job-2',
    });
  });

  it('handles all severity levels', async () => {
    const severities = ['low', 'medium', 'high', 'critical'];

    for (const severity of severities) {
      mockRpc.mockResolvedValue({
        data: [{ total_count: 1, pending_count: 1, highest_severity: severity }],
        error: null,
      });

      const { result } = renderHook(() => useJobIssues(`job-${severity}`));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.highestSeverity).toBe(severity);
    }
  });

  it('refreshes when an issue is created already closed', async () => {
    const { result } = renderHook(() => useJobIssues('job-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockRpc.mockResolvedValue({
      data: [{ total_count: 1, pending_count: 0, highest_severity: 'medium' }],
      error: null,
    });

    // An NCR raised for a scrapped part arrives with status "closed".
    expect(issueBindings).not.toHaveLength(0);
    issueBindings
      .filter((binding) => binding.filter === undefined)
      .forEach((binding) => binding.callback({ eventType: 'INSERT', new: { status: 'closed' } }));

    await waitFor(() => expect(result.current.totalCount).toBe(1));
  });

  it('handles null severity gracefully', async () => {
    mockRpc.mockResolvedValue({
      data: [{ total_count: 0, pending_count: 0, highest_severity: null }],
      error: null,
    });

    const { result } = renderHook(() => useJobIssues('job-no-issues'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.highestSeverity).toBeNull();
  });
});
