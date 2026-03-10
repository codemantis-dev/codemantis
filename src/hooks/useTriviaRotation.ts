import { useEffect, useRef, useState } from "react";
import { getRandomTrivia, getRandomEasterEgg } from "../data/trivia";

interface TriviaState {
  topic: string;
  fact: string;
  isEasterEgg: boolean;
  factKey: number;
}

export function useTriviaRotation(active: boolean): TriviaState {
  const shownCount = useRef(0);
  const topicRef = useRef("");
  const [state, setState] = useState<TriviaState>(() => {
    const initial = getRandomTrivia();
    topicRef.current = initial.topic;
    return { ...initial, factKey: 0 };
  });

  useEffect(() => {
    if (!active) return;

    shownCount.current = 1;
    const initial = getRandomTrivia();
    topicRef.current = initial.topic;
    setState({ ...initial, factKey: 0 });

    const interval = setInterval(() => {
      shownCount.current += 1;
      const isEasterEggTurn = shownCount.current % 50 === 0;
      const next = isEasterEggTurn
        ? getRandomEasterEgg()
        : getRandomTrivia(topicRef.current);
      topicRef.current = next.topic;
      setState((prev) => ({ ...next, factKey: prev.factKey + 1 }));
    }, 10_000);

    return () => clearInterval(interval);
  }, [active]);

  return state;
}
