Review, clean up, and commit the current changes following best practices.

## Step 1: Review Changes

Run `git status` and `git diff` (both staged and unstaged) to understand all changes.

## Step 2: Code Quality Review

Before committing, review the changed code for:

### Dead Code Removal
- Remove unused imports
- Remove commented-out code blocks
- Remove unused variables, functions, or classes
- Remove debug print statements or console.logs

### Refactoring for Reusability (12-Factor Principles)
- **Codebase**: Ensure one codebase tracked in version control
- **Dependencies**: Explicitly declare dependencies (pyproject.toml, package.json)
- **Config**: Store config in environment variables, not hardcoded
- **Backing Services**: Treat external services as attached resources
- **Build/Release/Run**: Strict separation between stages
- **Processes**: Execute app as stateless processes
- **Port Binding**: Export services via port binding
- **Concurrency**: Scale out via process model
- **Disposability**: Fast startup and graceful shutdown
- **Dev/Prod Parity**: Keep environments similar
- **Logs**: Treat logs as event streams
- **Admin Processes**: Run admin tasks as one-off processes

### Code Deduplication
- Extract repeated logic into reusable functions or utilities
- Move shared constants to a central location
- Create base classes or mixins for common patterns

## Step 3: Apply Fixes

If any issues are found in Step 2, fix them before proceeding to commit.

## Step 4: Stage Files

Use `git add` to stage the appropriate files:
- Only add files related to the current change
- Do NOT add sensitive files (.env, credentials, secrets)
- Do NOT add generated files unless necessary (node_modules, __pycache__, .venv)
- Prefer adding specific files by name over `git add .`

## Step 5: Commit with Conventional Message

Use conventional commit format:

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

### Types:
- `feat:` — New feature
- `fix:` — Bug fix
- `docs:` — Documentation only
- `style:` — Formatting, no code change
- `refactor:` — Code change that neither fixes a bug nor adds a feature
- `perf:` — Performance improvement
- `test:` — Adding or updating tests
- `chore:` — Maintenance tasks, dependency updates
- `ci:` — CI/CD configuration changes
- `build:` — Build system or external dependency changes

### Scope (optional):
Use the module, component, or area affected (e.g., `agents`, `middleware`, `mcp`, `ui`)

### Examples:
- `feat(agents): add movie agent with MCP server integration`
- `fix(mcp): resolve async context manager lifecycle issue`
- `refactor(middleware): extract common tracing logic`
- `docs: update CLAUDE.md with architecture decisions`
- `chore(deps): add langchain-mcp-adapters dependency`

## Step 6: Verify

After committing, run `git status` to confirm the commit was successful and working tree is clean (or shows expected remaining changes).

## Important Notes

- NEVER commit secrets, API keys, or credentials
- NEVER use `git add -A` or `git add .` without reviewing what will be staged
- ALWAYS write meaningful commit messages that explain WHY, not just WHAT
- If changes span multiple concerns, consider splitting into multiple commits
- End commit message with: `Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>`
