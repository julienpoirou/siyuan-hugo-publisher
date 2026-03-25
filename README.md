# SiYuan Hugo Publisher

[![CI](https://github.com/julienpoirou/siyuan-hugo-publisher/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/julienpoirou/siyuan-hugo-publisher/actions/workflows/ci.yml)
[![CodeQL](https://github.com/julienpoirou/siyuan-hugo-publisher/actions/workflows/codeql.yml/badge.svg)](https://github.com/julienpoirou/siyuan-hugo-publisher/actions/workflows/codeql.yml)
[![Release](https://img.shields.io/github/v/release/julienpoirou/siyuan-hugo-publisher?include_prereleases&sort=semver)](https://github.com/julienpoirou/siyuan-hugo-publisher/releases)
[![License](https://img.shields.io/github/license/julienpoirou/siyuan-hugo-publisher.svg)](LICENSE.md)
[![Conventional Commits](https://img.shields.io/badge/Conventional%20Commits-1.0.0-%23FE5196.svg)](https://www.conventionalcommits.org)

SiYuan plugin to publish notes to a Hugo site with front matter generation, image syncing, auto-sync hooks, and orphan-aware cleanup.

## Features

- Publish the current SiYuan document to a Hugo content directory
- Generate Hugo front matter from SiYuan metadata
- Copy linked images and banner assets into the Hugo static directory
- Track sync state to detect modified, synced, and unpublished notes
- Auto-sync on save and clean orphaned published files
- Support localized Hugo content paths such as `content/fr/posts`

## Requirements

- SiYuan `>= 2.9.0`
- A local Hugo project accessible from the SiYuan workspace
- Node.js `20+` and `npm` for development

## Configuration

The plugin settings expose the main options:

- `Hugo project path`: root directory of the target Hugo site
- `Content directory`: target content folder, default `content/posts`
- `Images directory`: target static folder, default `static/images`
- `Tag filter`: publish only documents matching a specific tag
- `Slug mode`: use the note title or the SiYuan document ID
- `Hugo language`: optional language prefix for multilingual content
- `Publish as draft by default`
- `Auto sync on save`
- `Auto clean orphans`

## What gets published

For each published document, the plugin:

- exports Markdown from SiYuan
- cleans SiYuan-specific markup
- generates Hugo front matter including `title`, `date`, `lastmod`, `tags`, `categories`, `slug`, and `siyuan_id`
- rewrites image links to the Hugo static path
- stores sync metadata to support updates, unpublish, and orphan cleanup

## Development

```bash
git clone https://github.com/julienpoirou/siyuan-hugo-publisher
cd siyuan-hugo-publisher
npm install
npm run check
```

Useful commands:

- `npm run typecheck`
- `npm run test`
- `npm run build`
- `npm run check`

## Contributing

- Use Conventional Commits for branch history
- Update `i18n/*` when user-facing strings change
- Update docs or changelog when behavior changes
- See [`.github/CONTRIBUTING.md`](.github/CONTRIBUTING.md) for contribution guidance

## License

MIT © See [LICENSE.md](LICENSE.md).
