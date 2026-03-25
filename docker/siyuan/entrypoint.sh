#!/bin/sh
set -e

WORKSPACE="${SIYUAN_WORKSPACE:-/siyuan/workspace}"
PLUGIN_DIR="${WORKSPACE}/data/plugins/siyuan-hugo-publisher"
CONF_FILE="${WORKSPACE}/conf/conf.json"

echo "[siyuan-hugo-publisher] Workspace: ${WORKSPACE}"

mkdir -p "${PLUGIN_DIR}"
cp -r /opt/plugin-dist/. "${PLUGIN_DIR}/"
echo "[siyuan-hugo-publisher] Plugin files copied into ${PLUGIN_DIR}"

activate_plugin() {
  conf="$1"

  if jq -e '.bazaar.plugins // [] | index("siyuan-hugo-publisher") != null' "${conf}" >/dev/null; then
    echo "[siyuan-hugo-publisher] Plugin already activated"
    return 0
  fi

  echo "[siyuan-hugo-publisher] Activation in conf.json..."
  tmp_conf="$(mktemp)"
  jq '
    .bazaar = (.bazaar // {}) |
    .bazaar.plugins = ((.bazaar.plugins // []) + ["siyuan-hugo-publisher"] | unique)
  ' "${conf}" > "${tmp_conf}"
  mv "${tmp_conf}" "${conf}"

  echo "[siyuan-hugo-publisher] Plugin enabled in conf.json"
}

if [ -f "${CONF_FILE}" ]; then
  activate_plugin "${CONF_FILE}"
else
  echo "[siyuan-hugo-publisher] conf.json file is missing (first boot)... Activation on next boot"
  mkdir -p "${WORKSPACE}/conf"
  touch "${WORKSPACE}/conf/.hugo-plugin-pending"
fi

if [ -f "${WORKSPACE}/conf/.hugo-plugin-pending" ] && [ -f "${CONF_FILE}" ]; then
  echo "[siyuan-hugo-publisher] Delayed activation..."
  activate_plugin "${CONF_FILE}"
  rm -f "${WORKSPACE}/conf/.hugo-plugin-pending"
fi

echo "[siyuan-hugo-publisher] SiYuan Startup..."
exec /opt/siyuan/kernel \
  --workspace="${WORKSPACE}" \
  --accessAuthCode="${SIYUAN_ACCESS_AUTH_CODE:-}" \
  "$@"
