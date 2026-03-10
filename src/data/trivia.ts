import dataset from "./trivia_dataset.json";
import type { TriviaEntry } from "../types/trivia";

const allEntries = dataset as TriviaEntry[];
const regular = allEntries.filter((e) => !e.is_easter_egg);
const easterEggs = allEntries.filter((e) => e.is_easter_egg);

export function getRandomTrivia(excludeTopic?: string): {
  topic: string;
  fact: string;
  isEasterEgg: false;
} {
  const pool =
    excludeTopic != null
      ? regular.filter((e) => e.topic !== excludeTopic)
      : regular;
  const entry = pool[Math.floor(Math.random() * pool.length)];
  const fact =
    entry.trivia_pieces[Math.floor(Math.random() * entry.trivia_pieces.length)];
  return { topic: entry.topic, fact, isEasterEgg: false };
}

export function getRandomEasterEgg(): {
  topic: string;
  fact: string;
  isEasterEgg: true;
} {
  const entry = easterEggs[Math.floor(Math.random() * easterEggs.length)];
  const fact =
    entry.trivia_pieces[Math.floor(Math.random() * entry.trivia_pieces.length)];
  return { topic: entry.topic, fact, isEasterEgg: true };
}
