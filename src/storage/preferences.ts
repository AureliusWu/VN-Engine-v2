import { isRecord } from './save.js';
export type ReadingPreferences = {
  textSpeed: number; autoDelay: number; volume: number; voiceVolume: number;
  music: boolean; voiceEnabled: boolean; reducedMotion: boolean; soundEffects: boolean; ambience: boolean;
};
export const DEFAULT_PREFERENCES: ReadingPreferences = {
  textSpeed: 32, autoDelay: 2200, volume: .2, voiceVolume: .8,
  music: true, voiceEnabled: true, reducedMotion: false, soundEffects: true, ambience: true
};
export function decodePreferences(value: unknown): ReadingPreferences {
  const input = isRecord(value) ? value : {};
  const number = (key: keyof ReadingPreferences, min: number, max: number) => typeof input[key] === 'number' && Number.isFinite(input[key])
    ? Math.max(min, Math.min(max, input[key] as number)) : DEFAULT_PREFERENCES[key] as number;
  const flag = (key: keyof ReadingPreferences) => typeof input[key] === 'boolean' ? input[key] as boolean : DEFAULT_PREFERENCES[key] as boolean;
  return { textSpeed: number('textSpeed', 0, 80), autoDelay: number('autoDelay', 800, 6000), volume: number('volume', 0, 1), voiceVolume: number('voiceVolume', 0, 1),
    music: flag('music'), voiceEnabled: flag('voiceEnabled'), reducedMotion: flag('reducedMotion'), soundEffects: flag('soundEffects'), ambience: flag('ambience') };
}
