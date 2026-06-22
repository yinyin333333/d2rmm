import type {
  D2RLoaderConfig,
  D2RLoaderConfigFormat,
  D2RLoaderConfigValue,
  D2RLoaderSettings,
  D2RLoaderTomlSetting,
  D2RLoaderTomlValueType,
} from 'bridge/BridgeAPI';

type D2RLoaderValueType = 'boolean' | 'integer' | 'quoted-string';

type D2RLoaderSetting = {
  value: boolean | number | string;
  type: D2RLoaderValueType;
};

type D2RLoaderSectionMap = Record<string, Record<string, D2RLoaderSetting>>;

type ParsedTomlValue = {
  value: D2RLoaderConfigValue;
  valueType: D2RLoaderTomlValueType;
};

type ParsedTomlKeyLine = {
  indent: string;
  key: string;
  separator: string;
  valueText: string;
  commentText: string;
};

export const D2R_LOADER_CONFIG_FILES: Array<{
  fileName: string;
  format: D2RLoaderConfigFormat;
}> = [
  { fileName: 'D2RLoader.toml', format: 'toml' },
  { fileName: 'D2RLoader.ini', format: 'ini' },
];

export function normalizeD2RLoaderSettings(
  settings: D2RLoaderSettings,
): D2RLoaderSettings {
  const extraSharedTabs = Math.max(0, Math.floor(settings.extraSharedTabs));
  const damageIndicator = [0, 1, 2].includes(settings.damageIndicator)
    ? settings.damageIndicator
    : 0;

  return {
    ...settings,
    extraSharedTabs,
    damageIndicator,
  };
}

function getD2RLoaderConfigMap(
  settings: D2RLoaderSettings,
): D2RLoaderSectionMap {
  const normalized = normalizeD2RLoaderSettings(settings);
  return {
    Game: {
      default_mod: { value: normalized.defaultMod, type: 'quoted-string' },
      skip_title_screen: {
        value: normalized.skipTitleScreen,
        type: 'boolean',
      },
    },
    Items: {
      show_ground_sockets: {
        value: normalized.showGroundSockets,
        type: 'boolean',
      },
    },
    Stash: {
      extra_shared_tabs: {
        value: normalized.extraSharedTabs,
        type: 'integer',
      },
    },
    UI: {
      force_tcpip: { value: normalized.forceTcpip, type: 'boolean' },
    },
    Advanced: {
      global_plugins: { value: normalized.globalPlugins, type: 'boolean' },
      dev_console: { value: normalized.devConsole, type: 'boolean' },
    },
    'Advanced.Logging': {
      detect_early_crashes: {
        value: normalized.detectEarlyCrashes,
        type: 'boolean',
      },
      damage_indicator: {
        value: normalized.damageIndicator,
        type: 'integer',
      },
      json_resource_loads: {
        value: normalized.jsonResourceLoads,
        type: 'boolean',
      },
    },
  };
}

function detectNewline(text: string): string {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
}

function trimTrailingEmptyLine(lines: string[]): string[] {
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    return lines.slice(0, -1);
  }
  return lines;
}

function formatD2RLoaderValue(setting: D2RLoaderSetting): string {
  switch (setting.type) {
    case 'boolean':
      return setting.value ? 'true' : 'false';
    case 'integer':
      return String(Math.floor(Number(setting.value)));
    case 'quoted-string':
      return formatTomlString(setting.value);
    default:
      return String(setting.value);
  }
}

function findSectionEnd(lines: string[], sectionStart: number): number {
  for (let i = sectionStart + 1; i < lines.length; i += 1) {
    if (/^\s*\[[^\]]+\]\s*$/.test(lines[i])) {
      return i;
    }
  }
  return lines.length;
}

function findSectionInsertionIndex(
  lines: string[],
  sectionEnd: number,
): number {
  let insertionIndex = sectionEnd;
  while (insertionIndex > 0 && lines[insertionIndex - 1].trim() === '') {
    insertionIndex -= 1;
  }
  return insertionIndex;
}

