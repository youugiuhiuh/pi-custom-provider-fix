# pi-custom-provider

![Pi Custom Provider 封面](https://raw.githubusercontent.com/d4rw1nz/pi-custom-provider/main/assets/cover.png)

[English](README.md) · 中文

> 在 Pi 中配置任意自定义 LLM 接口，无需手动编辑 `models.json`。

## 简介

`pi-custom-provider` 是一个 Pi 交互式扩展，用来添加和维护自定义 LLM Provider。它支持 OpenAI 兼容接口、由 Pi Catalog 驱动的 API 类型、模型发现、模型元数据、兼容性配置、API Key，以及 Pi 支持的 OAuth 流程。

## 安装

安装 npm 最新版本：

```bash
pi install npm:@d4rw1nz/pi-custom-provider
```

安装指定版本：

```bash
pi install npm:@d4rw1nz/pi-custom-provider@1.0.6
```

只在当前会话试用，不修改持久化配置：

```bash
pi -e npm:@d4rw1nz/pi-custom-provider
```

安装后重启 Pi，然后执行：

```text
/provider-setup
```

## 快速开始

1. 在 Pi 中执行 `/provider-setup`。
2. 选择 **Create New Provider**。
3. 选择 API 类型。大多数 OpenAI 兼容服务选择 `openai-completions`。
4. 输入 Base URL，例如 `https://example.com/v1`。
5. 输入 Provider ID，例如 `my-llm`。
6. 普通自定义接口选择 **API Key**；只有确实要使用对应 OAuth 流程时才选择 GitHub Copilot 或 OpenRouter 等 OAuth Provider。
7. 输入 API Key，或完成 OAuth 配置。
8. 等待模型发现，选择要使用的模型，按 Enter 保存。
9. 在 Pi 中选择模型并开始使用。

## 使用流程

```text
/provider-setup
  ├─ 新建 Provider
  ├─ API Type
  ├─ Base URL
  ├─ Provider ID
  ├─ 认证方式
  │   ├─ API Key
  │   └─ OAuth Provider → OAuth JSON / Pi OAuth 登录
  ├─ 发现模型
  ├─ 选择模型
  ├─ 编辑模型信息（可选）
  └─ 检查并保存
```

编辑已有 Provider：

```text
选择 Provider → Edit Config → 修改 Provider 配置 → 选择模型
```

## 认证说明

对于自定义 OpenAI 兼容接口，应选择 **API Key**。

**GitHub Copilot** 和 **OpenRouter** 是当前安装的 `pi-ai` Catalog 提供的 OAuth 实现，并不是插件根据你的 Base URL 推断出来的 Provider。某个 OAuth Provider 只有在其内置模型声明支持当前 API 类型时，才会显示在列表中。

OAuth 凭据支持外部 JSON 文件、直接粘贴 JSON，或使用 Pi 自己的 OAuth 登录并保存到：

```text
~/.pi/agent/auth.json
```

## 模型发现与编辑

扩展支持：

- 从配置的 API 自动发现模型；
- 根据 Base URL 和模型 ID 补充候选模型；
- 从 [models.dev](https://models.dev) 获取上下文、输出长度、价格、输入模态等元数据；
- 按 `n` 手动添加模型；
- 按 `/` 过滤模型；
- 按 `a` 全选模型；
- 编辑 reasoning、图片输入、上下文窗口、最大输出、价格、thinking levels 和 `compat` JSON；
- 按 `p` 从当前安装的 `pi-ai` Catalog 选择完整模型预设。

候选模型只有在选中后才会保存。已有 Provider 的模型编辑会自动保存。

## 配置文件与安全

Provider 配置保存在：

```text
~/.pi/agent/models.json
```

Pi OAuth 凭据保存在：

```text
~/.pi/agent/auth.json
```

这两个文件都包含敏感信息，请勿提交或分享。本扩展以 Pi 用户权限运行，模型发现时会访问你配置的服务端点和 `models.dev`。

## 开发与发布

```bash
pnpm install
pnpm test
pnpm run typecheck
pnpm run pack:check
```

推送 `v*.*.*` 格式的 tag 后，GitHub Actions 会自动测试并发布 npm：

```bash
npm version patch
git push origin main --follow-tags
```

## License

[MIT](LICENSE)
