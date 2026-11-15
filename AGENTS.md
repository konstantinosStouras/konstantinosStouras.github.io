# Website working copies

New tasks must use sparse checkout and include only directories needed for the task. Never make a full website checkout merely to edit a profile, homepage, or publishing reference.

Before creating a working copy, read `PROJECTS.md`: independent applications are edited in their sibling source repositories. The website's submodules are publishing references.

Use `node tools/new-website-worktree.mjs <absolute-destination> codex/<task> <directories...>`. The helper uses `git worktree add --no-checkout`, then selects paths before downloading/materializing files. Use `@root` for root files only; homepage tasks can add `images css js stylesheets tools .github` as needed. Literature code tasks select `lit`. The helper always excludes `lit/data`, `lit/data-ft50`, `lit/data-refs`, `lit/data-workingpapers`, and `lit/analytics/*.json`, including when starting from older commits that still tracked the datasets.

Add a needed directory with `git sparse-checkout add /<directory>/`. Do not disable sparse checkout for convenience. Full-site integration checks may explicitly opt into the required directories and submodules in a disposable checkout.

Do not reconfigure an existing shared checkout to suit a new task. Preserve modified, staged, untracked and needed ignored files before shrinking an existing checkout. A clean status does not establish that a branch is published: inspect its commits and detached HEAD as well.

Generated literature datasets are intended to live in separate public data repositories and be updated by GitHub Actions. Do not clone them onto the laptop for ordinary code work. Cloud-verified recovery backups belong outside the source repository and should be online-only after verification.

Never delete Git pack files, expire reflogs, run `git gc --prune=now`, rewrite shared history, or force-push as disk cleanup. Preserve local branches and unfinished work first. Remove completed linked worktrees with Git, retaining their branches when needed.
