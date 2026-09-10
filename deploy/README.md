# GitHub Pages + 阿里云部署

目标前端地址：`https://rivalscope.jimmyzhang.xyz`。
当前文件是待部署配置，不能据此认为线上域名、证书或服务器已完成切换。

## 前置条件

- 确认采用 GitHub Pages 提供静态前端，阿里云 ECS 运行 FastAPI。
- 提供 ECS 公网 IP、操作系统和可用 SSH 连接；以下服务模板要求 Linux + systemd。
- 确定独立 API 域名，例如 `rivalscope-api.jimmyzhang.xyz`，示例名称尚未绑定。
- 核对域名在阿里云大陆服务器的备案与接入状态。
- 当前权威 DNS 为 DNSPod，需要该平台的解析管理权限。

## 阿里云 API

1. 在服务器创建无登录权限的 `rivalscope` 系统用户，将已审核的代码放在 `/opt/rivalscope`。准备 Python 3.12+，在 `backend/.venv` 创建虚拟环境并安装 `backend/requirements.txt`。
2. 将 `aliyun/backend.env.example` 复制到服务器 `/etc/rivalscope/backend.env`，仅允许管理员读取。填写模型、检索、首次管理员等配置。用 Python `secrets.token_urlsafe(48)` 生成 JWT 密钥，用 `cryptography.fernet.Fernet.generate_key()` 生成主密钥。实际凭据不要放入仓库或前端变量。
3. 安装 `aliyun/rivalscope.service` 到 `/etc/systemd/system/`，执行 `systemctl daemon-reload` 和 `systemctl enable --now rivalscope`。systemd 自动创建 `/var/lib/rivalscope` 保存 SQLite；保持单 worker，避免重复启动调度器。先验证 `curl --fail http://127.0.0.1:8000/api/health`。
4. 在 DNSPod 将所选 API 子域名的 A 记录指向 ECS 公网 IP。配置安全组和系统防火墙允许 HTTPS；8000 仅在本机监听。
5. 通过 DNS 验证或临时 HTTP 验证取得 API 域名证书，再替换 `nginx-api.conf.example` 的全部 `API_DOMAIN`，安装到 Nginx 配置目录。执行 `nginx -t` 后加载，配置证书续期和续期后的 Nginx reload。使用 HTTP 验证时需开放 80 并保留验证路径。
6. 验证公网 `https://<API域名>/api/health`，确认 CORS 允许 `https://rivalscope.jimmyzhang.xyz`。数据库定期备份到独立位置，更新代码前使用 SQLite backup 或停服务备份；不要直接复制活跃的 WAL 数据库文件。

## GitHub Pages

1. 合并部署配置到仓库默认分支。在 Settings → Pages 选择 GitHub Actions。
2. 将 Custom domain 设置为 `rivalscope.jimmyzhang.xyz`。Actions 发布必须通过 Pages 设置绑定域名，单独添加 CNAME 文件不足以完成绑定。
3. 在 DNSPod 添加 `rivalscope` 的 CNAME，记录值为 `JimmyZhang06.github.io`，不要带仓库路径；先核对同名记录，避免覆盖其他服务。根域名记录无需修改。
4. 在 Settings → Secrets and variables → Actions → Variables 设置 `VITE_API_ORIGIN=https://<API域名>`，不带 `/api` 或结尾斜杠。该值会公开写入构建产物，不能包含凭据。
5. 在 Actions 手动执行 Deploy frontend to GitHub Pages。首次仅提供手动发布入口，待服务器及域名就绪后再决定是否启用 push 自动发布。
6. 等待 DNS 检查和证书签发后启用 Enforce HTTPS，验证首页、注册登录、刷新令牌、报告导出和实时进度。

前端使用 BrowserRouter。工作流将 index.html 复制为 404.html，让直接访问 `/login` 或 `/app/...` 时仍能加载应用；GitHub Pages 对这些请求仍返回 HTTP 404 状态。若要求所有有效路由返回 200，应改用阿里云 Nginx 的 `try_files $uri $uri/ /index.html` 托管前端，或另行改为 HashRouter。

## 切换与回退

先部署并验证 API，再发布前端及设置 DNS。现有 Sites 配置保留用于回退；本次新子域名不会自动改变原 `jimmyzhang.xyz` 站点。尚未接入 DNS 和服务器时，不要宣称已上线。修改 `VITE_API_ORIGIN` 后必须重新构建和发布。

官方说明：[GitHub 自定义域名](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site)、[阿里云备案域名问题](https://help.aliyun.com/en/icp-filing/basic-icp-service/support/for-the-record-domain-faq)。
