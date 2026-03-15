import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export interface EMThresholdsConfig {
  strongBull: number;
  bull: number;
  cautious: number;
  choppy: number;
}

export interface RiskProfile {
  riskPerTrade: number;
  totalCapital: number;
  heatWarning: number;
  heatAlert: number;
}

export interface RiskConfig {
  swing: RiskProfile;
  intraday: RiskProfile;
}

export interface ScoreThresholds {
  bull: number;
  cautious: number;
  choppy: number;
  bear: number;
}

export interface MaxFocusStocks {
  strongBull: number;
  bull: number;
  cautious: number;
  choppy: number;
  bear: number;
}

export interface ScoringConfig {
  scoreThresholds: ScoreThresholds;
  maxFocusStocks: MaxFocusStocks;
}

export interface AngelOneConfig {
  apiKey?: string;
  clientId?: string;
  password?: string;
  totpSecret?: string;
}

export interface LLMConfig {
  anthropicKey?: string;
  geminiKey?: string;
  perplexityKey?: string;
  enabled: boolean;
  cacheResponses: boolean;
  cacheTtlHours: number;
}

export interface TelegramConfig {
  botToken: string;
  allowedChatIds: number[];
}

export interface SchedulerConfig {
  eveningTime?: string;
  morningTime?: string;
  syncIntervalMinutes?: number;
}

// TODO(intraday-seam-3): StarkModelConfig in models/config.ts has mbi.refreshInterval.
// When migrating to StarkModelConfig as the runtime type, ensure refreshInterval is preserved.
export interface StarkConfig {
  angelOne?: AngelOneConfig;
  llm?: LLMConfig;
  telegram?: TelegramConfig;
  scheduler?: SchedulerConfig;
  emThresholds: EMThresholdsConfig;
  risk: RiskConfig;
  sheetId: string;
  nseHolidays: string[];
  scoring: ScoringConfig;
}

export function getStarkDir(): string {
  const dir = join(process.env.HOME ?? process.env.USERPROFILE ?? homedir(), '.stark');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function getDefaultConfig(): StarkConfig {
  const riskProfile: RiskProfile = {
    riskPerTrade: 10000,
    totalCapital: 500000,
    heatWarning: 0.06,
    heatAlert: 0.08,
  };
  return {
    emThresholds: {
      strongBull: 25,
      bull: 15,
      cautious: 12,
      choppy: 9.5,
    },
    risk: {
      swing: { ...riskProfile },
      intraday: { ...riskProfile },
    },
    sheetId: '1SkXCX1Ax3n_EUsa06rzqWSdoCrlbGDENuFUOrMFyErw',
    nseHolidays: [],
    scoring: {
      scoreThresholds: {
        bull: 8.0,
        cautious: 8.5,
        choppy: 9.0,
        bear: 10.0,
      },
      maxFocusStocks: {
        strongBull: 5,
        bull: 5,
        cautious: 3,
        choppy: 2,
        bear: 0,
      },
    },
  };
}

export function loadConfig(): StarkConfig {
  const dir = getStarkDir();
  const configPath = join(dir, 'config.json');
  if (!existsSync(configPath)) {
    const defaults = getDefaultConfig();
    writeFileSync(configPath, JSON.stringify(defaults, null, 2), 'utf8');
    return defaults;
  }
  const raw = readFileSync(configPath, 'utf8');
  return JSON.parse(raw) as StarkConfig;
}

export function saveConfig(config: StarkConfig): void {
  const dir = getStarkDir();
  const configPath = join(dir, 'config.json');
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
}
