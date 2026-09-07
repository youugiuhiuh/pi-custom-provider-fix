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

The wizard reads API types from the installed Pi provider catalog, so the list follows the Pi version you are running instead of a copy maintained by this package.

For supported providers, it discovers models directly from the provider API. When possible, it enriches the result with model metadata from [models.dev](https://models.dev), including context limits, output limits, input modalities, reasoning support, and pricing. You can also add a model manually and edit its capabilities or limits.

Discovery suggestions are ordered by model ID match first, then supplemented from the configured Base URL. The model list labels candidates as `ID`, `URL`, or `API`; suggestions remain disabled until you select them. Matching models also inherit any model-level compatibility recommendations exposed by the installed `pi-ai` catalog, while unspecified fields remain `Auto` so Pi can apply its runtime defaults.

Existing providers can be reopened to add, edit, or remove models and to update their ID, display name, API type, endpoint, API key, OAuth settings, authentication method, and custom headers. Model edits are saved automatically for existing providers; provider text fields are saved after you confirm the field. Provider ID changes safely rename the existing entry instead of creating a duplicate. On the provider list, press `d` on a provider and confirm to remove the provider and all of its configured models. The model editor can edit the model's full `compat` JSON object when you need to override Pi defaults. Press `p` in the model editor to search and explicitly apply a complete model preset from the installed `pi-ai` catalog. A preset copies capabilities, limits, pricing, thinking levels, and compatibility metadata while preserving the provider's callable model ID; press `Ctrl+U` in the compatibility editor to clear model-level compatibility overrides.

## OAuth

The wizard can attach an OAuth flow supplied by the installed Pi version to a custom provider. This is useful when you want multiple entries that use the same upstream OAuth implementation, for example `codex-work` and `codex-personal`, with separate credentials selected by provider ID.

The OAuth provider picker is generated from Pi's built-in provider catalog. The plugin does not maintain its own copy of provider names, default URLs, or default API mappings.

For each OAuth provider, you can set an OAuth JSON path, paste a JSON credential, or leave the field empty. A JSON path is treated as an external credential file and is read directly. A pasted JSON credential is imported into Pi's `~/.pi/agent/auth.json` under the custom provider ID. An empty field uses Pi's stored OAuth credential for the custom provider ID. If no credential exists when model discovery starts, the wizard runs Pi's OAuth login flow first, stores the result under that provider ID in `auth.json`, and only then calls the model API.

Separate custom providers need separate stored credentials, for example `codex-work` and `codex-personal` entries in `auth.json`; a credential stored only under `openai-codex` is not reused for every custom provider.

The OAuth JSON file can be a single credential:

```json
{
  "type": "oauth",
  "access": "access-token",
  "refresh": "refresh-token",
  "expires": 1798790400000
}
```

It can also be a full Pi `auth.json`-style object. The plugin first looks for the custom provider ID, then for the OAuth provider type:

```json
{
  "codex-work": {
    "type": "oauth",
    "access": "access-token",
    "refresh": "refresh-token",
    "expires": 1798790400000
  },
  "openai-codex": {
    "type": "oauth",
    "access": "fallback-access-token",
    "refresh": "fallback-refresh-token",
    "expires": 1798790400000
  }
}
```

Common OAuth field names such as `access_token`, `refresh_token`, `expires_at`, `expiry_date`, and `expires_in` are also accepted. Codex CLI-style files with `tokens.access_token` and `tokens.refresh_token` are accepted too. If the credential is expired and has a refresh token, the plugin refreshes it with the selected OAuth provider implementation. Stored credentials are refreshed in `auth.json`; external credential paths are refreshed in the same external JSON file.

## Requirements

- Pi coding agent `0.82.0` or later (the installed Pi version supplies the peer dependencies).
- Node.js `22.19.0` or later, matching Pi's current runtime requirement.
- Network access when discovering models or enriching metadata.

## Security

This extension stores provider configuration, including API keys entered in the wizard, in `~/.pi/agent/models.json`. OAuth login credentials and pasted OAuth JSON credentials are stored in Pi's `~/.pi/agent/auth.json`; external OAuth JSON paths are read from the path you configured. Treat these files as sensitive and do not commit them or share them. The extension also makes network requests to your configured provider endpoint and to `models.dev` during discovery.

As with every Pi package, review package source before installing it: extensions run with your user's system permissions.

## Development

Install the peer packages using your preferred package manager, then validate the release contents:

```bash
pnpm install
npm run pack:check
```

## License

[MIT](LICENSE)
