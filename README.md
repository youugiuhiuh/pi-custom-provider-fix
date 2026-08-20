# pi-custom-provider

An interactive Pi extension for adding and maintaining custom LLM providers and models without hand-editing configuration files.

Run the `provider-setup` command inside Pi to configure an endpoint, discover its models, select the models to use, and save the result to `~/.pi/agent/models.json`.

## Install

Install for your user account:

```bash
pi install npm:@d4rw1nz/pi-custom-provider
```

Or add it to the current project's Pi configuration:

```bash
pi install -l npm:@d4rw1nz/pi-custom-provider
```

Restart Pi if it is already running, then run:

```text
/provider-setup
```

To try the package for a single run without saving it to your Pi settings:

```bash
pi -e npm:@d4rw1nz/pi-custom-provider
```

## What it does

The wizard supports these API types:

- OpenAI Chat Completions and Responses
- Anthropic Messages
- Google Generative AI and Vertex AI
- Mistral Conversations
- Azure OpenAI Responses
- OpenAI Codex Responses
- Amazon Bedrock Converse Stream

For supported providers, it discovers models directly from the provider API. When possible, it enriches the result with model metadata from [models.dev](https://models.dev), including context limits, output limits, input modalities, reasoning support, and pricing. You can also add a model manually and edit its capabilities or limits.

Discovery suggestions are ordered by model ID match first, then supplemented from the configured Base URL. The model list labels candidates as `ID`, `URL`, or `API`; suggestions remain disabled until you select them. Matching models also inherit any model-level compatibility recommendations exposed by the installed `pi-ai` catalog, while unspecified fields remain `Auto` so Pi can apply its runtime defaults.

Existing providers can be reopened to add, edit, or remove models and to update their endpoint, authentication method, compatibility flags, and custom headers. On the provider list, press `d` on a provider and confirm to remove the provider and all of its configured models. The model editor exposes Pi compatibility options as API-aware controls (for example developer role, reasoning format, token field, strict tools, and session affinity), so common settings do not require hand-written JSON. Press `p` in the model or compatibility editor to search and explicitly apply a complete model preset from the installed `pi-ai` catalog. A preset copies capabilities, limits, pricing, thinking levels, and compatibility metadata while preserving the provider's callable model ID; press `x` in the compatibility editor to clear model-level compatibility overrides.

## Requirements

- Pi coding agent `0.82.0` or later (the installed Pi version supplies the peer dependencies).
- Node.js `22.19.0` or later, matching Pi's current runtime requirement.
- Network access when discovering models or enriching metadata.

## Security

This extension stores provider configuration, including API keys entered in the wizard, in `~/.pi/agent/models.json`. Treat that file as sensitive and do not commit it or share it. The extension also makes network requests to your configured provider endpoint and to `models.dev` during discovery.

As with every Pi package, review package source before installing it: extensions run with your user's system permissions.

## Development

Install the peer packages using your preferred package manager, then validate the release contents:

```bash
pnpm install
npm run pack:check
```

## License

[MIT](LICENSE)