function updateD2RLoaderIniConfig(
  configText: string,
  settings: D2RLoaderSettings,
): string {
  const newline = detectNewline(configText);
  const hadTrailingNewline = /\r?\n$/.test(configText);
  const lines = trimTrailingEmptyLine(splitLines(configText));
  const sectionMap = getD2RLoaderConfigMap(settings);
  const keyLinePattern = /^(\s*)([^=;\s][^=]*?)(\s*=\s*)(.*)$/;

  for (const [sectionName, sectionSettings] of Object.entries(sectionMap)) {
    let sectionStart = lines.findIndex((line) => {
      const match = line.match(/^\s*\[([^\]]+)\]\s*$/);
      return match?.[1] === sectionName;
    });

    if (sectionStart === -1) {
      if (lines.length > 0 && lines[lines.length - 1] !== '') {
        lines.push('');
      }
      sectionStart = lines.length;
      lines.push(`[${sectionName}]`);
    }

    let sectionEnd = findSectionEnd(lines, sectionStart);

    for (const [key, setting] of Object.entries(sectionSettings)) {
      const value = formatD2RLoaderValue(setting);
      let found = false;

      for (let i = sectionStart + 1; i < sectionEnd; i += 1) {
        const match = lines[i].match(keyLinePattern);
        if (match?.[2].trim() === key) {
          lines[i] = `${match[1]}${key}${match[3]}${value}`;
          found = true;
          break;
        }
      }

      if (!found) {
        const insertionIndex = findSectionInsertionIndex(lines, sectionEnd);
        lines.splice(insertionIndex, 0, `${key} = ${value}`);
        sectionEnd += 1;
      }
    }
  }

  return `${lines.join(newline)}${hadTrailingNewline ? newline : ''}`;
}

function getTomlSettingID(section: string, key: string): string {
  return section === '' ? key : `${section}.${key}`;
}

function getTomlTableName(line: string): string | null {
  const match = line.match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/);
  return match?.[1].trim() ?? null;
}

function stripTomlComment(line: string): string {
  return line.replace(/^\s*#\s?/, '').trimEnd();
}

function splitTomlValueAndComment(text: string): {
  valueText: string;
  commentText: string;
} {
  let quote: '"' | "'" | null = null;
  let isEscaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (quote != null) {
      if (quote === '"' && char === '\\' && !isEscaped) {
        isEscaped = true;
        continue;
      }
      if (char === quote && !isEscaped) {
        quote = null;
      }
      isEscaped = false;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === '#') {
      let commentStart = i;
      while (commentStart > 0 && /\s/.test(text[commentStart - 1])) {
        commentStart -= 1;
      }
      return {
        valueText: text.slice(0, commentStart).trim(),
        commentText: text.slice(commentStart),
      };
    }
  }

  return { valueText: text.trim(), commentText: '' };
}

function parseTomlKeyLine(line: string): ParsedTomlKeyLine | null {
  const match = line.match(
    /^(\s*)([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)(\s*=\s*)(.*)$/,
  );
  if (match == null) {
    return null;
  }

  const { valueText, commentText } = splitTomlValueAndComment(match[4]);
  return {
    indent: match[1],
    key: match[2].trim(),
    separator: match[3],
    valueText,
    commentText,
  };
}

function parseTomlString(valueText: string): string {
  if (valueText.startsWith('"') && valueText.endsWith('"')) {
    try {
      return JSON.parse(valueText) as string;
    } catch {
      return valueText.slice(1, -1);
    }
  }

  if (valueText.startsWith("'") && valueText.endsWith("'")) {
    return valueText.slice(1, -1);
  }

  return valueText;
}

function parseTomlValue(valueText: string): ParsedTomlValue {
  const trimmed = valueText.trim();

  if (trimmed === 'true' || trimmed === 'false') {
    return { value: trimmed === 'true', valueType: 'boolean' };
  }

  if (/^[+-]?\d+$/.test(trimmed)) {
    return { value: Number(trimmed), valueType: 'integer' };
  }

  if (/^[+-]?(?:\d+\.\d*|\d*\.\d+)$/.test(trimmed)) {
    return { value: Number(trimmed), valueType: 'float' };
  }

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return { value: parseTomlString(trimmed), valueType: 'string' };
  }

  return { value: trimmed, valueType: 'raw' };
}

function formatTomlString(value: D2RLoaderConfigValue): string {
  return JSON.stringify(String(value));
}

function getTomlNumberBounds(
  section: string,
  key: string,
): { min?: number; max?: number } {
  if (section === 'd2rcore.stash' && key === 'set_shared_tabs') {
    return { min: 5 };
  }

  if (section === 'd2rcore.stash' && key === 'set_materials_limit') {
    return { min: 99, max: 255 };
  }

  return {};
}

