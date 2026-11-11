import * as vscode from 'vscode';
import { KomodoClient, KomodoApiError, formatError, normalizeBaseUrl } from './api/client';

/** Secret Storage key. URL, key and secret are stored together so that they can never be split apart. */
const SECRET_KEY = 'komodo.connection';

export interface StoredConnection {
  url: string;
  key: string;
  secret: string;
}

export interface EnvCredentials {
  key: string;
  secret: string;
  url?: string;
  /** Names of the variables the values were read from, for display. */
  sources: string[];
}

const URL_VARS = ['KOMODO_URL', 'KOMODO_ADDRESS', 'KOMODO_HOST', 'KOMODO_CLI_HOST'];
const KEY_VARS = ['KOMODO_KEY', 'KOMODO_API_KEY', 'KOMODO_CLI_KEY'];
const SECRET_VARS = ['KOMODO_SECRET', 'KOMODO_API_SECRET', 'KOMODO_CLI_SECRET'];

/** Reads Komodo credentials from environment variables (only used as an import source). */
export function readEnvCredentials(env: NodeJS.ProcessEnv = process.env): EnvCredentials | undefined {
  const pick = (names: string[]) => {
    const name = names.find((n) => env[n]?.trim());
    return name ? { name, value: env[name]!.trim() } : undefined;
  };
  const key = pick(KEY_VARS);
  const secret = pick(SECRET_VARS);
  if (!key || !secret) {
    return undefined;
  }
  const url = pick(URL_VARS);
  return {
    key: key.value,
    secret: secret.value,
    url: url?.value,
    sources: [key.name, secret.name, ...(url ? [url.name] : [])],
  };
}

export function parseStoredConnection(raw: string | undefined): StoredConnection | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    const value = JSON.parse(raw) as Partial<StoredConnection>;
    if (typeof value.url === 'string' && typeof value.key === 'string' && typeof value.secret === 'string' && value.key && value.secret) {
      return { url: normalizeBaseUrl(value.url), key: value.key, secret: value.secret };
    }
  } catch {
    // fall through
  }
  return undefined;
}

/**
 * Owns the Komodo connection: credentials live in VS Code Secret Storage
 * (backed by the OS keychain), never in settings.json.
 */
