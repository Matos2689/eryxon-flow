import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useLiveProductionData, LIVE_PRODUCTION_QUERY_ROOTS } from './useLiveProductionData';

const bindings: { table: string; filter?: string; callback: () => void }[] = [];
const mockChannel = {
  on: vi.fn(),
  subscribe: vi.fn(),
};

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    channel: () => mockChannel,
    removeChannel: vi.fn(),
  },
}));

function setup(tenantId: string | null) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient, children });
  renderHook(() => useLiveProductionData(tenantId, 500), { wrapper });
  return invalidate;
}

describe('useLiveProductionData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    bindings.length = 0;
    mockChannel.on.mockImplementation((_event, config, callback) => {
      bindings.push({ table: config.table, filter: config.filter, callback });
      return mockChannel;
    });
    mockChannel.subscribe.mockImplementation(() => mockChannel);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('listens to every production table of the tenant', () => {
    setup('tenant-1');

    expect(bindings.map((binding) => binding.table)).toEqual(['jobs', 'parts', 'operations', 'operation_quantities']);
    expect(bindings.every((binding) => binding.filter === 'tenant_id=eq.tenant-1')).toBe(true);
  });

  it('refreshes all production queries once after a burst of changes', () => {
    const invalidate = setup('tenant-1');

    act(() => {
      bindings.find((binding) => binding.table === 'operations')!.callback();
      bindings.find((binding) => binding.table === 'operation_quantities')!.callback();
      vi.advanceTimersByTime(499);
    });
    expect(invalidate).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(1); });

    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual(
      LIVE_PRODUCTION_QUERY_ROOTS.map((root) => [root]),
    );
  });

  it('does not subscribe before the tenant is known', () => {
    setup(null);

    expect(mockChannel.subscribe).not.toHaveBeenCalled();
  });
});
