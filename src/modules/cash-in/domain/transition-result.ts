/**
 * What applying a trigger to an operation did: `applied` (state changed),
 * `ignored` (already in that state, or nothing to do) or `conflict` (contradicts
 * a terminal state).
 */
export type TransitionResult = 'applied' | 'ignored' | 'conflict';
