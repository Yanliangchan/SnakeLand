/**
 * Prints an ADMIN_PASSWORD_HASH value for the password read from stdin:
 *   printf '%s' 'your password' | pnpm --filter @snakeland/api admin:hash
 * With --totp it also prints a fresh ADMIN_TOTP_SECRET and the otpauth:// URI
 * to add to an authenticator app.
 */
import { hashAdminPassword } from "./auth";
import { newTotpSecret } from "./totp";

let input = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) input += chunk;
const password = input.replace(/\r?\n$/, "");
if (!password) {
  console.error("Pipe the password on stdin.");
  process.exit(1);
}
console.log(await hashAdminPassword(password));
if (process.argv.includes("--totp")) {
  const secret = newTotpSecret();
  console.log(`ADMIN_TOTP_SECRET=${secret}`);
  console.log(`otpauth://totp/Snakeland:admin?secret=${secret}&issuer=Snakeland&algorithm=SHA1&digits=6&period=30`);
}
