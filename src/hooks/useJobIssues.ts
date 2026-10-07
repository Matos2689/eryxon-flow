import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { logger } from '@/lib/logger';
import { useTableSubscription } from './useRealtimeSubscription';

interface JobIssueSummary {
  totalCount: number;
  pendingCount: number;
  highestSeverity: 'low' | 'medium' | 'high' | 'critical' | null;
}

export function useJobIssues(jobId: string | undefined) {
  const [summary, setSummary] = useState<JobIssueSummary>({
    totalCount: 0,
    pendingCount: 0,
    highestSeverity: null,
  });
  const [loading, setLoading] = useState(true);

  const fetchIssueSummary = useCallback(async () => {
    if (!jobId) return;

    try {
      setLoading(true);
      const { data, error } = await supabase.rpc('get_job_issue_summary', {
        job_id_param: jobId,
      });

      if (error) throw error;

      if (data && data.length > 0) {
        const result = data[0];
        setSummary({
          totalCount: Number(result.total_count) || 0,
          pendingCount: Number(result.pending_count) || 0,
          highestSeverity: result.highest_severity || null,
        });
      } else {
        setSummary({
          totalCount: 0,
          pendingCount: 0,
          highestSeverity: null,
        });
      }
    } catch (error) {
      logger.error('useJobIssues', 'Error fetching job issue summary', error);
      setSummary({
        totalCount: 0,
        pendingCount: 0,
        highestSeverity: null,
      });
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    if (!jobId) {
      setLoading(false);
      return;
    }

    fetchIssueSummary();
  }, [jobId, fetchIssueSummary]);

  // Every issue change, not only pending ones: the badge counts closed issues too, and an issue can
  // be created already closed (e.g. the NCR an integration raises for a scrapped part). RLS keeps
  // the notifications to the user's tenant.
  useTableSubscription('issues', fetchIssueSummary, {
    enabled: !!jobId,
    debounceMs: 200,
  });

  return { ...summary, loading };
}
