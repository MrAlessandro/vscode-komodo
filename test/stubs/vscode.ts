/* Minimal stand-in for the `vscode` module, enough to import the tree/render code in unit tests. */

type Listener<T> = (e: T) => unknown;

export class EventEmitter<T> {
  private readonly listeners = new Set<Listener<T>>();
  readonly event = (listener: Listener<T>) => {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  };
  fire(data?: T): void {
    for (const listener of [...this.listeners]) {
      listener(data as T);
    }
  }
  dispose(): void {
    this.listeners.clear();
  }
}

export class ThemeColor {
  constructor(readonly id: string) {}
}

export class ThemeIcon {
  constructor(
    readonly id: string,
    readonly color?: ThemeColor,
  ) {}
}

export class MarkdownString {
  constructor(
    public value = '',
    public supportThemeIcons = false,
  ) {}
  appendMarkdown(value: string): this {
    this.value += value;
    return this;
  }
  appendText(value: string): this {
    this.value += value;
    return this;
  }
}

export enum TreeItemCollapsibleState {
  None = 0,
  Collapsed = 1,
  Expanded = 2,
}

export class TreeItem {
  id?: string;
  description?: string;
  tooltip?: unknown;
  iconPath?: unknown;
  contextValue?: string;
  command?: unknown;
  constructor(
    public label: string,
    public collapsibleState: TreeItemCollapsibleState = TreeItemCollapsibleState.None,
  ) {}
}

export class Uri {
  private constructor(
    readonly scheme: string,
    readonly path: string,
    readonly query: string,
  ) {}
  static from(c: { scheme: string; path?: string; query?: string }): Uri {
    return new Uri(c.scheme, c.path ?? '', c.query ?? '');
  }
  static parse(value: string): Uri {
    const url = new URL(value);
    return new Uri(url.protocol.replace(/:$/, ''), url.pathname, decodeURIComponent(url.search.replace(/^\?/, '')));
  }
  toString(): string {
    return `${this.scheme}:${this.path}${this.query ? `?${encodeURIComponent(this.query)}` : ''}`;
  }
}

const settings = new Map<string, unknown>();

/** Test helper: override a `komodo.*` setting. */
export function __setSetting(key: string, value: unknown): void {
  settings.set(key, value);
}

export const workspace = {
  getConfiguration: () => ({
    get: <T>(key: string, fallback: T): T => (settings.has(key) ? (settings.get(key) as T) : fallback),
  }),
  onDidChangeConfiguration: () => ({ dispose() {} }),
};

/** Ids passed to `commands.registerCommand`, for the manifest test. */
export const __registeredCommands: string[] = [];

export const commands = {
  executeCommand: async () => undefined,
  registerCommand: (id: string) => {
    __registeredCommands.push(id);
    return { dispose() {} };
  },
};

export const window = {
  activeTextEditor: undefined,
  visibleTextEditors: [],
};

export class Range {
  constructor(
    readonly startLine: number,
    readonly startCharacter: number,
    readonly endLine: number,
    readonly endCharacter: number,
  ) {}
}

export enum TextEditorRevealType {
  Default = 0,
}

export const languages = {
  setTextDocumentLanguage: async <T>(doc: T): Promise<T> => doc,
};
