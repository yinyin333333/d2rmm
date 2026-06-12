import type { D2RLoaderSettings } from 'bridge/BridgeAPI';

type IniValueType = 'boolean' | 'integer' | 'quoted-string';

type IniSetting = {
  value: boolean | number | string;
  type: IniValueType;
};

type IniSectionMap = Record<string, Record<string, IniSetting>>;

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

function getD2RLoaderIniMap(settings: D2RLoaderSettings): IniSectionMap {
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

function formatIniValue(setting: IniSetting): string {
  switch (setting.type) {
    case 'boolean':
      return setting.value ? 'true' : 'false';
    case 'integer':
      return String(Math.floor(Number(setting.value)));
    case 'quoted-string':
      return `"${String(setting.value)
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')}"`;
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

function trimTrailingEmptyLine(lines: string[]): string[] {
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    return lines.slice(0, -1);
  }
  return lines;
}

export function updateD2RLoaderIni(
  iniText: string,
  settings: D2RLoaderSettings,
): string {
  const newline = detectNewline(iniText);
  const hadTrailingNewline = /\r?\n$/.test(iniText);
  const lines = trimTrailingEmptyLine(splitLines(iniText));
  const sectionMap = getD2RLoaderIniMap(settings);

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
      const value = formatIniValue(setting);
      let found = false;

      for (let i = sectionStart + 1; i < sectionEnd; i += 1) {
        const match = lines[i].match(/^(\s*)([^=;\s][^=]*?)(\s*=\s*)(.*)$/);
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