function normalizeTomlNumberValue(
  value: D2RLoaderConfigValue,
  section: string,
  key: string,
  valueType: 'integer' | 'float',
): number {
  const parsedValue = Number(value);
  const { min, max } = getTomlNumberBounds(section, key);
  let normalized = Number.isFinite(parsedValue) ? parsedValue : 0;

  if (valueType === 'integer') {
    normalized = Math.floor(normalized);
  }
  if (min != null) {
    normalized = Math.max(min, normalized);
  }
  if (max != null) {
    normalized = Math.min(max, normalized);
  }

  return normalized;
}

function formatTomlValue(
  value: D2RLoaderConfigValue,
  valueType: D2RLoaderTomlValueType,
  section: string,
  key: string,
): string {
  switch (valueType) {
    case 'boolean':
      return value === true || value === 'true' ? 'true' : 'false';
    case 'integer':
      return String(normalizeTomlNumberValue(value, section, key, 'integer'));
    case 'float':
      return String(normalizeTomlNumberValue(value, section, key, 'float'));
    case 'string':
      return formatTomlString(value);
    case 'raw':
      return String(value);
    default:
      return String(value);
  }
}

export function parseD2RLoaderTomlSettings(
  tomlText: string,
): D2RLoaderTomlSetting[] {
  const settings: D2RLoaderTomlSetting[] = [];
  const lines = trimTrailingEmptyLine(splitLines(tomlText));
  let section = '';
  let pendingComments: string[] = [];

  for (const line of lines) {
    const tableName = getTomlTableName(line);
    if (tableName != null) {
      section = tableName;
      pendingComments = [];
      continue;
    }

    if (/^\s*#/.test(line)) {
      pendingComments.push(stripTomlComment(line));
      continue;
    }

    if (line.trim() === '') {
      pendingComments = [];
      continue;
    }

    const keyLine = parseTomlKeyLine(line);
    if (keyLine == null) {
      pendingComments = [];
      continue;
    }

    const { value, valueType } = parseTomlValue(keyLine.valueText);
    if (section !== 'd2rcore.fonts') {
      settings.push({
        id: getTomlSettingID(section, keyLine.key),
        section,
        key: keyLine.key,
        value,
        valueType,
        description: pendingComments.join('\n'),
      });
    }
    pendingComments = [];
  }

  return settings;
}

function updateD2RLoaderTomlConfig(
  tomlText: string,
  settings: D2RLoaderSettings,
): string {
  const newline = detectNewline(tomlText);
  const hadTrailingNewline = /\r?\n$/.test(tomlText);
  const lines = trimTrailingEmptyLine(splitLines(tomlText));
  const dynamicSettings = settings.tomlSettings ?? {};
  let section = '';

  const updatedLines = lines.map((line) => {
    const tableName = getTomlTableName(line);
    if (tableName != null) {
      section = tableName;
      return line;
    }

    if (section === 'd2rcore.fonts') {
      return line;
    }

    const keyLine = parseTomlKeyLine(line);
    if (keyLine == null) {
      return line;
    }

    const id = getTomlSettingID(section, keyLine.key);
    const parsedValue = parseTomlValue(keyLine.valueText);
    const isDefaultMod = id === 'd2rloader.default_mod';
    const hasDynamicSetting = Object.prototype.hasOwnProperty.call(
      dynamicSettings,
      id,
    );

    if (!isDefaultMod && !hasDynamicSetting) {
      return line;
    }

    const value = isDefaultMod ? settings.defaultMod : dynamicSettings[id];
    return `${keyLine.indent}${keyLine.key}${keyLine.separator}${formatTomlValue(
      value,
      parsedValue.valueType,
      section,
      keyLine.key,
    )}${keyLine.commentText}`;
  });

  return `${updatedLines.join(newline)}${hadTrailingNewline ? newline : ''}`;
}

export function updateD2RLoaderConfig(
  configText: string,
  settings: D2RLoaderSettings,
  format: D2RLoaderConfigFormat,
): string {
  return format === 'toml'
    ? updateD2RLoaderTomlConfig(configText, settings)
    : updateD2RLoaderIniConfig(configText, settings);
}

export function updateD2RLoaderIni(
  iniText: string,
  settings: D2RLoaderSettings,
): string {
  return updateD2RLoaderConfig(iniText, settings, 'ini');
}

export function updateD2RLoaderToml(
  tomlText: string,
  settings: D2RLoaderSettings,
): string {
  return updateD2RLoaderConfig(tomlText, settings, 'toml');
}

export function createD2RLoaderConfig(
  fileName: string,
  format: D2RLoaderConfigFormat,
  configText: string,
): D2RLoaderConfig {
  return {
    fileName,
    format,
    settings: format === 'toml' ? parseD2RLoaderTomlSettings(configText) : [],
  };
}