export class ConnectionManager implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  /** Fired when the connection is configured, changed or removed (also from another window). */
  readonly onDidChange = this.emitter.event;
  private connection: StoredConnection | undefined;
  private client: KomodoClient | undefined;
  private initialized = false;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly log: vscode.LogOutputChannel,
  ) {
    this.disposables.push(
      this.emitter,
      context.secrets.onDidChange((e) => {
        if (e.key === SECRET_KEY) {
          void this.reload();
        }
      }),
    );
  }

  async initialize(): Promise<void> {
    await this.reload();
  }

  get isConfigured(): boolean {
    return this.connection !== undefined;
  }

  get isInitialized(): boolean {
    return this.initialized;
  }

  /** Base URL of Komodo Core, e.g. `https://komodo.example.com`. */
  get url(): string | undefined {
    return this.connection?.url;
  }

  getClient(): KomodoClient | undefined {
    return this.client;
  }

  envCredentials(): EnvCredentials | undefined {
    return readEnvCredentials();
  }

  /** Interactive setup: URL, API key and secret, validated against Komodo Core before saving. */
  async configure(): Promise<boolean> {
    const env = this.envCredentials();
    const current = this.connection;
    const urlInput = await vscode.window.showInputBox({
      title: 'Komodo: Configure Connection (1/3)',
      prompt: 'URL of your Komodo Core instance',
      placeHolder: 'https://komodo.example.com',
      value: current?.url ?? safeNormalize(env?.url) ?? 'https://',
      ignoreFocusOut: true,
      validateInput: (value) => {
        try {
          normalizeBaseUrl(value);
          return undefined;
        } catch (err) {
          return formatError(err);
        }
      },
    });
    if (urlInput === undefined) {
      return false;
    }
    const url = normalizeBaseUrl(urlInput);
    const sameHost = current?.url === url;
    const key = await vscode.window.showInputBox({
      title: 'Komodo: Configure Connection (2/3)',
      prompt: sameHost
        ? 'API key (press Enter to keep the stored one)'
        : env
          ? `API key (prefilled from ${env.sources[0]}; create keys in Komodo → Settings → API Keys)`
          : 'API key (create one in Komodo → Settings → API Keys)',
      placeHolder: 'K-…',
      value: sameHost ? current.key : env?.key,
      password: true,
      ignoreFocusOut: true,
      validateInput: (value) => (value.trim() ? undefined : 'The API key is required.'),
    });
    if (key === undefined) {
      return false;
    }
    const secret = await vscode.window.showInputBox({
      title: 'Komodo: Configure Connection (3/3)',
      prompt: sameHost
        ? 'API secret (press Enter to keep the stored one)'
        : env
          ? `API secret (prefilled from ${env.sources[1]})`
          : 'API secret (shown only once when the key is created)',
      placeHolder: 'S-…',
      value: sameHost ? current.secret : env?.secret,
      password: true,
      ignoreFocusOut: true,
      validateInput: (value) => (value.trim() ? undefined : 'The API secret is required.'),
    });
    if (secret === undefined) {
      return false;
    }
    return this.validateAndSave({ url, key: key.trim(), secret: secret.trim() });
  }

  /** Moves KOMODO_KEY / KOMODO_SECRET (and KOMODO_URL if present) from the environment into Secret Storage. */
  async importFromEnvironment(): Promise<boolean> {
    const env = this.envCredentials();
    if (!env) {
      void vscode.window.showWarningMessage(
        'Komodo: KOMODO_KEY and KOMODO_SECRET are not set in the environment VS Code was started with. Use "Configure Connection…" instead.',
      );
      return false;
    }
    let url = safeNormalize(env.url) ?? this.connection?.url;
    if (!url) {
      const input = await vscode.window.showInputBox({
        title: 'Komodo: Import Credentials from Environment',
        prompt: `Found ${env.sources.join(' and ')}. Enter the URL of Komodo Core (no KOMODO_URL variable is set).`,
        placeHolder: 'https://komodo.example.com',
        value: 'https://',
        ignoreFocusOut: true,
        validateInput: (value) => {
          try {
            normalizeBaseUrl(value);
            return undefined;
          } catch (err) {
            return formatError(err);
          }
        },
      });
      if (input === undefined) {
        return false;
      }
      url = normalizeBaseUrl(input);
    }
    return this.validateAndSave({ url, key: env.key, secret: env.secret });
  }

  async signOut(): Promise<void> {
    if (!this.connection) {
      return;
    }
    const choice = await vscode.window.showWarningMessage(
      `Remove the Komodo API key and secret for ${new URL(this.connection.url).host} from VS Code Secret Storage?`,
      { modal: true },
      'Remove',
    );
    if (choice !== 'Remove') {
      return;
    }
    await this.context.secrets.delete(SECRET_KEY);
    await this.reload();
    this.log.info('Stored Komodo credentials removed.');
  }

  private async validateAndSave(candidate: StoredConnection): Promise<boolean> {
    const client = new KomodoClient(candidate.url, candidate, { timeoutMs: 15_000 });
    try {
      const { version, username, admin } = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Komodo: connecting to ${client.host}…` },
        async () => {
          // `/user` fails with 401 on bad credentials; `GetVersion` gives the Core version.
          const user = await client.getUser();
          const coreVersion = await client.version();
          return { version: coreVersion, username: user.username, admin: user.admin };
        },
      );
      await this.save(candidate);
      this.log.info(`Connected to ${client.host} (Komodo Core v${version}) as ${username}${admin ? ' (admin)' : ''}.`);
      void vscode.window.showInformationMessage(
        `Komodo: connected to ${client.host} (Core v${version}) as ${username}${admin ? ' (admin)' : ''}. Credentials stored in VS Code Secret Storage.`,
      );
      return true;
    } catch (err) {
      const message = formatError(err);
      this.log.warn(`Connection test to ${client.host} failed: ${message}`);
      const unreachable = err instanceof KomodoApiError && err.status === 0;
      const actions = unreachable ? ['Retry', 'Save Anyway'] : ['Retry'];
      const choice = await vscode.window.showErrorMessage(`Komodo: cannot connect to ${client.host}: ${message}`, ...actions);
      if (choice === 'Retry') {
        return this.configure();
      }
      if (choice === 'Save Anyway') {
        await this.save(candidate);
        return true;
      }
      return false;
    }
  }

  private async save(connection: StoredConnection): Promise<void> {
    await this.context.secrets.store(SECRET_KEY, JSON.stringify(connection));
    await this.reload();
  }

  private async reload(): Promise<void> {
    let next: StoredConnection | undefined;
    try {
      next = parseStoredConnection(await this.context.secrets.get(SECRET_KEY));
    } catch (err) {
      this.log.error(`Cannot read Komodo credentials from Secret Storage: ${formatError(err)}`);
      next = undefined;
    }
    const changed =
      next?.url !== this.connection?.url || next?.key !== this.connection?.key || next?.secret !== this.connection?.secret;
    this.connection = next;
    if (changed || !this.client !== !next) {
      this.client = next ? new KomodoClient(next.url, { key: next.key, secret: next.secret }) : undefined;
    }
    this.initialized = true;
    await this.updateContext();
    if (changed) {
      this.emitter.fire();
    }
  }

  async updateContext(): Promise<void> {
    await Promise.all([
      vscode.commands.executeCommand('setContext', 'komodo.configured', this.isConfigured),
      vscode.commands.executeCommand('setContext', 'komodo.envCredentialsAvailable', this.envCredentials() !== undefined),
      vscode.commands.executeCommand('setContext', 'komodo.initialized', this.initialized),
    ]);
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}

function safeNormalize(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }
  try {
    return normalizeBaseUrl(url);
  } catch {
    return undefined;
  }
}
