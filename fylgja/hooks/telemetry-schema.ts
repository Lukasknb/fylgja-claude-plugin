/**
 * What the plugin may report about itself: every event, every key of it, and
 * the one kind of value each key takes (a whole number within bounds, a
 * flag, or one word of a fixed list). There is no kind for text.
 *
 * Fylgja's server holds this list and takes nothing outside it. This file is
 * its copy, written from the server's own
 * (`apps/api/scripts/export_mod_events.py` in Fylgja's repository, run as
 * `just mod-events-schema`), and is not edited by hand: an event or a key
 * is added on the server, and this file is written again.
 */
export const SCHEMA = {
  maxBatch: 50,
  surfaces: ['terminal', 'desktop', 'vscode', 'web', 'other', 'none'],
  patterns: {
    plugin_version: '(?:0|[1-9]\\d{0,3})\\.(?:0|[1-9]\\d{0,3})\\.(?:0|[1-9]\\d{0,3})',
    engine_version: '(?:0|[1-9]\\d{0,3})\\.(?:0|[1-9]\\d{0,3})\\.(?:0|[1-9]\\d{0,5})(?:-dev)?',
    session: '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}',
  },
  events: {
    session_started: {
      is_interactive: { flag: true },
      is_signed_in: { flag: true },
      is_scribe_on: { flag: true },
    },
    look: {
      trigger: { oneOf: ['turn_end', 'answered_question'] },
      ending: { oneOf: ['verdict', 'unreadable', 'steps', 'deadline', 'no_reply', 'stopped', 'skipped_gate', 'skipped_cap', 'not_granted'] },
      is_whole: { flag: true },
      duration_ms: { whole: [0, 3600000] },
      steps: { whole: [0, 100] },
      lookups: { whole: [0, 100] },
      input_tokens: { whole: [0, 50000000] },
      output_tokens: { whole: [0, 50000000] },
      cache_read_tokens: { whole: [0, 50000000] },
      cache_write_tokens: { whole: [0, 50000000] },
      rows_read: { whole: [0, 100000] },
      rows_held: { whole: [0, 100000] },
      drafts_proposed: { whole: [0, 100000] },
      drafts_written: { whole: [0, 100000] },
      drafts_refused: { whole: [0, 100000] },
      first_refusal_code: { oneOf: ['alternatives_too_many', 'anchor_cap', 'anchor_invalid', 'anchors_too_many', 'atom_content_removed', 'atom_content_taken', 'atom_ids_too_many', 'burst', 'commit_invalid', 'detail_too_long', 'edit_conflict', 'guardrail_refused', 'invalid_arguments', 'kind_retired', 'leans_on_conversation', 'no_trigger', 'not_a_decision', 'not_found', 'not_imperative', 'not_one_sentence', 'pass_unavailable', 'paths_too_many', 'project_state_error', 'rate_limited', 'reason_contradiction', 'reason_missing', 'recalled_gone', 'repo_mismatch', 'search_index_unavailable', 'server_validation', 'status_not_memory', 'structure_conflict', 'suggestion_state_error', 'supersedes_removed', 'too_long', 'validation_error', 'other', 'none'] },
      no_reply_reason: { oneOf: ['stopped', 'unanswered', 'threw'] },
      calls_missed: { whole: [0, 100000] },
    },
    call: {
      tool: { oneOf: ['whoami', 'recall', 'search', 'open', 'resolve', 'remember', 'amend_memory', 'attach_commit'] },
      outcome: { oneOf: ['created', 'reconfirmed', 'duplicate', 'restored', 'fixed', 'removed', 'unchanged', 'answered', 'refused', 'rate_limited', 'invalid_arguments', 'not_found', 'server_fault', 'failed', 'timed_out', 'not_connected', 'not_let_through'] },
      refusal_code: { oneOf: ['alternatives_too_many', 'anchor_cap', 'anchor_invalid', 'anchors_too_many', 'atom_content_removed', 'atom_content_taken', 'atom_ids_too_many', 'burst', 'commit_invalid', 'detail_too_long', 'edit_conflict', 'guardrail_refused', 'invalid_arguments', 'kind_retired', 'leans_on_conversation', 'no_trigger', 'not_a_decision', 'not_found', 'not_imperative', 'not_one_sentence', 'pass_unavailable', 'paths_too_many', 'project_state_error', 'rate_limited', 'reason_contradiction', 'reason_missing', 'recalled_gone', 'repo_mismatch', 'search_index_unavailable', 'server_validation', 'status_not_memory', 'structure_conflict', 'suggestion_state_error', 'supersedes_removed', 'too_long', 'validation_error', 'other', 'none'] },
      duration_ms: { whole: [0, 3600000] },
      is_retry: { flag: true },
    },
    question: {
      stage: { oneOf: ['held_back', 'shown', 'answered'] },
      form: { oneOf: ['reason', 'reversal', 'holds'] },
      held_back_by: { oneOf: ['turn_asked', 'asked_before', 'session_share', 'unanswered'] },
      key: { oneOf: ['option', 'own_words', 'no_reason', 'skip', 'still_holds', 'no_longer_holds', 'replaces', 'different', 'told_claude', 'expired', 'withdrawn'] },
      ms_until_answered: { whole: [0, 3600000] },
    },
    window: {
      view: { oneOf: ['kept', 'search'] },
      opened_by: { oneOf: ['click', 'command'] },
      outcome: { oneOf: ['opened', 'not_placed', 'failed'] },
      records_listed: { whole: [0, 100000] },
    },
    window_action: {
      view: { oneOf: ['kept', 'search'] },
      action: { oneOf: ['reword', 'remove', 'put_back', 'open_record', 'cite'] },
      outcome: { oneOf: ['done', 'trouble'] },
    },
    search: {
      asked_by: { oneOf: ['command', 'field', 'again'] },
      outcome: { oneOf: ['found', 'failed', 'signed_out'] },
      results: { oneOf: ['none', '1_3', '4_10', 'over_10'] },
      duration_ms: { whole: [0, 3600000] },
    },
    compaction: {
      trigger: { oneOf: ['manual', 'auto', 'plugin'] },
      is_scribe_running: { flag: true },
      records_carried: { whole: [0, 100000] },
      rows_held: { whole: [0, 100000] },
      rows_dropped: { whole: [0, 100000] },
    },
    commit: {
      rule: { oneOf: ['count_match', 'named_set', 'none_count_unknown', 'none_away', 'none_count_mismatch', 'none_named_mismatch', 'none_no_repo'] },
      files_sent: { whole: [0, 100000] },
      attached: { whole: [0, 100000] },
      flagged: { whole: [0, 100000] },
      is_old_server_fallback: { flag: true },
      is_attached: { flag: true },
    },
    error: {
      component: { oneOf: ['session_start', 'turn_step', 'turn_end', 'compaction', 'context', 'band', 'window', 'scribe'] },
      kind: { oneOf: ['threw', 'not_let_through', 'wake_ceiling', 'no_prompt_row', 'no_repository', 'held_rows_dropped', 'known_repos_offered', 'old_server_paths'] },
      cause: { oneOf: ['timeout', 'network', 'auth', 'aborted', 'parse', 'other'] },
    },
    sign_in: {
      state: { oneOf: ['here', 'needs_sign_in', 'other_account', 'not_here'] },
    },
    telemetry_stopped: {
      reason: { oneOf: ['old_server', 'not_let_through', 'failing'] },
    },
    events_dropped: {
      count: { whole: [0, 100000] },
    },
  },
} as const
