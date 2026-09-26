import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "drizzle/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/consistent-type-imports": "error",
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/db/schema"],
              importNames: ["wallets", "transactions"],
              message: "Balances are owned by WalletService. Call wallet.apply() instead of touching these tables.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/wallet/**", "src/db/**", "test/**"],
    rules: { "no-restricted-imports": "off" },
  },
);
