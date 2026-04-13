# Dify 服务器部署

这个目录提供一套原生 Docker 部署包装脚本，用来在你的服务器上拉取并运行官方 Dify 自部署版本。

## 文件说明

- .env.example：服务器部署参数模板。
- install.sh：首次安装或重新部署。
- upgrade.sh：切换到新版本并重启容器。

## 服务器前提

- Docker 19.03+
- Docker Compose v2
- Git
- OpenSSL
- 至少 2 核 CPU、4 GiB 内存

## 使用步骤

1. 把这个目录上传到服务器。
2. 复制一份配置文件：

```bash
cp .env.example .env
```

3. 修改 .env，至少填这些值：

- DIFY_VERSION：要部署的 Dify 版本，例如 1.10.1
- DIFY_INSTALL_DIR：官方 Dify 仓库在服务器上的安装目录，例如 /opt/dify
- DIFY_SCHEME：http 或 https
- DIFY_HOST：你的服务器 IP 或域名
- DIFY_HTTP_PORT：http 端口
- DIFY_HTTPS_PORT：https 端口

4. 执行安装：

```bash
chmod +x install.sh upgrade.sh
./install.sh
```

5. 打开浏览器访问：

- 初始化管理员： http://你的域名或IP/install
- 登录 Dify： http://你的域名或IP

## 这套脚本会做什么

1. 克隆或更新官方 Dify 仓库。
2. 检出你指定的 Dify 版本。
3. 自动生成并更新官方 docker/.env。
4. 自动设置公共访问地址。
5. 如果你没手动填密码和密钥，就自动生成：

- SECRET_KEY
- DB_PASSWORD
- REDIS_PASSWORD
- PLUGIN_DAEMON_KEY
- INNER_API_KEY
- INNER_API_KEY_FOR_PLUGIN

6. 启动官方 docker-compose.yaml。

## 升级

1. 修改 .env 里的 DIFY_VERSION
2. 执行：

```bash
./upgrade.sh
```

## 和当前仓库联动

你把 Dify 部署到自己的服务器后，还要同步更新当前仓库的 GitHub Secret：

- DIFY_BASE_URL=https://你的域名/v1
- DIFY_API_KEY=你在自建 Dify 里生成的应用 API Key

这样现有的 Review Notifier 工作流就会自动改为调用你的自建 Dify。