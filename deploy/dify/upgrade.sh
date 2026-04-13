#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "未找到 ${ENV_FILE}，请先配置部署环境。" >&2
  exit 1
fi

set -a
source "${ENV_FILE}"
set +a

: "${DIFY_INSTALL_DIR:?请在 .env 中配置 DIFY_INSTALL_DIR}"
: "${DIFY_VERSION:?请在 .env 中配置 DIFY_VERSION}"

if [[ ! -d "${DIFY_INSTALL_DIR}/.git" ]]; then
  echo "${DIFY_INSTALL_DIR} 不是一个 Dify Git 仓库，请先执行 install.sh。" >&2
  exit 1
fi

git -C "${DIFY_INSTALL_DIR}" fetch --tags origin
git -C "${DIFY_INSTALL_DIR}" checkout "${DIFY_VERSION}"

DOCKER_DIR="${DIFY_INSTALL_DIR}/docker"
docker compose -f "${DOCKER_DIR}/docker-compose.yaml" pull
docker compose -f "${DOCKER_DIR}/docker-compose.yaml" up -d

echo "Dify 已升级到 ${DIFY_VERSION}"
