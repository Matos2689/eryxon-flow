import type { RealtimeChannel, RealtimeChannelOptions } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';

interface RealtimeSystemMessage {
  status?: string;
  message?: string;
  extension?: string;
}

interface ChannelFactory {
  channel(name: string, opts?: RealtimeChannelOptions): RealtimeChannel;
}

/**
 * Logs Realtime subscriptions the server rejects.
 *
 * When one postgres_changes binding of a channel is invalid (e.g. a table outside the
 * supabase_realtime publication), the server refuses the channel's database changes as a whole
 * but the channel still reports SUBSCRIBED: the refusal only arrives as a `system` message. Without
 * this, a screen silently stops updating. Installed once on the client, so it covers every channel
 * without each caller having to listen for it.
 */
export function installRealtimeErrorLogging(client: ChannelFactory): void {
  const watched = new WeakSet<RealtimeChannel>();
  const createChannel = client.channel.bind(client);

  client.channel = (name, opts) => {
    const channel = createChannel(name, opts);

    // channel() returns the existing instance for a topic already in use; listen only once.
    if (!watched.has(channel)) {
      watched.add(channel);
      channel.on('system', {}, (payload: RealtimeSystemMessage) => {
        if (payload?.status === 'error') {
          logger.error('Realtime', `Subscription rejected for ${channel.topic}: ${payload.message ?? 'unknown error'}`, payload);
        }
      });
    }

    return channel;
  };
}
