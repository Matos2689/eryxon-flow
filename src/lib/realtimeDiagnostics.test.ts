import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { installRealtimeErrorLogging } from './realtimeDiagnostics';
import { logger } from '@/lib/logger';

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));

type SystemHandler = (payload: unknown) => void;

function fakeChannel(topic: string) {
  const systemHandlers: SystemHandler[] = [];
  const channel = {
    topic,
    on: vi.fn((type: string, _filter: unknown, handler: SystemHandler) => {
      if (type === 'system') systemHandlers.push(handler);
      return channel;
    }),
  };
  return { channel: channel as unknown as RealtimeChannel, systemHandlers };
}

function clientReturning(channel: RealtimeChannel) {
  return { channel: vi.fn((_name: string) => channel) };
}

describe('installRealtimeErrorLogging', () => {
  beforeEach(() => vi.clearAllMocks());

  it('logs a subscription the server rejects', () => {
    const { channel, systemHandlers } = fakeChannel('realtime:qrm');
    const client = clientReturning(channel);
    installRealtimeErrorLogging(client);

    client.channel('qrm');
    systemHandlers.forEach((handler) => handler({ status: 'error', message: 'Unable to subscribe to changes' }));

    expect(logger.error).toHaveBeenCalledWith(
      'Realtime',
      'Subscription rejected for realtime:qrm: Unable to subscribe to changes',
      expect.objectContaining({ status: 'error' }),
    );
  });

  it('stays quiet when the subscription is accepted', () => {
    const { channel, systemHandlers } = fakeChannel('realtime:qrm');
    const client = clientReturning(channel);
    installRealtimeErrorLogging(client);

    client.channel('qrm');
    systemHandlers.forEach((handler) => handler({ status: 'ok', message: 'Subscribed to PostgreSQL' }));

    expect(logger.error).not.toHaveBeenCalled();
  });

  it('listens once when the same channel instance is returned again', () => {
    const { channel, systemHandlers } = fakeChannel('realtime:qrm');
    const client = clientReturning(channel);
    installRealtimeErrorLogging(client);

    client.channel('qrm');
    client.channel('qrm');

    expect(systemHandlers).toHaveLength(1);
  });
});
