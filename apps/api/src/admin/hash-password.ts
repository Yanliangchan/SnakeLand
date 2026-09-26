/**
 * Prints an ADMIN_PASSWORD_HASH value for the password read from stdin:
 *   printf '%s' 'your password' | pnpm --filter @snakeland/api admin:hash
 */
import { hashAdminPassword } from "./auth";

let input = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) input += chunk;
const password = input.replace(/\r?\n$/, "");
if (!password) {
  console.error("Pipe the password on stdin.");
  process.exit(1);
}
console.log(await hashAdminPassword(password));
