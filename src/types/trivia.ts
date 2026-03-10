export interface TriviaEntry {
  readonly id: number;
  readonly topic: string;
  readonly category: string;
  readonly trivia_pieces: readonly string[];
  readonly is_easter_egg: boolean;
}
