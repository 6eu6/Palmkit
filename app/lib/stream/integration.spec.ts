/**
 * Stream Architecture — end-to-end integration test
 *
 * Tests the full pipeline:
 *   Server (StreamEventBus) → wire → Client (StreamEventRouter) → Stores
 *
 * This test does NOT hit a real server — it uses a mocked ReadableStream
 * that emits events via StreamEventBus, then consumes them via
 * StreamEventRouter, and verifies the stores are populated correctly.
 *
 * Run: npx vitest run app/lib/stream/integration.spec.ts
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { StreamEventBus } from './event-bus';
import { StreamEventRouter } from './stream-router';
import {
  chatMessagesStore,
  reasoningStore,
  activityStore,
  streamStatusStore,
  clearChatMessages,
  clearReasoning,
  clearActivity,
  resetStreamStatus,
} from './stores';

beforeEach(() => {
  clearChatMessages();
  clearReasoning();
  clearActivity();
  resetStreamStatus();
});

describe('Stream Architecture — End-to-End', () => {
  it('full discuss flow: stream:start → message:* → stream:end', async () => {
    // Server side: emit events
    const bus = new StreamEventBus();
    const messageId = 'msg-1';

    bus.emitStreamStart({
      mode: 'discuss',
      intent: 'user-question',
      confidence: 0.95,
      messageId,
    });
    bus.emitStatusUpdate({ text: 'Analyzing your request...', icon: 'ph:brain-duotone' });
    bus.emitMessageStart({ role: 'assistant', messageId });
    bus.emitMessageDelta({ messageId, text: 'Hello ' });
    bus.emitMessageDelta({ messageId, text: 'world!' });
    bus.emitMessageEnd({ messageId });
    bus.emitStreamEnd({
      reason: 'complete',
      messageId,
      stats: { durationMs: 1234, tokenCount: 50 },
    });

    // Client side: consume the response body
    const router = new StreamEventRouter();
    await router.consume(bus.response.body);

    // Verify stores
    const status = streamStatusStore.get();
    expect(status.active).toBe(false);
    expect(status.mode).toBe('discuss');
    expect(status.endReason).toBe('complete');
    expect(status.stats?.durationMs).toBe(1234);
    expect(status.stats?.tokenCount).toBe(50);

    const messages = chatMessagesStore.get();
    expect(messages).toHaveLength(1);
    expect(messages[0].text).toBe('Hello world!');
    expect(messages[0].role).toBe('assistant');

    const activity = activityStore.get();
    expect(activity.toolCalls).toHaveLength(0);
    expect(activity.buildStatus).toBeNull();
    expect(activity.buildFiles).toHaveLength(0);
  });

  it('full build flow: stream:start → build:status → tool:* → message:* → stream:end', async () => {
    const bus = new StreamEventBus();
    const messageId = 'msg-2';
    const callId = 'call-1';

    bus.emitStreamStart({
      mode: 'build',
      intent: 'build-app',
      confidence: 0.9,
      messageId,
    });
    bus.emitBuildStatus({
      status: 'planning',
      message: 'Planning build approach',
      icon: 'ph:hammer-duotone',
      severity: 'info',
    });
    bus.emitBuildStatus({
      status: 'building',
      message: 'Generating files',
      icon: 'ph:hammer-duotone',
      severity: 'info',
    });
    bus.emitToolCall({
      callId,
      toolName: 'read_file',
      args: { path: 'src/App.tsx' },
      icon: 'ph:file-text-duotone',
      label: 'Read src/App.tsx',
    });
    bus.emitToolResult({
      callId,
      ok: true,
      durationMs: 12,
      icon: 'ph:file-text-duotone',
      summary: '32 lines',
    });
    bus.emitBuildFile({ path: 'src/App.tsx', action: 'create', linesAdded: 32 });
    bus.emitBuildFile({ path: 'src/Button.tsx', action: 'create', linesAdded: 15 });
    bus.emitMessageStart({ role: 'assistant', messageId });
    bus.emitMessageDelta({ messageId, text: 'Build complete.' });
    bus.emitMessageEnd({ messageId });
    bus.emitBuildStatus({
      status: 'complete',
      message: 'Build complete — ready for preview',
      icon: 'ph:check-circle-duotone',
      severity: 'success',
    });
    bus.emitStreamEnd({
      reason: 'complete',
      messageId,
      stats: { durationMs: 5000, segments: 1 },
    });

    const router = new StreamEventRouter();
    await router.consume(bus.response.body);

    // Verify status
    const status = streamStatusStore.get();
    expect(status.mode).toBe('build');
    expect(status.endReason).toBe('complete');

    // Verify activity
    const activity = activityStore.get();
    expect(activity.toolCalls).toHaveLength(1);
    expect(activity.toolCalls[0].toolName).toBe('read_file');
    expect(activity.toolCalls[0].ok).toBe(true);
    expect(activity.toolCalls[0].durationMs).toBe(12);
    expect(activity.buildFiles).toHaveLength(2);
    expect(activity.buildFiles[0].path).toBe('src/App.tsx');
    expect(activity.buildStatus?.status).toBe('complete');
    expect(activity.buildStatus?.severity).toBe('success');

    // Verify message
    const messages = chatMessagesStore.get();
    expect(messages).toHaveLength(1);
    expect(messages[0].text).toBe('Build complete.');
  });

  it('build retry flow: emit build:retry events', async () => {
    const bus = new StreamEventBus();
    bus.emitStreamStart({
      mode: 'build',
      intent: 'test',
      confidence: 1,
      messageId: 'm1',
    });
    bus.emitBuildRetry({
      attempt: 1,
      maxAttempts: 2,
      reason: 'missing package.json',
      icon: 'ph:spinner-duotone',
    });
    bus.emitBuildRetry({
      attempt: 2,
      maxAttempts: 2,
      reason: 'missing entry point',
      icon: 'ph:spinner-duotone',
    });
    bus.emitBuildStatus({
      status: 'failed',
      message: 'Build failed after 2 attempts',
      icon: 'ph:x-circle-duotone',
      severity: 'error',
    });
    bus.emitStreamEnd({ reason: 'error', messageId: 'm1', error: 'build failed' });

    const router = new StreamEventRouter();
    await router.consume(bus.response.body);

    const activity = activityStore.get();
    expect(activity.buildRetries).toHaveLength(2);
    expect(activity.buildRetries[0].attempt).toBe(1);
    expect(activity.buildRetries[1].attempt).toBe(2);
    expect(activity.buildStatus?.status).toBe('failed');
    expect(activity.buildStatus?.severity).toBe('error');

    const status = streamStatusStore.get();
    expect(status.endReason).toBe('error');
    expect(status.errorMessage).toBe('build failed');
  });

  it('cancel flow: stream:end with reason=cancelled', async () => {
    const bus = new StreamEventBus();
    bus.emitStreamStart({
      mode: 'build',
      intent: 'test',
      confidence: 1,
      messageId: 'm1',
    });
    bus.emitMessageStart({ role: 'assistant', messageId: 'm1' });
    bus.emitMessageDelta({ messageId: 'm1', text: 'partial...' });

    // No message:end — client cancelled mid-stream
    bus.emitStreamEnd({
      reason: 'cancelled',
      messageId: 'm1',
      stats: { durationMs: 2000 },
    });

    const router = new StreamEventRouter();
    await router.consume(bus.response.body);

    const status = streamStatusStore.get();
    expect(status.endReason).toBe('cancelled');
    expect(status.active).toBe(false);

    // Message still appears in chat (partial)
    const messages = chatMessagesStore.get();
    expect(messages).toHaveLength(1);
    expect(messages[0].text).toBe('partial...');
    expect(messages[0].endedAt).toBeUndefined(); // never got message:end
  });

  it('reasoning flow: reasoning:* events are separated from message:*', async () => {
    const bus = new StreamEventBus();
    const messageId = 'm1';

    bus.emitStreamStart({
      mode: 'discuss',
      intent: 'reasoning-test',
      confidence: 1,
      messageId,
    });
    bus.emitMessageStart({ role: 'assistant', messageId });
    bus.emitReasoningStart({ messageId });
    bus.emitReasoningDelta({ messageId, text: 'Let me think about this...' });
    bus.emitReasoningDelta({ messageId, text: ' The answer is 42.' });
    bus.emitReasoningEnd({ messageId });
    bus.emitMessageDelta({ messageId, text: 'The answer is 42.' });
    bus.emitMessageEnd({ messageId });
    bus.emitStreamEnd({ reason: 'complete', messageId });

    const router = new StreamEventRouter();
    await router.consume(bus.response.body);

    // Reasoning is in reasoningStore, NOT in chatMessagesStore
    const reasoning = reasoningStore.get();
    expect(reasoning).toHaveLength(1);
    expect(reasoning[0].text).toBe('Let me think about this... The answer is 42.');

    const messages = chatMessagesStore.get();
    expect(messages).toHaveLength(1);
    expect(messages[0].text).toBe('The answer is 42.');
    expect(messages[0].text).not.toContain('Let me think');
  });

  it('diagnostic events are dropped silently (no UI surface)', async () => {
    const bus = new StreamEventBus();
    bus.emitStreamStart({
      mode: 'discuss',
      intent: 'test',
      confidence: 1,
      messageId: 'm1',
    });
    bus.emitKeepalive('worker');
    bus.emitLog({ level: 'debug', source: 'test', message: 'debug msg' });
    bus.emitKeepalive('llm');
    bus.emitStreamEnd({ reason: 'complete', messageId: 'm1' });

    const router = new StreamEventRouter();
    await router.consume(bus.response.body);

    // No state changes from diag events
    const messages = chatMessagesStore.get();
    expect(messages).toHaveLength(0);

    const activity = activityStore.get();
    expect(activity.toolCalls).toHaveLength(0);
    expect(activity.buildStatus).toBeNull();
  });

  it('preserves event ordering across mixed event types', async () => {
    const bus = new StreamEventBus();
    const messageId = 'm1';
    const callId = 'c1';

    const expectedOrder = [
      'stream:start',
      'message:start',
      'reasoning:start',
      'reasoning:delta',
      'reasoning:end',
      'tool:call',
      'tool:result',
      'message:delta',
      'build:status',
      'build:file',
      'message:end',
      'stream:end',
    ] as const;

    bus.emitStreamStart({ mode: 'build', intent: 't', confidence: 1, messageId });
    bus.emitMessageStart({ role: 'assistant', messageId });
    bus.emitReasoningStart({ messageId });
    bus.emitReasoningDelta({ messageId, text: 'thinking' });
    bus.emitReasoningEnd({ messageId });
    bus.emitToolCall({
      callId,
      toolName: 'read_file',
      args: {},
      icon: 'ph:file-text-duotone',
      label: 'read',
    });
    bus.emitToolResult({
      callId,
      ok: true,
      icon: 'ph:file-text-duotone',
      durationMs: 10,
    });
    bus.emitMessageDelta({ messageId, text: 'response' });
    bus.emitBuildStatus({
      status: 'building',
      message: '...',
      icon: 'ph:hammer-duotone',
      severity: 'info',
    });
    bus.emitBuildFile({ path: 'App.tsx', action: 'create' });
    bus.emitMessageEnd({ messageId });
    bus.emitStreamEnd({ reason: 'complete', messageId });

    const router = new StreamEventRouter();

    // Capture event order via onEvent
    const receivedOrder: string[] = [];
    const routerWithCapture = new StreamEventRouter({
      onEvent: (e) => receivedOrder.push(e.kind),
    });

    // Read events from the bus manually
    const reader = bus.response.body!.getReader();
    const decoder = new TextDecoder();
    const buffer = { text: '' };
    const { decodeStreamEvents } = await import('./event-bus');

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      const text = decoder.decode(value, { stream: true });
      const events = decodeStreamEvents(buffer, text);

      for (const event of events) {
        routerWithCapture.route(event);
      }
    }

    expect(receivedOrder).toEqual(expectedOrder);
    void router; // keep ref
  });
});
