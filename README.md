# pi-custom-provider

![Pi Custom Provider cover](https://raw.githubusercontent.com/d4rw1nz/pi-custom-provider/main/assets/cover.png)

[![npm version](https://img.shields.io/npm/v/@d4rw1nz/pi-custom-provider?logo=npm)](https://www.npmjs.com/package/@d4rw1nz/pi-custom-provider)
[![npm downloads](https://img.shields.io/npm/dm/@d4rw1nz/pi-custom-provider?logo=npm)](https://www.npmjs.com/package/@d4rw1nz/pi-custom-provider)
[![GitHub Actions](https://img.shields.io/github/actions/workflow/status/d4rw1nz/pi-custom-provider/publish-npm.yml?label=CI%2Fpublish&logo=github)](https://github.com/d4rw1nz/pi-custom-provider/actions/workflows/publish-npm.yml)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> Configure custom LLM endpoints in Pi without hand-editing `models.json`.

[English](#english) · [中文文档](README.zh-CN.md)

## English

`pi-custom-provider` is an interactive Pi extension for adding and maintaining custom LLM providers. It supports OpenAI-compatible endpoints, Pi's catalog-driven API types, model discovery, model metadata, compatibility overrides, API-key authentication, and supported Pi OAuth flows.

### Install

Install the latest published package:

```bash
pi install git:github.com/youugiuhiuh/pi-custom-provider-fix
```

Install a pinned version:

```bash
pi install npm:@d4rw1nz/pi-custom-provider@1.0.6
```

Try it for one session without changing your Pi settings:

```bash
pi -e npm:@d4rw1nz/pi-custom-provider
```

Restart Pi after installing, then run:

```text
/provider-setup
```

### Quick start

1. Open Pi and run `/provider-setup`.
2. Choose **Create New Provider**.
3. Select an API type. For most OpenAI-compatible services, choose `openai-completions`.
4. Enter the provider's Base URL, for example `https://example.com/v1`.
5. Enter a provider ID, such as `my-llm`.
6. Choose **API Key** for a normal custom endpoint, or select a compatible Pi OAuth implementation when you intentionally want that OAuth flow.
7. Enter the API key or complete the OAuth setup.
8. Let the wizard discover models, select the models you want, and press Enter to save.
9. Select the model in Pi and start using it.

### Wizard flow

```text
/provider-setup
  ├─ Create New Provider
  ├─ API Type
  ├─ Base URL
  ├─ Provider ID
  ├─ Authentication
  │   ├─ API Key
  │   └─ OAuth Provider → OAuth JSON / Pi OAuth login
  ├─ Discover models
  ├─ Select models
  ├─ Edit model metadata (optional)
  └─ Review & Save
```

For an existing provider:

```text
Choose Provider → Edit Config → edit provider fields → Select Models
```

### Authentication

For a custom OpenAI-compatible endpoint, use **API Key**. The **GitHub Copilot** and **OpenRouter** entries are OAuth implementations supplied by the installed `pi-ai` catalog; they are not inferred from your Base URL.

The OAuth picker is generated dynamically from the installed Pi provider catalog. A provider is shown for an API type only when its built-in models declare that API type. OAuth credentials can be supplied as a path, pasted JSON, or Pi-managed login credentials.

### Model discovery and editing

The wizard can:

- discover models from the configured API;
- supplement results with models matching the Base URL and model ID;
- enrich models with metadata from [models.dev](https://models.dev);
- add a model manually with `n`;
- filter with `/`;
- select all with `a`;
- edit reasoning, image input, context window, max tokens, pricing, thinking levels, and `compat` JSON;
- apply complete presets from the installed `pi-ai` catalog with `p`.

Candidates are suggestions only until selected. Existing provider model edits are saved automatically.

### Files and security

Provider configuration is stored in:

```text
~/.pi/agent/models.json
```

Pi OAuth credentials are stored in:

```text
~/.pi/agent/auth.json
```

Treat both files as sensitive. This extension executes with Pi's user permissions and makes network requests to your configured endpoint and `models.dev` during discovery.

### Development

```bash
pnpm install
pnpm test
pnpm run typecheck
pnpm run pack:check
```

Releases are published automatically by GitHub Actions when a `v*.*.*` tag is pushed:

```bash
npm version patch
git push origin main --follow-tags
```

## License

[MIT](LICENSE)
