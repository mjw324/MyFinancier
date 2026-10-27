import { describe, expect, it } from "vitest";
import { scoreSuggestions } from "@/lib/categorize/eval";

describe("scoreSuggestions", () => {
  it("scores per category, counting uncertain against coverage only", () => {
    const score = scoreSuggestions([
      { label: "FOOD_AND_DRINK", predicted: "FOOD_AND_DRINK" },
      { label: "FOOD_AND_DRINK", predicted: "GENERAL_MERCHANDISE" },
      { label: "FOOD_AND_DRINK", predicted: null },
      { label: "TRAVEL", predicted: "TRAVEL" },
      { label: "GENERAL_MERCHANDISE", predicted: null },
    ]);
    expect(score.overall).toEqual({ n: 5, answered: 3, correct: 2, coverage: 0.6, accuracy: 2 / 3 });
    expect(score.byCategory.FOOD_AND_DRINK).toEqual({
      support: 3, answered: 2, correct: 1, predicted: 1, accuracy: 0.5, recall: 1 / 3, precision: 1,
    });
    expect(score.byCategory.GENERAL_MERCHANDISE).toEqual({
      support: 1, answered: 0, correct: 0, predicted: 1, accuracy: null, recall: 0, precision: 0,
    });
    expect(score.byCategory.TRAVEL.accuracy).toBe(1);
  });
});
