// After `next build` with output: "standalone", copy the static assets the
// standalone server serves itself (Next leaves this step to the deployer).
import { cpSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const target = join(root, ".next/standalone/apps/web");
if (!existsSync(target)) {
  console.error("standalone output missing: is output: \"standalone\" set?");
  process.exit(1);
}
for (const [from, to] of [
  [".next/static", ".next/static"],
  ["public", "public"],
]) {
  rmSync(join(target, to), { recursive: true, force: true });
  cpSync(join(root, from), join(target, to), { recursive: true });
}
console.log("standalone assets copied");
