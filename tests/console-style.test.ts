import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Guards the console's design rules. The console has a light default theme,
// so dark-only utility classes render invisible text; and the chrome is
// deliberately flat, so blur, gradients and uppercase labels are out.

const root = fileURLToPath(new URL("..", import.meta.url));

function walk(dir: string, match: (path: string) => boolean): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path, match);
    return match(path) ? [path] : [];
  });
}

const CONSOLE_SOURCES = [
  ...walk(join(root, "src/app/dashboard"), (path) => path.endsWith(".tsx")),
  ...["admin", "console", "activity", "circuits", "usage", "chat"].flatMap((dir) => walk(join(root, "src/components", dir), (path) => path.endsWith(".tsx"))),
  ...["ApiKeyManager", "BillingManager", "SettingsForm", "SupportPanel", "ProviderCatalog", "RepositoryDeployments", "GitHubManager"].map((name) => join(root, `src/components/${name}.tsx`)),
];

const CONSOLE_STYLES = walk(join(root, "src/app/dashboard/styles"), (path) => path.endsWith(".css"));

function offenders(files: string[], pattern: RegExp) {
  return files.flatMap((file) =>
    readFileSync(file, "utf8")
      .split("\n")
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => pattern.test(line))
      .map(({ index }) => `${relative(root, file)}:${index + 1}`),
  );
}

describe("console style rules", () => {
  it("uses no dark-only utility classes or retired colour aliases", () => {
    expect(offenders(CONSOLE_SOURCES, /\b(text-white|bg-black\/|border-white\/|bg-white\/)|qr-emerald|qr-violet/)).toEqual([]);
  });

  it("keeps chrome flat: no blur, gradients or uppercase labels", () => {
    expect(offenders(CONSOLE_STYLES, /backdrop-filter|linear-gradient|radial-gradient|text-transform:\s*uppercase/)).toEqual([]);
  });

  it("uses only the three font weights", () => {
    expect(offenders(CONSOLE_STYLES, /font-weight:\s*(?!400|500|600|var\(|inherit)\d{3}|\bfont:\s*(?!400|500|600)\d{3}\s/)).toEqual([]);
  });
});
