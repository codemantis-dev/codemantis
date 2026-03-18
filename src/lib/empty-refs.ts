/** Stable frozen sentinel values for Zustand selectors.
 *  Returning these instead of creating new objects prevents re-renders
 *  when a Map entry doesn't exist for the active session.
 *
 *  These are frozen empty arrays/objects — safe to reuse as long as
 *  consumers never mutate them (which they shouldn't). */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const EMPTY_ARRAY: any[] = Object.freeze([]) as unknown as any[];

export const EMPTY_STREAMING = Object.freeze({
  isStreaming: false,
  streamingContent: "",
  currentMessageId: null,
} as const);

export const EMPTY_CONTEXT = Object.freeze({ used: 0, max: 200000 } as const);
