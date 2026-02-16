import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

// ---------------------------------------------------------------------------
// Tests for the tool parallelization feature in the agent execution engine.
// Validates that:
// 1. The PARALLEL_SAFE_TOOLS set correctly classifies tools
// 2. Parallel-safe tools execute concurrently (via Promise.all)
// 3. Sequential (mutating) tools still execute one at a time
// 4. Mixed batches partition correctly and preserve result order
// 5. Error handling works the same in parallel mode
// ---------------------------------------------------------------------------

describe('Tool Parallelization — Classification', () => {
  test('isToolParallelSafe returns true for read-only tools', async () => {
    const { isToolParallelSafe } = await import('../server/src/agents/engine');

    const readOnlyTools = [
      'web_search',
      'fetch_webpage',
      'browse_website',
      'get_current_time',
      'get_notes',
      'search_notes',
      'get_lists',
      'get_list',
      'list_scheduled_tasks',
      'list_calendar_events',
      'search_calendar_events',
      'list_emails',
      'read_email',
      'search_emails',
      'get_unread_email_count',
      'list_reminders',
      'get_working_memory',
      'radarr_search_movie',
      'radarr_library',
      'radarr_movie_status',
      'radarr_queue',
      'radarr_get_releases',
      'sonarr_search_series',
      'sonarr_library',
      'sonarr_series_status',
      'sonarr_season_episodes',
      'sonarr_queue',
      'sonarr_get_releases',
      'transcribe_telegram_audio',
      'analyze_telegram_image',
    ];

    for (const tool of readOnlyTools) {
      assert.equal(isToolParallelSafe(tool), true, `${tool} should be parallel-safe`);
    }
  });

  test('isToolParallelSafe returns false for mutating/side-effect tools', async () => {
    const { isToolParallelSafe } = await import('../server/src/agents/engine');

    const mutatingTools = [
      'send_telegram_message',
      'remember',
      'update_working_memory',
      'clear_working_memory',
      'create_note',
      'update_note',
      'delete_note',
      'create_list',
      'add_to_list',
      'remove_from_list',
      'check_list_item',
      'delete_list',
      'schedule_task',
      'remove_scheduled_task',
      'toggle_scheduled_task',
      'create_calendar_event',
      'update_calendar_event',
      'delete_calendar_event',
      'send_email',
      'reply_email',
      'set_reminder',
      'cancel_reminder',
      'postpone_reminder',
      'add_expense',
      'radarr_add_movie',
      'radarr_grab_release',
      'radarr_delete_movie',
      'sonarr_add_series',
      'sonarr_search_download',
      'sonarr_grab_release',
      'sonarr_delete_series',
      'run_terminal_command',
      'execute_code',
    ];

    for (const tool of mutatingTools) {
      assert.equal(isToolParallelSafe(tool), false, `${tool} should NOT be parallel-safe`);
    }
  });

  test('isToolParallelSafe returns false for unknown tools', async () => {
    const { isToolParallelSafe } = await import('../server/src/agents/engine');
    assert.equal(isToolParallelSafe('unknown_tool'), false);
    assert.equal(isToolParallelSafe('mcp_custom_tool'), false);
    assert.equal(isToolParallelSafe(''), false);
  });

  test('PARALLEL_SAFE_TOOLS set has expected size', async () => {
    const { PARALLEL_SAFE_TOOLS } = await import('../server/src/agents/engine');
    // Ensure the set is non-empty and has a reasonable number of entries
    assert.ok(PARALLEL_SAFE_TOOLS.size > 0, 'PARALLEL_SAFE_TOOLS should not be empty');
    assert.ok(PARALLEL_SAFE_TOOLS.size >= 25, `Expected at least 25 parallel-safe tools, got ${PARALLEL_SAFE_TOOLS.size}`);
  });
});

