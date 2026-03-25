# SiYuan Hugo Publisher

SiYuan plugin to publish notes to Hugo with metadata mapping, image handling, auto-sync on save, and orphan-aware cleanup.

## Features

- Publish the current SiYuan note into a Hugo content directory
- Generate Hugo front matter from SiYuan note metadata
- Copy note images and cover assets into the Hugo static directory
- Track sync state to detect synced, modified, and unpublished notes
- Auto-sync updated notes on save when enabled
- Clean orphaned Hugo pages whose source notes no longer exist

## Configuration

Open the plugin settings and configure:

- Hugo project path
- Content directory
- Images directory
- Optional tag filter
- Slug mode
- Optional Hugo language prefix
- Draft mode
- Auto sync on save
- Auto clean orphans

## Notes

- The Hugo project must be accessible from the SiYuan workspace
- A Hugo config file such as `hugo.toml` or `config.toml` must exist
- The plugin writes Markdown content and image assets into the configured Hugo project
