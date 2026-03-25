# Contributing

Thanks for your interest in **siyuan-hugo-publisher** 💙

## Prerequisites
- Node.js 20+
- npm
- Docker (optional for local dev)

## Getting started
```bash
git clone https://github.com/julienpoirou/siyuan-hugo-publisher
cd siyuan-hugo-publisher
npm install
npm run check
```

## Branches & commits
- Branch off `main`: `feat/x`, `fix/y`, etc.
- **Conventional Commits** required:
  - `feat(scope): ...` (minor)
  - `fix(scope): ...` (patch)
  - `feat!(scope): ...` or `refactor!: ...` (major)
- CI enforces the format via **commitlint**.

## Tests
- Type check: `npm run typecheck`
- Unit tests: `npm run test`
- Build plugin: `npm run build`
- Full verification: `npm run check`

## i18n
- Any user-facing message change should be reflected in the relevant files under `i18n/`.
- Keep translations aligned across locales when possible.

## Open a PR
- Fill the PR template.
- Checklist: verification green, translations updated if needed, docs updated if needed.
- Update `CHANGELOG.md` or plugin metadata only when the change requires it.

## Discussion
- Questions: issues or discussions.
- First contributions welcome: **good first issue** label.