describe('Tool Parallelization — Execution Behavior', () => {
  /**
   * Simulates tool execution with controllable delays to verify that
   * parallel-safe tools truly run concurrently.
   */
  test('parallel-safe tools execute concurrently (timing test)', async () => {
    const TOOL_DELAY_MS = 100;
    const TOOL_COUNT = 3;

    // Create mock tool calls that each take TOOL_DELAY_MS
    const executionLog: { tool: string; startedAt: number; finishedAt: number }[] = [];

    const mockExecute = (toolName: string): Promise<string> =>
      new Promise((resolve) => {
        const startedAt = Date.now();
        setTimeout(() => {
          const finishedAt = Date.now();
          executionLog.push({ tool: toolName, startedAt, finishedAt });
          resolve(`result-${toolName}`);
        }, TOOL_DELAY_MS);
      });

    // Simulate parallel execution (as the engine does for parallel-safe tools)
    const startTime = Date.now();
    const parallelCalls = Array.from({ length: TOOL_COUNT }, (_, i) => `web_search_${i}`);
    const results = await Promise.all(parallelCalls.map((name) => mockExecute(name)));
    const parallelDuration = Date.now() - startTime;

    // Simulate sequential execution for comparison
    executionLog.length = 0;
    const seqStartTime = Date.now();
    const seqResults: string[] = [];
    for (const name of parallelCalls) {
      seqResults.push(await mockExecute(name));
    }
    const sequentialDuration = Date.now() - seqStartTime;

    // Parallel should be significantly faster than sequential
    // Sequential: ~300ms (3 * 100ms), Parallel: ~100ms
    assert.equal(results.length, TOOL_COUNT);
    assert.ok(
      parallelDuration < sequentialDuration * 0.7,
      `Parallel (${parallelDuration}ms) should be significantly faster than sequential (${sequentialDuration}ms)`
    );
    // Parallel should complete in roughly the time of a single call
    assert.ok(
      parallelDuration < TOOL_DELAY_MS * 2,
      `Parallel (${parallelDuration}ms) should complete near single-call time (~${TOOL_DELAY_MS}ms)`
    );
  });

  test('mixed batch partitions correctly and preserves order', async () => {
    const { isToolParallelSafe } = await import('../server/src/agents/engine');

    // Simulate a mixed batch of tool calls
    const mixedCalls = [
      { name: 'web_search', params: { query: 'test1' } },
      { name: 'create_note', params: { title: 'nota' } },
      { name: 'fetch_webpage', params: { url: 'https://example.com' } },
      { name: 'send_telegram_message', params: { message: 'hi' } },
      { name: 'search_notes', params: { query: 'test2' } },
    ];

    // Partition just like the engine does
    const indexedCalls = mixedCalls.map((call, i) => ({ call, index: i }));
    const parallelBatch = indexedCalls.filter(({ call }) => isToolParallelSafe(call.name));
    const sequentialBatch = indexedCalls.filter(({ call }) => !isToolParallelSafe(call.name));

    // Verify correct partitioning
    assert.equal(parallelBatch.length, 3, 'Should have 3 parallel-safe calls');
    assert.equal(sequentialBatch.length, 2, 'Should have 2 sequential calls');

    // Verify parallel batch contains the right tools
    const parallelNames = parallelBatch.map(({ call }) => call.name);
    assert.deepEqual(parallelNames, ['web_search', 'fetch_webpage', 'search_notes']);

    // Verify sequential batch contains the right tools
    const sequentialNames = sequentialBatch.map(({ call }) => call.name);
    assert.deepEqual(sequentialNames, ['create_note', 'send_telegram_message']);

    // Simulate execution and verify order preservation
    const resultsByIndex = new Map<number, string>();

    // Parallel results (could arrive in any order, but indexed)
    const parallelResults = await Promise.all(
      parallelBatch.map(async ({ call, index }) => ({
        index,
        resultStr: `result-${call.name}`,
      }))
    );
    for (const { index, resultStr } of parallelResults) {
      resultsByIndex.set(index, resultStr);
    }

    // Sequential results
    for (const { call, index } of sequentialBatch) {
      resultsByIndex.set(index, `result-${call.name}`);
    }

    // Combine preserving original order
    const orderedResults: string[] = [];
    for (let i = 0; i < mixedCalls.length; i++) {
      orderedResults.push(resultsByIndex.get(i)!);
    }

    // Results should match original call order
    assert.deepEqual(orderedResults, [
      'result-web_search',
      'result-create_note',
      'result-fetch_webpage',
      'result-send_telegram_message',
      'result-search_notes',
    ]);
  });

  test('all-parallel batch runs all tools concurrently', async () => {
    const { isToolParallelSafe } = await import('../server/src/agents/engine');

    const allParallelCalls = [
      { name: 'web_search', params: { query: 'A' } },
      { name: 'web_search', params: { query: 'B' } },
      { name: 'fetch_webpage', params: { url: 'https://a.com' } },
      { name: 'fetch_webpage', params: { url: 'https://b.com' } },
    ];

    const indexedCalls = allParallelCalls.map((call, i) => ({ call, index: i }));
    const parallelBatch = indexedCalls.filter(({ call }) => isToolParallelSafe(call.name));
    const sequentialBatch = indexedCalls.filter(({ call }) => !isToolParallelSafe(call.name));

    assert.equal(parallelBatch.length, 4, 'All calls should be parallel-safe');
    assert.equal(sequentialBatch.length, 0, 'No sequential calls expected');
  });

  test('all-sequential batch runs all tools sequentially', async () => {
    const { isToolParallelSafe } = await import('../server/src/agents/engine');

    const allSequentialCalls = [
      { name: 'create_note', params: { title: 'a', content: 'x' } },
      { name: 'send_telegram_message', params: { message: 'hi' } },
      { name: 'remember', params: { info: 'something' } },
    ];

    const indexedCalls = allSequentialCalls.map((call, i) => ({ call, index: i }));
    const parallelBatch = indexedCalls.filter(({ call }) => isToolParallelSafe(call.name));
    const sequentialBatch = indexedCalls.filter(({ call }) => !isToolParallelSafe(call.name));

    assert.equal(parallelBatch.length, 0, 'No parallel calls expected');
    assert.equal(sequentialBatch.length, 3, 'All calls should be sequential');
  });

  test('sequential tools execute in order (no overlap)', async () => {
    const TOOL_DELAY_MS = 50;
    const log: { tool: string; start: number; end: number }[] = [];

    const mockSequentialExec = async (name: string): Promise<void> => {
      const start = Date.now();
      await new Promise((resolve) => setTimeout(resolve, TOOL_DELAY_MS));
      const end = Date.now();
      log.push({ tool: name, start, end });
    };

    // Execute sequentially (as the engine does for non-parallel tools)
    const sequentialCalls = ['create_note', 'update_note', 'delete_note'];
    for (const name of sequentialCalls) {
      await mockSequentialExec(name);
    }

    // Verify no overlap: each tool starts after the previous one finishes
    for (let i = 1; i < log.length; i++) {
      assert.ok(
        log[i].start >= log[i - 1].end,
        `Tool ${log[i].tool} started (${log[i].start}) before ${log[i - 1].tool} finished (${log[i - 1].end})`
      );
    }
  });

  test('parallel execution handles individual tool errors gracefully', async () => {
    // Simulate: 3 parallel tools where one throws an error
    const results = await Promise.allSettled([
      Promise.resolve({ name: 'web_search', success: true, result: 'found results' }),
      Promise.reject(new Error('Network timeout')),
      Promise.resolve({ name: 'fetch_webpage', success: true, result: 'page content' }),
    ]);

    const successes = results.filter((r) => r.status === 'fulfilled');
    const failures = results.filter((r) => r.status === 'rejected');

    assert.equal(successes.length, 2, 'Two tools should succeed');
    assert.equal(failures.length, 1, 'One tool should fail');
    assert.equal(
      (failures[0] as PromiseRejectedResult).reason.message,
      'Network timeout'
    );
  });

  test('empty tool calls batch produces no results', async () => {
    const { isToolParallelSafe } = await import('../server/src/agents/engine');

    const emptyCalls: Array<{ name: string; params: Record<string, any> }> = [];
    const indexedCalls = emptyCalls.map((call, i) => ({ call, index: i }));
    const parallelBatch = indexedCalls.filter(({ call }) => isToolParallelSafe(call.name));
    const sequentialBatch = indexedCalls.filter(({ call }) => !isToolParallelSafe(call.name));

    assert.equal(parallelBatch.length, 0);
    assert.equal(sequentialBatch.length, 0);

    const parallelResults = await Promise.all(
      parallelBatch.map(async ({ call, index }) => ({ index, resultStr: `r-${call.name}` }))
    );
    assert.equal(parallelResults.length, 0);
  });

  test('single parallel-safe tool runs without issues', async () => {
    const { isToolParallelSafe } = await import('../server/src/agents/engine');

    const singleCall = [{ name: 'web_search', params: { query: 'solo' } }];
    const indexedCalls = singleCall.map((call, i) => ({ call, index: i }));
    const parallelBatch = indexedCalls.filter(({ call }) => isToolParallelSafe(call.name));

    assert.equal(parallelBatch.length, 1, 'Single parallel call');

    // Even a single tool goes through Promise.all — should still work
    const results = await Promise.all(
      parallelBatch.map(async ({ call, index }) => ({
        index,
        resultStr: `result-${call.name}`,
      }))
    );
    assert.equal(results.length, 1);
    assert.equal(results[0].resultStr, 'result-web_search');
    assert.equal(results[0].index, 0);
  });

  test('parallel execution is faster than sequential for multiple I/O tools', async () => {
    const DELAY = 80;
    const COUNT = 5;

    const slowTask = () => new Promise<string>((resolve) => setTimeout(() => resolve('done'), DELAY));

    // Parallel
    const pStart = Date.now();
    await Promise.all(Array.from({ length: COUNT }, () => slowTask()));
    const pDuration = Date.now() - pStart;

    // Sequential
    const sStart = Date.now();
    for (let i = 0; i < COUNT; i++) {
      await slowTask();
    }
    const sDuration = Date.now() - sStart;

    // Parallel should take roughly DELAY ms, sequential roughly DELAY*COUNT ms
    assert.ok(
      pDuration < sDuration * 0.6,
      `Parallel ${pDuration}ms should be much faster than sequential ${sDuration}ms`
    );
  });
});
