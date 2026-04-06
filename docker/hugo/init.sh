#!/bin/sh
set -e

FS_SITE_DIR="/src"
GIT_SITE_DIR="/src-git"
SITE_DIR="$FS_SITE_DIR"
GIT_REPO_URL="${HUGO_GIT_REPO_URL:-}"
GIT_BRANCH="${HUGO_GIT_BRANCH:-main}"
GIT_TOKEN="${HUGO_GIT_TOKEN:-}"
GIT_POLL_INTERVAL="${HUGO_GIT_POLL_INTERVAL:-5}"

echo "[hugo-init] Startup..."

write_default_layouts() {
  mkdir -p "${SITE_DIR}/layouts/_default"

  cat > "${SITE_DIR}/layouts/_default/baseof.html" << 'LAYOUT'
<!DOCTYPE html>
<html lang="{{ .Site.Language.Lang }}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{ .Title }} | {{ .Site.Title }}</title>
  <style>
    body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:800px;margin:0 auto;padding:2rem;color:#222}
    a{color:#0066cc}nav{margin-bottom:2rem}
    pre{background:#f5f5f5;padding:1rem;overflow-x:auto;border-radius:4px}
    img{max-width:100%}code{background:#f0f0f0;padding:2px 5px;border-radius:3px}
    .meta{color:#666;font-size:.9em;margin-bottom:1.5rem}
    .tag{background:#e8f0fe;color:#1a73e8;padding:2px 8px;border-radius:12px;font-size:.85em;margin-right:4px}
    .banner{margin:-2rem -2rem 2rem;height:320px;overflow:hidden}
    .banner img{width:100%;height:100%;object-fit:cover;display:block}
  </style>
</head>
<body>
  <nav><a href="/">← {{ .Site.Title }}</a></nav>
  <main>{{ block "main" . }}{{ end }}</main>
</body>
</html>
LAYOUT

  cat > "${SITE_DIR}/layouts/_default/single.html" << 'LAYOUT'
{{ define "main" }}
<article>
  {{ with .Params.cover }}<div class="banner"><img src="{{ . }}" alt=""></div>
  {{ else }}{{ with .Params.cover_style }}<div class="banner" style="{{ . | safeCSS }}"></div>
  {{ end }}{{ end }}
  <h1>{{ with .Params.icon }}<span>{{ . }}</span> {{ end }}{{ .Title }}</h1>
  <div class="meta">
    {{ .Date.Format "2 January 2006" }}
    {{ with .Params.tags }}· {{ range . }}<span class="tag">#{{ . }}</span>{{ end }}{{ end }}
  </div>
  {{ .Content }}
</article>
{{ end }}
LAYOUT

  cat > "${SITE_DIR}/layouts/_default/list.html" << 'LAYOUT'
{{ define "main" }}
<h1>{{ .Title }}</h1>
<ul>
  {{ range .Pages }}
  <li><a href="{{ .Permalink }}">{{ with .Params.icon }}{{ . }} {{ end }}{{ .Title }}</a> <span class="meta">— {{ .Date.Format "02/01/2006" }}</span></li>
  {{ end }}
</ul>
{{ end }}
LAYOUT

  cat > "${SITE_DIR}/layouts/index.html" << 'LAYOUT'
{{ define "main" }}
<h1>{{ .Site.Title }}</h1>
<ul>
  {{ range (where .Site.RegularPages "Type" "posts") }}
  <li><a href="{{ .Permalink }}">{{ with .Params.icon }}{{ . }} {{ end }}{{ .Title }}</a> <span class="meta">— {{ .Date.Format "02/01/2006" }}</span></li>
  {{ end }}
</ul>
{{ end }}
LAYOUT
}

if [ -n "${GIT_REPO_URL}" ]; then
  echo "[hugo-init] Git mode enabled: ${GIT_REPO_URL} (${GIT_BRANCH})"

  if [ -n "${GIT_TOKEN}" ]; then
    CLONE_URL=$(echo "${GIT_REPO_URL}" | sed "s|https://|https://oauth2:${GIT_TOKEN}@|")
  else
    CLONE_URL="${GIT_REPO_URL}"
  fi

  if [ -d "${GIT_SITE_DIR}/.git" ]; then
    echo "[hugo-init] Repo already present, pulling latest..."
    cd "${GIT_SITE_DIR}"
    git remote set-url origin "${CLONE_URL}"
    git fetch origin "${GIT_BRANCH}" --quiet
    git reset --hard "origin/${GIT_BRANCH}"
  else
    echo "[hugo-init] Cloning repository into ${GIT_SITE_DIR}..."
    until git clone --depth 1 --branch "${GIT_BRANCH}" "${CLONE_URL}" "${GIT_SITE_DIR}" 2>/dev/null; do
      echo "[hugo-init] Repo empty or branch '${GIT_BRANCH}' missing, retry in 10s..."
      rm -rf "${GIT_SITE_DIR}"
      sleep 10
    done
  fi

  SITE_DIR="${GIT_SITE_DIR}"

  (
    while true; do
      sleep "${GIT_POLL_INTERVAL}"
      cd "${GIT_SITE_DIR}"
      git fetch origin "${GIT_BRANCH}" --quiet 2>/dev/null || continue
      LOCAL=$(git rev-parse HEAD 2>/dev/null || echo "")
      REMOTE=$(git rev-parse "origin/${GIT_BRANCH}" 2>/dev/null || echo "")
      if [ -n "${REMOTE}" ] && [ "${LOCAL}" != "${REMOTE}" ]; then
        echo "[hugo-init] New commits detected, updating local clone..."
        git reset --hard "origin/${GIT_BRANCH}"
      fi
    done
  ) &
fi

if [ ! -f "${SITE_DIR}/hugo.toml" ] && [ ! -f "${SITE_DIR}/config.toml" ]; then
  echo "[hugo-init] Launching a new Hugo website..."

  hugo new site "${SITE_DIR}" --force

  if [ -n "${SITE_THEME_GIT}" ] && [ -n "${SITE_THEME}" ]; then
    echo "[hugo-init] Theme cloning: ${SITE_THEME_GIT}"
    cd "${SITE_DIR}"
    git init
    git clone --depth=1 "${SITE_THEME_GIT}" "themes/${SITE_THEME}"
    cd /
  fi

  {
    printf 'baseURL = "%s"\n' "${SITE_BASE_URL:-http://localhost:1313/}"
    printf 'languageCode = "%s"\n' "${SITE_LANGUAGE_CODE:-fr}"
    printf 'title = "%s"\n' "${SITE_TITLE:-Mon Blog}"
    if [ -n "${SITE_THEME}" ] && [ -d "${SITE_DIR}/themes/${SITE_THEME}" ]; then
      printf 'theme = "%s"\n' "${SITE_THEME}"
    fi
    cat << 'EOF'

[markup]
  [markup.goldmark]
    [markup.goldmark.renderer]
      unsafe = true

[params]
  description = "Site généré depuis SiYuan"
EOF
  } > "${SITE_DIR}/hugo.toml"

  mkdir -p "${SITE_DIR}/content/posts"
  mkdir -p "${SITE_DIR}/static/images"

  write_default_layouts
  echo "[hugo-init] Site initialized."
else
  echo "[hugo-init] Existing Hugo site detected."

  if [ ! -s "${SITE_DIR}/layouts/_default/baseof.html" ] || \
     [ ! -s "${SITE_DIR}/layouts/_default/single.html" ] || \
     [ ! -s "${SITE_DIR}/layouts/_default/list.html" ] || \
     [ ! -s "${SITE_DIR}/layouts/index.html" ]; then
    echo "[hugo-init] Missing or empty layouts..."
    write_default_layouts
    echo "[hugo-init] Restored layouts."
  fi
fi

echo "[hugo-init] Starting Hugo Server..."
exec hugo server \
  --bind 0.0.0.0 \
  --port 1313 \
  --source "${SITE_DIR}" \
  --baseURL "${SITE_BASE_URL:-http://localhost:1313/}" \
  --disableFastRender \
  --navigateToChanged \
  --buildDrafts \
  --poll "${HUGO_POLL_INTERVAL:-700ms}" \
  "$@"
