#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "未找到 ${ENV_FILE}，请先从 .env.example 复制一份 .env 并修改。" >&2
  exit 1
fi

set -a
source "${ENV_FILE}"
set +a

required_commands=(git docker sed grep awk openssl)
for command_name in "${required_commands[@]}"; do
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "缺少命令: ${command_name}" >&2
    exit 1
  fi
done

if ! docker compose version >/dev/null 2>&1; then
  echo "当前服务器缺少 docker compose，请先安装 Docker Compose v2。" >&2
  exit 1
fi

: "${DIFY_VERSION:?请在 .env 中配置 DIFY_VERSION}"
: "${DIFY_INSTALL_DIR:?请在 .env 中配置 DIFY_INSTALL_DIR}"
: "${DIFY_SCHEME:?请在 .env 中配置 DIFY_SCHEME}"
: "${DIFY_HOST:?请在 .env 中配置 DIFY_HOST}"
: "${DIFY_HTTP_PORT:?请在 .env 中配置 DIFY_HTTP_PORT}"
: "${DIFY_HTTPS_PORT:?请在 .env 中配置 DIFY_HTTPS_PORT}"

PUBLIC_BASE_URL="${DIFY_SCHEME}://${DIFY_HOST}"
if [[ "${DIFY_SCHEME}" == "http" && "${DIFY_HTTP_PORT}" != "80" ]]; then
  PUBLIC_BASE_URL="${PUBLIC_BASE_URL}:${DIFY_HTTP_PORT}"
fi
if [[ "${DIFY_SCHEME}" == "https" && "${DIFY_HTTPS_PORT}" != "443" ]]; then
  PUBLIC_BASE_URL="${PUBLIC_BASE_URL}:${DIFY_HTTPS_PORT}"
fi

escape_sed_replacement() {
  printf '%s' "$1" | sed 's/[&|]/\\&/g'
}

generate_secret() {
  openssl rand -hex 32
}

ensure_value() {
  local current_value="${1:-}"
  if [[ -n "${current_value}" ]]; then
    printf '%s' "${current_value}"
    return
  fi
  generate_secret
}

upsert_env() {
  local key="$1"
  local value="$2"
  local file_path="$3"
  local escaped_value
  escaped_value="$(escape_sed_replacement "${value}")"

  if grep -q "^${key}=" "${file_path}"; then
    sed -i "s|^${key}=.*$|${key}=${escaped_value}|" "${file_path}"
  else
    printf '\n%s=%s\n' "${key}" "${value}" >> "${file_path}"
  fi
}

clone_or_update_repo() {
  local target_dir="$1"
  local version="$2"

  if [[ ! -d "${target_dir}/.git" ]]; then
    mkdir -p "$(dirname "${target_dir}")"
    git clone https://github.com/langgenius/dify.git "${target_dir}"
  fi

  git -C "${target_dir}" fetch --tags origin
  git -C "${target_dir}" checkout "${version}"
}

clone_or_update_repo "${DIFY_INSTALL_DIR}" "${DIFY_VERSION}"

DOCKER_DIR="${DIFY_INSTALL_DIR}/docker"
OFFICIAL_ENV_FILE="${DOCKER_DIR}/.env"

if [[ ! -f "${DOCKER_DIR}/.env.example" ]]; then
  echo "官方 docker/.env.example 不存在，仓库版本可能异常。" >&2
  exit 1
fi

if [[ ! -f "${OFFICIAL_ENV_FILE}" ]]; then
  cp "${DOCKER_DIR}/.env.example" "${OFFICIAL_ENV_FILE}"
fi

SECRET_KEY="$(ensure_value "${SECRET_KEY:-}")"
DB_PASSWORD="$(ensure_value "${DB_PASSWORD:-}")"
REDIS_PASSWORD="$(ensure_value "${REDIS_PASSWORD:-}")"
PLUGIN_DAEMON_KEY="$(ensure_value "${PLUGIN_DAEMON_KEY:-}")"
INNER_API_KEY="$(ensure_value "${INNER_API_KEY:-}")"
INNER_API_KEY_FOR_PLUGIN="$(ensure_value "${INNER_API_KEY_FOR_PLUGIN:-}")"

CONSOLE_WEB_URL="${CONSOLE_WEB_URL:-${PUBLIC_BASE_URL}}"
CONSOLE_API_URL="${CONSOLE_API_URL:-${PUBLIC_BASE_URL}}"
SERVICE_API_URL="${SERVICE_API_URL:-${PUBLIC_BASE_URL}}"
APP_WEB_URL="${APP_WEB_URL:-${PUBLIC_BASE_URL}}"
FILES_URL="${FILES_URL:-${PUBLIC_BASE_URL}}"

upsert_env "EXPOSE_NGINX_PORT" "${DIFY_HTTP_PORT}" "${OFFICIAL_ENV_FILE}"
upsert_env "EXPOSE_NGINX_SSL_PORT" "${DIFY_HTTPS_PORT}" "${OFFICIAL_ENV_FILE}"
upsert_env "CONSOLE_WEB_URL" "${CONSOLE_WEB_URL}" "${OFFICIAL_ENV_FILE}"
upsert_env "CONSOLE_API_URL" "${CONSOLE_API_URL}" "${OFFICIAL_ENV_FILE}"
upsert_env "SERVICE_API_URL" "${SERVICE_API_URL}" "${OFFICIAL_ENV_FILE}"
upsert_env "APP_WEB_URL" "${APP_WEB_URL}" "${OFFICIAL_ENV_FILE}"
upsert_env "FILES_URL" "${FILES_URL}" "${OFFICIAL_ENV_FILE}"
upsert_env "SECRET_KEY" "${SECRET_KEY}" "${OFFICIAL_ENV_FILE}"
upsert_env "DB_PASSWORD" "${DB_PASSWORD}" "${OFFICIAL_ENV_FILE}"
upsert_env "REDIS_PASSWORD" "${REDIS_PASSWORD}" "${OFFICIAL_ENV_FILE}"
upsert_env "PLUGIN_DAEMON_KEY" "${PLUGIN_DAEMON_KEY}" "${OFFICIAL_ENV_FILE}"
upsert_env "INNER_API_KEY" "${INNER_API_KEY}" "${OFFICIAL_ENV_FILE}"
upsert_env "INNER_API_KEY_FOR_PLUGIN" "${INNER_API_KEY_FOR_PLUGIN}" "${OFFICIAL_ENV_FILE}"

docker compose -f "${DOCKER_DIR}/docker-compose.yaml" pull
docker compose -f "${DOCKER_DIR}/docker-compose.yaml" up -d

echo "Dify 已启动。"
echo "初始化地址: ${PUBLIC_BASE_URL}/install"
echo "访问地址: ${PUBLIC_BASE_URL}"
echo "官方 .env 路径: ${OFFICIAL_ENV_FILE}"
