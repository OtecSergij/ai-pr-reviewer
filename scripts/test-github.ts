import { parsePRUrl } from "../lib/github/parse-url";
import { createGithubAccess } from "../lib/github/octokit";
import { GitHubError } from "../lib/github/error-base";
import { PRTooLargeError } from "../lib/github/pr-too-large";

const FILE_LIMIT = 50;
const TOKEN = process.env.GITHUB_PAT;

const SCENARIOS: { name: string; url: string }[] = [
  { name: "small PR (2-5 files)", url: "https://github.com/vercel/ai/pull/15658" },
  { name: "medium PR (10-25 files)", url: "https://github.com/vercel/ai/pull/15662" },
  { name: "large PR (>50 files, must hit PR_TOO_LARGE)", url: "https://github.com/kubernetes/kubernetes/pull/139258" },
  {
    name: "non-existent PR (must be NOT_FOUND)",
    url: "https://github.com/anthropics/anthropic-sdk-typescript/pull/999999",
  },
  {
    name: "private repo without access (must be NOT_FOUND)",
    url: "https://github.com/OtecSergij/pumpTheElephant/pull/1",
  },
  {
    name: "invalid URL (must be INVALID_PR_URL)",
    url: "https://example.com/foo",
  },
  {
    name: "not a PR URL (must be INVALID_PR_URL)",
    url: "https://github.com/anthropics/anthropic-sdk-typescript/issues/1",
  },
];

async function runScenario(name: string, url: string) {
  console.log(`\n━━━━━━ ${name} ━━━━━━`);
  console.log(`URL: ${url}`);

  if (url === "TODO") {
    console.log("⊘ skipped — fill in URL");
    return;
  }

  try {
    const pr = parsePRUrl(url);
    console.log(`✓ parsed: ${pr.owner}/${pr.repo}#${pr.pr_number}`);

    if (!TOKEN) {
      throw new Error(
        "GITHUB_PAT not set — add to .env.local and re-run with --env-file=.env.local",
      );
    }

    const gh = createGithubAccess(TOKEN, pr);

    const meta = await gh.getPRMetadata();
    console.log(
      `✓ metadata: "${meta.title}" — state=${meta.state}, ${meta.changed_files} files, head=${meta.head_sha.substring(0, 7)}, base=${meta.base_ref}`,
    );

    if (meta.changed_files > FILE_LIMIT) {
      throw new PRTooLargeError(meta.changed_files, FILE_LIMIT);
    }

    // Verify lazy promise-dedup: 3 parallel calls should make 1 HTTP listFiles
    const [a, b, c] = await Promise.all([
      gh.getPRFiles(),
      gh.getPRFiles(),
      gh.getPRFiles(),
    ]);
    const sameLength = a.length === b.length && b.length === c.length;
    console.log(
      `✓ files (parallel ×3, same length=${sameLength}): ${a.length} files`,
    );

    if (a.length > 0) {
      const first = a[0];
      console.log(
        `  first: ${first.filename} [${first.status}, +${first.additions}/-${first.deletions}]`,
      );

      const diff = await gh.getDiff(first.filename);
      console.log(
        `✓ getDiff: ${diff ? `${diff.split("\n").length} lines` : "null (no patch — binary or large)"}`,
      );

      // Read full file at head_sha (skip removed)
      if (first.status !== "removed") {
        try {
          const contents = await gh.getFileContents({
            path: first.filename,
            ref: meta.head_sha,
          });
          console.log(
            `✓ getFileContents: ${contents.size} bytes, ${contents.content.split("\n").length} lines`,
          );
        } catch (err) {
          if (err instanceof GitHubError) {
            console.log(`  getFileContents: ${err.code} — ${err.message}`);
          } else throw err;
        }
      }

      // List root directory
      try {
        const root = await gh.listDirectory({
          path: "",
          ref: meta.head_sha,
        });
        console.log(`✓ listDirectory("/"): ${root.length} entries`);
      } catch (err) {
        if (err instanceof GitHubError) {
          console.log(`  listDirectory: ${err.code} — ${err.message}`);
        } else throw err;
      }
    }
  } catch (err) {
    if (err instanceof GitHubError) {
      console.log(`✗ ${err.code}: ${err.message}`);
    } else {
      console.log(`✗ UNEXPECTED:`, err);
    }
  }
}

async function main() {
  for (const { name, url } of SCENARIOS) {
    await runScenario(name, url);
  }
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
