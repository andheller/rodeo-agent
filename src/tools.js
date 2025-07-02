import { evaluate, mean, variance } from "mathjs";

export const tools = [
  {
    name: "evaluate_expression",
    description: "Evaluate a numeric arithmetic expression",
    parameters: {
      type: "object",
      properties: { expression: { type: "string" } },
      required: ["expression"]
    },
    function: ({ expression }) => {
      console.log('TOOL CALLED: evaluate_expression with:', expression);
      try {
        const result = evaluate(expression);
        console.log('TOOL RESULT:', result);
        return { result };
      } catch (err) {
        console.log('TOOL ERROR:', err);
        return { error: String(err) };
      }
    }
  },
  {
    name: "check_mean",
    description: "Arithmetic mean of an array of numbers",
    parameters: {
      type: "object",
      properties: { values: { type: "array", items: { type: "number" } } },
      required: ["values"]
    },
    function: ({ values }) => ({ mean: mean(values) })
  },
  {
    name: "check_variance",
    description: "Sample variance of an array of numbers",
    parameters: {
      type: "object",
      properties: { values: { type: "array", items: { type: "number" } } },
      required: ["values"]
    },
    function: ({ values }) => ({ variance: variance(values) })
  }
];