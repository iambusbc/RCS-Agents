import { execFile } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Thin wrapper over the git CLI. All bookkeeping is plain code: zero tokens. */
export class GitRepo {
  constructor(readonly root: string) {}

  async git(args: string[], cwd = this.root): Promise<string> {
    const { stdout } = await run("git", args, { cwd, maxBuffer: 20 * 1024 * 1024 });
    return stdout.trim();
  }

  /** Create the target repo with an initial commit if it does not exist yet. */
  async ensure(): Promise<void> {
    if (existsSync(join(this.root, ".git"))) return;
    mkdirSync(this.root, { recursive: true });
    await this.git(["init", "-b", "main"]);
    await this.git(["config", "user.name", "RCS Agents"]);
    await this.git(["config", "user.email", "agents@rcs.local"]);
    writeFileSync(join(this.root, "README.md"), "# Workspace\n\nBuilt by RCS agents.\n");
    await this.git(["add", "-A"]);
    await this.git(["commit", "-m", "chore: initial commit"]);
  }

  async currentBranch(): Promise<string> {
    return this.git(["rev-parse", "--abbrev-ref", "HEAD"]);
  }

  /**
   * One worktree per agent per task, so agents run in parallel without
   * stepping on each other's files.
   */
  async addWorktree(branch: string, base: string): Promise<string> {
    const dir = join(this.root, ".worktrees", branch.replace(/\//g, "__"));
    if (!existsSync(dir)) {
      await this.git(["worktree", "add", "-B", branch, dir, base]);
    }
    return dir;
  }

  async removeWorktree(dir: string): Promise<void> {
    await this.git(["worktree", "remove", "--force", dir]).catch(() => undefined);
  }

  /** Stage and commit everything in a worktree. Returns false if nothing changed. */
  async commitAll(dir: string, message: string): Promise<boolean> {
    await this.git(["add", "-A"], dir);
    const status = await this.git(["status", "--porcelain"], dir);
    if (!status) return false;
    await this.git(["-c", "user.name=RCS Agents", "-c", "user.email=agents@rcs.local", "commit", "-m", message], dir);
    return true;
  }

  /** The diff a reviewer sees: only what the branch changed, nothing else. */
  async diff(base: string, branch: string): Promise<string> {
    return this.git(["diff", "--no-color", `${base}...${branch}`]);
  }

  async changedFiles(base: string, branch: string): Promise<string[]> {
    const out = await this.git(["diff", "--name-only", `${base}...${branch}`]);
    return out ? out.split("\n") : [];
  }

  async merge(branch: string, into: string, message: string): Promise<void> {
    await this.git(["checkout", into]);
    await this.git(["-c", "user.name=RCS Agents", "-c", "user.email=agents@rcs.local", "merge", "--no-ff", "-m", message, branch]);
  }

  /** Short file map (paths only) instead of file contents: cheap orientation for agents. */
  async fileMap(ref = "HEAD", limit = 200): Promise<string> {
    const out = await this.git(["ls-tree", "-r", "--name-only", ref]);
    const files = out.split("\n").filter((f) => f && !f.startsWith(".worktrees/"));
    const shown = files.slice(0, limit).join("\n");
    return files.length > limit ? `${shown}\n... (${files.length - limit} more)` : shown;
  }
}
