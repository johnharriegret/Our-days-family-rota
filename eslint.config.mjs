import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTypescript,
  {
    rules: {
      // Part of eslint-plugin-react-hooks' React Compiler-oriented rule set.
      // This project doesn't opt into the React Compiler, and the standard
      // "fetch on mount in a client component" pattern used throughout the
      // (app) route group's pages is the documented React approach, not a
      // cascading-render bug - so this compiler-specific heuristic is noise
      // here rather than a signal.
      "react-hooks/set-state-in-effect": "off",
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "tests/**"]),
]);

export default eslintConfig;
