# Dashboard follow-ups

## PredictiveChart fallbacks

`src/components/dashboard/PredictiveChart.tsx` currently falls back to fixed monthly income and variable-expense values when there is not enough recent history. Those values are not sourced from the user's data and should not be presented as a financial projection without an explicit empty or insufficient-data state.

This dashboard redesign deliberately does not change that logic. Review it separately before exposing the projection again in an operational view.
