// Design-system supply chain (DESIGN-SYSTEM §1–2): no Radix primitive anywhere in the lockfile,
// and every design-system package pinned exactly at its approved version.
import { expect, test } from "vite-plus/test";

const files = import.meta.glob<string>(["/package.json", "/pnpm-lock.yaml"], {
  query: "?raw",
  import: "default",
  eager: true,
});
const read = (f: string) => files[`/${f}`]!;

test("no @radix-ui package is resolved", () => {
  expect(read("pnpm-lock.yaml")).not.toMatch(/@radix-ui\//);
});

test("design-system packages are pinned exactly at the approved versions", () => {
  const pkg = JSON.parse(read("package.json")) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };
  expect(pkg.dependencies).toMatchObject({
    "@base-ui/react": "1.9.0",
    "@base-ui/utils": "0.5.0",
    "@dnd-kit/core": "6.3.1",
    "@dnd-kit/sortable": "10.0.0",
    "@dnd-kit/modifiers": "9.0.0",
    "@dnd-kit/utilities": "3.2.2",
    "react-resizable-panels": "4.24.1",
    "lucide-react": "1.79.0",
    "class-variance-authority": "0.7.1",
    cn: "0.5.2",
    react: "19.3.1",
    "react-dom": "19.3.1",
  });
  expect(pkg.devDependencies).toMatchObject({ tailwindcss: "4.3.5", "@tailwindcss/vite": "4.3.5" });
});
