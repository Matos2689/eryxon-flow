import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRealtimeSubscription } from './useRealtimeSubscription';

/**
 * Query key roots holding production data. The lists embed one another (jobs embed parts and
 * operations, parts embed operations), so a change to any production table refreshes them all.
 */
export const LIVE_PRODUCTION_QUERY_ROOTS = [
  'jobs',
  'parts',
  'operations',
  'operation-quantities',
  'production',
  'quality',
  // The Flow columns fetch each row's operations under their own keys.
  'part-flow',
  'job-flow',
] as const;

const PRODUCTION_TABLES = ['jobs', 'parts', 'operations', 'operation_quantities'] as const;

/**
 * Keeps the admin production screens (Jobs, Parts, Operations, their detail dialogs and the QRM
 * operation lists) current while work is reported, e.g. by an integration, without a page reload.
 * Changes are debounced so a burst of updates refreshes once; React Query only refetches the
 * queries on screen and marks the rest stale.
 */
export function useLiveProductionData(tenantId: string | null | undefined, debounceMs = 750): void {
  const queryClient = useQueryClient();

  const refresh = useCallback(() => {
    for (const root of LIVE_PRODUCTION_QUERY_ROOTS) {
      void queryClient.invalidateQueries({ queryKey: [root] });
    }
  }, [queryClient]);

  useRealtimeSubscription({
    channelName: `live-production-${tenantId ?? 'none'}`,
    tables: PRODUCTION_TABLES.map((table) => ({ table, filter: `tenant_id=eq.${tenantId}` })),
    onDataChange: refresh,
    enabled: !!tenantId,
    debounceMs,
  });
}
